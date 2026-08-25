<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { EditorCore, emptyDocument, type Block, type BlockRole } from "./editor";
  import Gallery from "./dev/Gallery.svelte";
  import { EditorSession } from "./lib/session";
  import type { SaveState } from "./lib/autosave";
  import { theme } from "./lib/theme.svelte";
  import type { ThemeId } from "./tokens/themes";
  import EditorShell from "./components/EditorShell.svelte";
  import LibraryPanel from "./components/LibraryPanel.svelte";
  import HistoryPanel from "./components/HistoryPanel.svelte";
  import SelectionToolbar from "./components/SelectionToolbar.svelte";
  import SettingsScreen from "./components/SettingsScreen.svelte";
  import FontSheet from "./components/FontSheet.svelte";
  import ToggleChip from "./components/ToggleChip.svelte";
  import Button from "./components/Button.svelte";
  import Alert from "./components/Alert.svelte";
  import { isolate, sinceLabel } from "./lib/bidi";
  import { preferences } from "./lib/preferences.svelte";
  import { comfortPadding, typewriterScroll } from "./lib/typewriter";
  import type { FontReference } from "./lib/fonts";
  import { declareImportedFonts } from "./lib/font-faces";
  import { span, surfaceIn, surfaceOut } from "./lib/transitions";
  import { MOTION } from "./tokens/motion";
  import { editingReaches } from "./lib/menu";
  import type { SettingsSectionId } from "./lib/settings";
  import type {
    DocumentCard,
    LibraryListing,
    RevisionCard,
  } from "./lib/library";
  import type { SurfaceId } from "./lib/surfaces";

  // المرحلة ٦ — المحرر المريح والتخصيص.
  //
  // هذا الملف **يوصّل ولا يصمّم**: كل شكل مكوّن من `src/components/`،
  // وكل قاعدة سلوك من `Luma.md`، وكل حساب في `src/lib/`.

  type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

  let hostEl = $state<HTMLElement | null>(null);
  let scrollerEl = $state<HTMLElement | null>(null);
  let count = $state(0);
  let title = $state("بدون عنوان");
  let saveState = $state<SaveState>({ kind: "idle" });

  // ── الظهور الأول لمستند جديد — FEEL-PLAN M0 (ج) ────────────
  // «بمجرد أول محتوى ينشأ المستند ويبدأ الحفظ ويظهر في المكتبة»
  // (`Luma.md` §٤) — ثلاث حقائق كانت تقع كلها خلف الكواليس. أول
  // «محفوظ» لمستند وُلد في هذه الجلسة يُرى بكامل حضوره لحظتين ثم
  // يخفت إلى حالته الدائمة. مرة واحدة لكل مستند، ولا شيء لمستند
  // مفتوح من المكتبة.
  let saveDebut = $state(false);
  /** الوضع المريح كان قائمًا قبل فتح الإعدادات، فيُستأنف بعدها. */
  let comfortResume = false;
  /** يُبطل استقرارًا مؤجَّلًا لدخولٍ سبقه خروج. */
  let comfortGeneration = 0;
  /** مستندات وُلدت هنا بأول محتوى — لا المفتوحة من المكتبة. */
  const bornIds = new Set<string>();
  /** ما عُرض له الظهور الأول — فلا يتكرر مع كل حفظة تالية. */
  const debutedIds = new Set<string>();
  let debutTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * هل رأى الكاتب تحذير «نصّك لم يصل القرص» عن الحالة الراهنة؟
   *
   * **يعدّ التحذيرات المعروضة لا محاولات الإغلاق.** كان عدّادًا للطلبات،
   * فطلبان متزامنان (الزرّ الأحمر ثم ⌘Q قبل أن يعود القرص) يرفعانه إلى
   * اثنين من تحذيرٍ واحد لم يُرَ بعد — فيُهدَم على نصٍّ ضائع والكاتب لم
   * يقرأ شيئًا. و«الإصرار عن علم» بلا علمٍ ليس إصرارًا.
   *
   * ويُصفَّر عند أول حفظ ناجح: تحذيرٌ عن نصّ وصل القرص لا يُصرف على
   * نصٍّ كُتب بعده.
   */
  let closeWarned = false;
  /** نسخة من مستمع الإغلاق تعمل الآن — لا تتوازى نسختان على جلسة واحدة. */
  let closing = false;

  /** هل يصل فعل التحرير إلى النص الذي يراه صاحبه؟ — `lib/menu.ts`. */
  function editingReachable(): boolean {
    return editingReaches({ settings, fontSheet, preview: previewId !== null });
  }

  function maybeDebut(s: SaveState) {
    if (s.kind !== "saved") return;
    // حفظٌ نجح: التحذير السابق لم يعد يمثّل الحال
    closeWarned = false;
    const id = session?.currentId;
    if (!id || !bornIds.has(id) || debutedIds.has(id)) return;
    debutedIds.add(id);
    saveDebut = true;
    clearTimeout(debutTimer);
    debutTimer = setTimeout(() => (saveDebut = false), 2000);
  }

  // ── حالة الأسطح ────────────────────────────────────────────
  // **لوحة واحدة مفتوحة في كل وقت** — §١٠: «فتح لوحة يضيف عمودًا».
  let surface = $state<SurfaceId | null>(null);
  let documents = $state<DocumentCard[]>([]);
  let damaged = $state<string[]>([]);
  let revisions = $state<RevisionCard[]>([]);
  /** لحظة مرجعية للأزمنة النسبية — تُحدَّث عند فتح لوحة لا كل ثانية. */
  let now = $state(Date.now());

  // ── المعاينة ───────────────────────────────────────────────
  // «أثناء المعاينة يدخل المستند وضع قراءة فقط ويختفي مؤشر الحفظ»
  // — `Luma.md` §٩ **ثابت**.
  let previewId = $state<string | null>(null);
  let previewAt = $state<number | null>(null);
  let restoring = $state(false);

  /**
   * عطلٌ يخصّ المستخدم لا سجلّ المطوّر.
   *
   * كانت مسارات الفشل كلها تنتهي عند `console.error`: المستخدم يضغط
   * ويرى شيئًا لم يحدث بلا سبب معلن. §٩ **ثابت**: «تعذُّر قراءة لقطة
   * قديمة **يُظهر خطأ** محصورًا في تلك اللقطة». يبقى حتى يُعالج سببه.
   */
  let problem = $state<{ title: string; detail: string } | null>(null);
  function fail(title: string, detail: unknown) {
    const text = detail instanceof Error ? detail.message : String(detail);
    problem = { title, detail: text };
    console.error(`[luma] ${title}:`, detail);
  }

  // ── شريط التحديد ───────────────────────────────────────────
  /** يوجد تحديدٌ قابل للتنسيق — والموضع لم يعد يعني شيئًا: الشريط
   *  يرسو أسفل المساحة لا فوق التحديد (`FEEL-PLAN` M5). */
  let selection = $state(false);
  let role = $state<BlockRole | null>(null);
  /** التحديد كلّه موزون — حالة زرّ الوزن في الشريط. */
  let strong = $state(false);

  // ── المحرر المريح والإعدادات ───────────────────────────────
  const prefs = $derived(preferences.value);
  let comfort = $state(false);
  /** Zen: تتراجع العناصر أثناء الكتابة وتعود بحركة المؤشر أو Esc. */
  let zenHidden = $state(false);

  let settings = $state(false);
  let settingsSection = $state<SettingsSectionId>("appearance");
  let fontSheet = $state(false);
  let fonts = $state<FontReference[]>([]);
  let importing = $state(false);
  let fontError = $state<string | null>(null);
  let appVersion = $state("");
  let dataDir = $state("");

  let gallery = $state(false);

  /**
   * علامات الإقلاع — ميزانية (أ): «زمن الفتح حتى مؤشر قابل للكتابة».
   *
   * تُلتقط بـ`performance.now()` محليًّا، وتُحوَّل إلى «منذ بدء
   * العملية» بمرساة واحدة تُقرأ من النواة مرة واحدة: قراءتها عند كل
   * علامة تضيف زمن جسرٍ إلى ما تقيسه.
   *
   * **علامتان لا واحدة.** «السطح جاهز» يقع باكرًا على مستند فارغ،
   * و«النص عاد» هو ما ينتظره المستخدم فعلًا — ومَن يقيس الأولى وحدها
   * يعلن رقمًا لا يعيشه أحد.
   */
  const marks: Record<string, number> = {};
  let startupAnchor: { process: number; local: number } | null = null;
  const sinceStart = (t: number): number =>
    startupAnchor ? startupAnchor.process + (t - startupAnchor.local) : -1;
  export function startupMarks(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(marks)) out[k] = sinceStart(v);
    return out;
  }

  let session: EditorSession | null = null;
  let invoke: Invoke | null = null;
  /**
   * مرآة تفاعلية لـ`session.currentId`.
   *
   * الجلسة ليست حالة Svelte عمدًا — هي منطق لا عرض. والمكتبة تحتاج
   * معرّف المستند المفتوح لتعليم صفّه، فيُنسخ هنا عند كل تغيّر:
   * الفتح، وبدء نصّ جديد، وأول محتوى يُنشئ المستند.
   */
  let currentId = $state<string | null>(null);
  const cleanups: Array<() => void> = [];

  /**
   * تغيير تفضيل: يُطبَّق فورًا ثم يُحفظ — «لا زر حفظ الإعدادات» §١٥.
   *
   * الثيم وحده يمرّ بمخزنه أيضًا لأنه يُطبَّق بسمة على الجذر لا
   * بمتغيّر، وبقية التفضيلات متغيّرات CSS يضبطها المخزن.
   */
  function setPref<K extends keyof typeof prefs>(key: K, value: (typeof prefs)[K]) {
    if (key === "themeId") theme.apply(value as ThemeId);
    preferences.set(key, value);
    if (key === "showWordCount" || key === "typewriterEnabled") syncLayers();
    if (key === "focusEnabled") syncLayers();
  }

  /** يطبّق طبقتَي المحرر المريح على النواة. */
  function syncLayers() {
    editor.setFocusMode(comfort && prefs.focusEnabled);
    // تفعيل الآلة الكاتبة يُظهر نطاقها — والسطر النشط يجب أن يبلغه
    // الآن، لا أن يبقى مكانه حتى أول ضغطة تالية.
    if (comfort && prefs.typewriterEnabled) centerWhenReady();
    if (countIsVisible) recount(session?.contents ?? []);
  }

  /**
   * عدّ الكلمات **عند الحاجة فقط**.
   *
   * العدّاد مخفي افتراضيًا، والسجل يعرض العدد الحيّ وهو مفتوح. وعدّ
   * مستندٍ كامل مع كل ضغطة مفتاح — وهو ما كان يجري — عملٌ يُرمى في
   * الحالة الغالبة، ويُحسّ تلعثمًا على النص الطويل.
   */
  const countIsVisible = $derived(prefs.showWordCount || surface === "history");

  function recount(blocks: readonly { text: string }[]) {
    let n = 0;
    for (const b of blocks) {
      const t = b.text.trim();
      if (t) n += t.split(/\s+/).length;
    }
    count = n;
  }

  const editor = new EditorCore({
    onChange: (blocks) => {
      if (countIsVisible) recount(blocks);
      session?.handleChange(blocks);
      const id = session?.currentId ?? null;
      // ميلاد مستند: كان المعرّف فارغًا فولّده أول محتوى — FEEL-PLAN M0
      if (id !== null && currentId === null) bornIds.add(id);
      currentId = id;
      if (comfort && prefs.zenEnabled) zenRecede();
    },
    // التحديد يقرّر ظهور الشريط: نصٌّ محدَّد يُظهره، وأول حرف يُكتب
    // يطوي التحديد فيختفي. «يختفي عند استئناف الكتابة» — §٥ **ثابت**.
    onSelectionChange: (docChanged) => {
      syncSelection();
      runTypewriter(docChanged);
    },
    ariaLabel: "مساحة الكتابة",
  });

  // ── المحرر المريح ──────────────────────────────────────────

  /**
   * الآلة الكاتبة — §٧ **ثابت في السلوك**.
   *
   * الحساب في `src/lib/typewriter.ts` بلا DOM؛ هنا القياس والتنفيذ.
   * لا يعمل إلا داخل المحرر المريح وبطبقته مفعَّلة: «لكلٍّ تعطيل
   * مستقل» — معيار اكتمال المرحلة ٦.
   */
  function runTypewriter(typing = false) {
    if (!comfort || !prefs.typewriterEnabled) return;
    const sc = scrollerEl;
    const caret = editor.caretRect();
    if (!sc || !caret) return;

    const box = sc.getBoundingClientRect();
    const decision = typewriterScroll(
      caret.top,
      caret.height,
      { height: box.height, top: box.top },
      { typing, reduceMotion: reduceMotion() },
    );
    if (decision.delta === 0) return;

    sc.scrollTo({
      top: sc.scrollTop + decision.delta,
      behavior: decision.smooth ? "smooth" : "auto",
    });
  }

  /** تقليل الحركة: تفضيل النظام أو تفضيل Luma — أيّهما كان. */
  function reduceMotion(): boolean {
    return (
      prefs.reduceMotionOverride ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  /** Zen: تتراجع العناصر مع الكتابة، وتعود بحركة المؤشر أو بالتركيز. */
  /**
   * أول تمركز بعد تغيّرٍ في التخطيط — **يعاود حتى يصير للمؤشر مستطيل**.
   *
   * استعادة التركيز تُزامن تحديد DOM في إطارٍ لاحق أحيانًا، فيقع
   * القياس على مؤشرٍ بلا مستطيل ويُهمَل التمركز صامتًا: قِيس فدخل
   * الوضعُ والسطرُ النشط في أسفل النافذة بدل نطاقه.
   */
  /** مرساة السطر النشط — المصدر نفسه الذي يقيس عليه `lib/typewriter.ts`. */
  const COMFORT_ANCHOR = 0.455;

  function centerWhenReady(frames = 6) {
    requestAnimationFrame(() => {
      if (!comfort) return;
      if (editor.caretRect() !== null || frames <= 0) {
        runTypewriter();
        return;
      }
      centerWhenReady(frames - 1);
    });
  }

  function onResize() {
    if (!comfort) return;
    applyComfortPadding();
    centerWhenReady();
  }

  function zenRecede() {
    zenHidden = true;
  }

  function zenReveal() {
    if (!zenHidden) return;
    zenHidden = false;
  }

  /**
   * حشوة الوضع تُحسب من ارتفاع المساحة لا من ارتفاع النافذة.
   *
   * كانت `45.5vh` في CSS والنطاقُ `45.5%` من مساحة الكتابة —
   * ومرجعاهما مختلفان: `vh` يشمل شريط السحب ٤٨px والمساحةُ لا تشمله.
   * فارقٌ قِيس نحو ٢٢px يترك سطر بداية المستند **خارج شريطه كاملًا**
   * ولا يصحّحه أحد لأنه يقع داخل نطاق السكون. والمصدر الآن واحد:
   * `comfortPadding` في `lib/typewriter.ts` — وكانت مكتوبة ومهجورة.
   */
  function applyComfortPadding() {
    const sc = scrollerEl;
    if (!sc) return;
    // الصندوق الخارجي: لا يتغيّر بتغيّر الحشوة نفسها فلا يدور القياس
    const pad = comfortPadding(sc.getBoundingClientRect().height);
    const root = document.documentElement;
    root.style.setProperty("--comfort-pad-top", `${pad.top}px`);
    root.style.setProperty("--comfort-pad-bottom", `${pad.bottom}px`);
  }

  /**
   * تشغيل الغلاف نفسه — بلا لمس الشاشات فوقه.
   *
   * يستدعيه الدخول المباشر، والعودةُ من الإعدادات إلى الوضع الذي كان.
   */
  /**
   * يُطبَّق تغيّرٌ في التخطيط **والسطر النشط لا يتزحزح على الشاشة**.
   *
   * حشوة الوضع المريح تقارب نصف ارتفاع النافذة، فتغيّرها يقذف النص
   * مئات البكسلات دفعةً واحدة. والتعويض في التمرير يجعل التغيير
   * **غير مرئي**، فلا يبقى مما يراه المستخدم إلا الانسياب المقصود.
   */
  /**
   * مرساة الثبات: **أعلى كتلة النص لا مستطيل المؤشر**.
   *
   * المؤشر مرساةٌ تغيب: مستطيله يعود فارغًا حين تكون مرساة تحديد DOM
   * عنصرًا لا نصًّا — قِيس، فسقط التعويض صامتًا وقفز النص ٢٤٥px. وكتلة
   * النص مستطيلها موجود دائمًا، وإزاحتها هي عين ما تغيّره الحشوة.
   */
  function textTop(): number | null {
    return hostEl ? hostEl.getBoundingClientRect().top : null;
  }

  async function keepTextStill(apply: () => void) {
    const before = textTop();
    apply();
    await tick();
    const after = textTop();
    const sc = scrollerEl;
    if (sc && before !== null && after !== null) {
      sc.scrollTop = Math.max(0, Math.round(sc.scrollTop + (after - before)));
    }
  }

  async function activateComfort() {
    comfortGeneration += 1;
    await keepTextStill(() => {
      comfort = true;
      // لا يبدأ الوضع بشرائط أخفاها Zen في جلسة سابقة
      zenHidden = false;
      editor.setFocusMode(prefs.focusEnabled);
    });
    await keepTextStill(applyComfortPadding);
    editor.focus();
    // ينساب النص إلى مرساته **مع** انفتاح الإطار لا بعده — `glideToAnchor`.
    glideToAnchor(span(MOTION.structural));
  }

  /**
   * انسيابٌ **يتتبّع التخطيط ولا يتنبّأ به**.
   *
   * المشهد حركتان متزامنتان: الإطار ينفتح في ٥٠٠ms فتكبر مساحة الكتابة
   * وتتحرّك مرساتها، والنص ينساب إلى تلك المرساة. وكان التمركز يُؤجَّل
   * حتى يستقرّ الانفتاح — فتبدو حركتين وفجوةً بينهما، وهو ما يُحَسّ
   * تلعثمًا.
   *
   * والتنبّؤ بالتخطيط النهائي حلٌّ هشّ: يعتمد على معرفةٍ مسبقة بما
   * سينطوي وبكم. فيُعاد الحساب **في كل إطار** بدله: يُقاس المطلوب من
   * التخطيط كما هو الآن، ويُقطع جزءٌ من المسافة إليه. والنسبة الثابتة
   * تعطي منحنًى يخفّ من تلقائه — وهو عين `ease-out` — ويتقارب مع
   * التخطيط لا ضدّه، فلا يحتاج أن يعرف عنه شيئًا.
   */
  function glideToAnchor(duration: number) {
    const sc = scrollerEl;
    if (!sc) return;
    if (duration <= 0) {
      centerWhenReady();
      return;
    }
    const started = performance.now();
    // **الذيل يتجاوز مدّة الانفتاح.** المتتبِّع يلاحق هدفًا يتحرّك
    // طوال الحركة، فيتخلّف عنه بمقدار إزاحتها كاملة — قِيس ٤٤px، وهو
    // عين ارتفاع الشريط المنطوي. وحين يسكن الهدف يقاربه المتتبِّع
    // أُسّيًّا فتذوب البقيّة في أجزاء من الثانية: حركةٌ واحدة تنتهي
    // هادئة، لا قفزةٌ تصحيحية في آخرها.
    const deadline = duration * 2;
    const step = () => {
      if (!comfort) return;
      const caret = editor.caretRect();
      let rest = 0;
      if (caret) {
        const box = sc.getBoundingClientRect();
        const middle = caret.top + caret.height / 2;
        const anchor = box.top + box.height * COMFORT_ANCHOR;
        rest = sc.scrollTop + (middle - anchor) - sc.scrollTop;
        sc.scrollTop = sc.scrollTop + rest * 0.25;
      }
      const elapsed = performance.now() - started;
      // يتوقّف حين يبلغ مرساته، لا حين تنتهي مهلة
      if (elapsed > duration && Math.abs(rest) < 0.5) return;
      if (elapsed < deadline) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }


  async function enterComfort() {
    if (comfort) return;
    // إغلاق ما يزاحم: «تختفي المكتبة والقوائم والأدوات» §٧
    exitPreview();
    surface = null;
    // **الإعدادات تُغلق بمسارها لا بسطر.** كان `settings = false`
    // وحده يترك ما رفعه فتحُها: `setEditable(false)` قائمًا و`inert`
    // على الإطار — فيفتح ⌃⌘F محررًا مريحًا **لا يقبل حرفًا ولا مؤشر
    // فيه**. قِيس: `contenteditable="false"` والكتابة لا تصل.
    if (settings || fontSheet) {
      comfortResume = false;
      await closeSettings();
    }
    await activateComfort();
  }

  /**
   * الخروج **لا يغيّر موضع المؤشر ولا حالة النص** — §٧ **ثابت**.
   *
   * لا يُلمس المحتوى ولا التحديد: تُطفأ طبقة التركيز (وهي عرض بحت)
   * ويعود الإطار بأشرطته.
   */
  async function exitComfort() {
    if (!comfort) return;
    comfortGeneration += 1;
    // **الخروج لا يقفز.** حشوة الوضع تنطوي دفعةً واحدة فينتقل السطر
    // النشط — قِيس ٢٥١px، وعلى مستند قصير يعود التمرير إلى الصفر.
    // «الخروج لا يغيّر موضع المؤشر» صحيحٌ في النص، وهذا يجعله صحيحًا
    // في العين أيضًا. والأشرطة تعود في ٥٠٠ms من حولها.
    await keepTextStill(() => {
      comfort = false;
      zenHidden = false;
      editor.setFocusMode(false);
    });
    editor.focus();
  }

  function toggleComfort() {
    if (comfort) void exitComfort();
    else void enterComfort();
  }

  function syncSelection() {
    if (!editor.selectionRect() || !editor.isEditable) {
      selection = false;
      role = null;
      strong = false;
      return;
    }
    role = editor.currentRole();
    strong = editor.isStrong;
    selection = true;
  }

  // ── الأسطح ─────────────────────────────────────────────────

  async function toggleSurface(id: string) {
    if (surface === id) {
      closeSurface();
      return;
    }
    // **مغادرة السجل تنهي المعاينة دائمًا** — لا بأيّ طريق غادرته.
    // مخرج المعاينة الوحيد داخل لوحة السجل، فتركُها مفتوحةً مع إغلاق
    // اللوحة يحبس المستند في وضع قراءة فقط بلا مخرج ظاهر.
    exitPreview();
    now = Date.now();
    surface = id as SurfaceId;
    // تحديث المحتوى بعد الفتح لا قبله: اللوحة تظهر فورًا، والقراءة من
    // القرص لا تحجب الفتح ولا الكتابة — §١٧ مبدأ ٤.
    if (id === "library") await refreshLibrary();
    if (id === "history") {
      // العدّاد صار مرئيًا في صفّ «النسخة الحالية»، فيُحسب الآن مرة
      recount(session?.contents ?? []);
      await refreshRevisions();
    }
  }

  /** الإغلاق يعيد التركيز إلى النص: «الإغلاق لا يفقد موضع المؤشر ولا التحديد». */
  function closeSurface() {
    exitPreview();
    surface = null;
    editor.focus();
  }

  async function refreshLibrary() {
    if (!invoke) return;
    try {
      const listing = await invoke<LibraryListing>("list_documents");
      documents = listing.documents;
      damaged = listing.damaged;
    } catch (e) {
      // تعذّر التعداد لا يمنع الكتابة — §١٧ مبدأ ٤
      console.error("[luma] تعذّر تعداد المكتبة:", e);
    }
  }

  async function refreshRevisions() {
    const id = currentId;
    if (!invoke || !id) {
      revisions = [];
      return;
    }
    try {
      revisions = await invoke<RevisionCard[]>("list_revisions", {
        documentId: id,
      });
    } catch (e) {
      console.error("[luma] تعذّر تعداد السجل:", e);
      revisions = [];
    }
  }

  /**
   * نصّ جديد — المسار الذي لم يكن موجودًا.
   *
   * يُغلق ما يزاحم ثم يفرّغ المساحة ويعيد التركيز إلى النص. والمستند
   * لا يُنشأ إلا عند أول حرف يُكتب فيه.
   */
  async function newDocument() {
    if (!session) return;
    exitPreview();
    try {
      await session.startNew();
    } catch (e) {
      // فشل حفظ الحالي يمنع البدء — لا يُستبدل نصٌّ لم يصل القرص
      fail("تعذّر بدء نصّ جديد", e);
      return;
    }
    problem = null;
    currentId = null;
    count = 0;
    surface = null;
    await tick();
    editor.focus();
  }

  // ── المكتبة ────────────────────────────────────────────────

  async function openDocument(id: string) {
    if (!session || id === currentId) return;
    exitPreview();
    try {
      await session.open(id);
    } catch (e) {
      // فشل الفتح يترك المستند الحالي كما هو — §١٧ مبدأ ٤.
      // ويشمل ذلك **فشل حفظ الحالي**: لا يُستبدل نصٌّ لم يصل القرص.
      fail("تعذّر فتح النص", e);
      return;
    }
    problem = null;
    currentId = session.currentId;
    count = editor.wordCount;
    await refreshLibrary();
    editor.focus();
  }

  // ── السجل ──────────────────────────────────────────────────

  async function preview(id: string | null) {
    if (id === null) {
      exitPreview();
      return;
    }
    if (!invoke || !session) return;
    // الحالة الحيّة تصل القرص **قبل** أي استبدال في المحرر — وإن لم
    // تصل، لا معاينة: المعاينة تستبدل ما في المحرر.
    const wrote = await session.flush();
    if (!wrote.settled) {
      fail(
        "تعذّرت المعاينة",
        wrote.because === "refused"
          ? "لم يصل نصّك الحالي إلى القرص، ولا يُستبدل نصٌّ غير محفوظ."
          : "نصّك الحالي ما زال يصل القرص. أمهله لحظة ثم أعد المحاولة.",
      );
      return;
    }
    try {
      const rev = await invoke<{ blocks: Block[]; createdAt: number }>(
        "load_revision",
        { documentId: currentId, revisionId: id },
      );
      previewId = id;
      previewAt = rev.createdAt;
      editor.setBlocks(rev.blocks);
      editor.setEditable(false);
      selection = false;
      problem = null;
    } catch (e) {
      // «تعذُّر قراءة نسخة قديمة لا يؤثر في المستند الحالي» — §٩.
      // الخطأ محصور في تلك اللقطة: المحرر لم يُمسّ، والمعاينة لم تبدأ.
      fail("تعذّرت قراءة هذه النسخة", e);
    }
  }

  function exitPreview() {
    if (previewId === null) return;
    previewId = null;
    previewAt = null;
    editor.setEditable(true);
    // النص الحيّ محفوظ في الجلسة طوال المعاينة، فيعود كما كان
    if (session) editor.setBlocks(session.contents);
  }

  async function restore(id: string) {
    if (!invoke || !session) return;
    restoring = true;
    try {
      const result = await invoke<{ blocks: Block[] }>("restore_revision", {
        documentId: currentId,
        revisionId: id,
      });
      previewId = null;
      previewAt = null;
      editor.setEditable(true);
      session.adopt(result.blocks);
      count = editor.wordCount;
      now = Date.now();
      await refreshRevisions();
      problem = null;
      editor.focus();
    } catch (e) {
      fail("تعذّرت استعادة هذه النسخة", e);
    } finally {
      restoring = false;
    }
  }

  // ── لوحة المفاتيح ──────────────────────────────────────────

  function onKeydown(e: KeyboardEvent) {
    // ⌃⌘F يفتح المحرر المريح ويخرج منه — الاختصار المعلن في §١٥
    if (e.key.toLowerCase() === "f" && e.metaKey && e.ctrlKey) {
      e.preventDefault();
      toggleComfort();
      return;
    }

    if (e.key !== "Escape") {
      if (comfort && prefs.zenEnabled) zenRecede();
      return;
    }

    // Esc: الأقرب أولًا — ورقة الخط، ثم الإعدادات، ثم المحرر المريح،
    // ثم اللوحة. طبقةٌ واحدة في كل ضغطة، فلا يُفاجأ المستخدم بخروج
    // من وضعٍ لم يقصده.
    e.preventDefault();
    if (fontSheet) void closeFontSheet();
    else if (settings) void closeSettings();
    else if (comfort) exitComfort();
    else if (surface !== null) closeSurface();
  }

  /**
   * حركة المؤشر تُعيد ما أخفاه Zen — ومعها Esc ووسيلة ظاهرة.
   *
   * **حركة حقيقية لا حدثًا**: WebKit يبثّ `pointermove` بإحداثيات لم
   * تتغيّر بعد كل تمرير ليحدّث حالة التمرير تحت المؤشر. ومؤشرٌ ساكن
   * فوق النافذة كان يُلغي Zen مع كل سطر يُكتب — فلا يتراجع شيء أبدًا.
   */
  let pointerAt = { x: -1, y: -1 };
  function onPointerMove(e: PointerEvent) {
    const moved =
      Math.abs(e.clientX - pointerAt.x) > 2 || Math.abs(e.clientY - pointerAt.y) > 2;
    pointerAt = { x: e.clientX, y: e.clientY };
    if (moved && comfort && zenHidden) zenReveal();
  }

  // ── الإعدادات ──────────────────────────────────────────────

  /**
   * حاجز ثانٍ لا يعتمد على `inert`.
   *
   * `inert` هو ما يُخرج الإطار من مسار التركيز، وعليه تقوم سلامة النص
   * حين تعلوه شاشة. وهو مدعوم في كل إصدار macOS مدعوم (WebKit 15.5)،
   * لكن ما يحمي النص لا يُترك لحاجزٍ واحد: المحرر نفسه يرفض التحرير
   * ما دامت الشاشة قائمة. حاجزان مستقلان، وسقوط أحدهما لا يُفقد حرفًا.
   */
  $effect(() => {
    if (settings) editor.setEditable(false);
  });

  async function openSettings() {
    exitPreview();
    surface = null;
    // الإعدادات تعلو الوضع ولا تُنهيه: من فتحها ليكبّر خطًّا يعود إلى
    // ما كان فيه، ولا يخسر تركيزه لأنه غيّر إعدادًا.
    comfortResume = comfort;
    comfort = false;
    editor.setFocusMode(false);
    settings = true;
    await refreshFonts();
  }

  /**
   * الإغلاق يعيد التركيز إلى النص — **بعد أن ترفع الشجرة `inert`**.
   *
   * `settings = false` لا يُطبَّق على DOM فورًا، والإطار ما زال
   * `inert` لحظةَ استدعاء `focus()`، فيسقط الطلب صامتًا ويضيع
   * التركيز إلى `<body>`. `tick()` ينتظر تطبيق التغيير.
   */
  /** يفتح صفحة المشروع — النواة تفتحها بالنظام، ولا تتصل Luma بشيء. */
  async function openProjectPage() {
    if (!invoke) return;
    try {
      await invoke("open_project_page");
    } catch (e) {
      fail("تعذّر فتح صفحة المشروع", e);
    }
  }

  async function closeSettings() {
    settings = false;
    fontSheet = false;
    await tick();
    // المعاينة تنتهي عند فتح الإعدادات، فالعودة دائمًا إلى قابل للتحرير
    editor.setEditable(true);
    if (comfortResume) {
      comfortResume = false;
      await activateComfort();
      return;
    }
    editor.focus();
  }

  /** إغلاق ورقة الخط يعيد التركيز إلى مدخلها في الإعدادات. */
  async function closeFontSheet() {
    fontSheet = false;
    await tick();
    document.querySelector<HTMLElement>("[data-open-fonts]")?.focus();
  }

  /** يحوّل مسارًا محليًّا إلى عنوان أصول — يُضبط عند وصل النواة. */
  let toAssetUrl: ((p: string) => string) | null = null;

  async function refreshFonts() {
    if (!invoke) return;
    try {
      fonts = await invoke<FontReference[]>("list_fonts");
      // الخطوط المستوردة لا تصل نافذة العرض بتسجيل النواة وحده — §٨
      if (toAssetUrl) declareImportedFonts(fonts, toAssetUrl);
      // «خط اختفى من النظام بعد اختياره يعود بأمان» — §٨ **ثابت**
      if (fonts.length > 0 && !fonts.some((f) => f.id === prefs.fontFamily)) {
        preferences.fallBackToBundled();
      }
    } catch (e) {
      // تعذّر تعداد الخطوط لا يمنع الكتابة — §١٧ مبدأ ٤
      console.error("[luma] تعذّر تعداد الخطوط:", e);
    }
  }

  function chooseFont(font: FontReference) {
    fontError = null;
    preferences.set("fontFamily", font.familyName);
    preferences.set("fontSource", font.source);
  }

  async function importFont() {
    if (!invoke || importing) return;
    importing = true;
    fontError = null;
    try {
      const font = await invoke<FontReference | null>("pick_and_import_font");
      if (font) {
        await refreshFonts();
        chooseFont(font);
      }
    } catch (e) {
      // «ملف خط تالف يُرفض بوضوح ولا يؤثر في المستند» — §١١ **ثابت**
      fontError = e instanceof Error ? e.message : String(e);
    } finally {
      importing = false;
    }
  }

  onMount(async () => {
    // أدوات تحقق على طبقة الويب — لـPlaywright وحده
    const query = new URLSearchParams(location.search);
    if (query.has("gallery")) {
      gallery = true;
      return;
    }
    if (!hostEl) return;
    const host = hostEl;
    editor.mount(host, emptyDocument());
    editor.focus();
    marks["surface"] = performance.now();

    window.addEventListener("keydown", onKeydown);
    cleanups.push(() => window.removeEventListener("keydown", onKeydown));
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    cleanups.push(() => window.removeEventListener("pointermove", onPointerMove));
    // تغيير حجم النافذة ينقل النطاق ويعيد حساب الحشوة، ولا شيء كان
    // يتبعه: يبقى النص مكانه حتى أول ضغطة.
    window.addEventListener("resize", onResize);
    cleanups.push(() => window.removeEventListener("resize", onResize));

    // خارج `Luma.app` — على خادم التطوير — يعمل المحرر بلا تخزين.
    //
    // الفحص على جسر Tauri نفسه لا على نجاح الاستيراد: الحزمة تُستورد
    // في المتصفح بلا خطأ ثم يفشل أول `invoke` — فكان الفرع الخطأ يُتَّخذ
    // ويُترك وعدٌ مرفوض بلا معالج.
    if (!("__TAURI_INTERNALS__" in window)) {
      // شاشة الإعدادات بلا نواة: تخطيطها وقواعدها تُفحص، والخطوط
      // والحفظ يُفحصان داخل `Luma.app` حيث توجد النواة.
      if (query.has("settings")) settings = true;
      return;
    }

    const core = await import("@tauri-apps/api/core");
    invoke = core.invoke;
    const call = core.invoke;
    toAssetUrl = core.convertFileSrc;

    // ── الجلسة والمستمعون **قبل كل عمل مؤجَّل** ─────────────────
    //
    // كانا بعد التفضيلات والخطوط، وبينهما `await refreshFonts()` الذي
    // يمسح خطوط النظام. والنافذة ظاهرة طوال ذلك، فما يُكتب فيها لا
    // جلسةَ تعرفه، وطلبُ إغلاق يقع فيها لا مستمعَ له — والحدث لا
    // يُخزَّن لمن يتأخر. أُقيمت نقطة الاستقبال أولًا: لا شيء هنا يقرأ
    // قرصًا ولا ينتظر شبكة، فلا يؤخّر مؤشرًا.
    session = new EditorSession({
      editor,
      bridge: {
        save: (p) => call("save_document", { payload: p }),
        load: (id) => call("load_document", { id }),
        remove: (id) => call("delete_document", { id }),
      },
      onSaveState: (s) => {
        saveState = s;
        maybeDebut(s);
      },
      onTitleChange: (t) => (title = t),
    });

    try {
      const { listen } = await import("@tauri-apps/api/event");

      cleanups.push(
        await listen<string>("luma://menu", (e) => {
          // **التراجع لا يمسّ نصًّا لا يراه صاحبه.** بند «تراجع» في
          // قائمة النظام مفعَّل دائمًا، و`inert` يحجب الشجرة لا أحداث
          // النواة — فكان ⌘Z أمام الإعدادات يمحو في المستند المحجوب
          // (و⌘Z أشيع ما يُضغط بعد تغيير إعداد)، ثم يثبّت الحفظُ
          // التلقائي المحوَ على القرص. والمعاينة قراءةٌ فقط كذلك.
          if (e.payload === "undo" || e.payload === "redo") {
            if (!editingReachable()) return;
            if (e.payload === "undo") editor.undo();
            else editor.redo();
          } else if (e.payload === "settings") void openSettings();
        }),
      );

      // فقد التركيز محفّز كتابة فورية — §٥
      cleanups.push(await listen("luma://flush", () => void session?.flush()));

      // الإغلاق مؤجَّل: تُكتب آخر دفقة ثم يُغلق فعلًا
      cleanups.push(
        await listen("luma://flush-and-close", async () => {
          // **نسخة واحدة تعمل.** المستمع لا يُطابر: كل بثّة تُشغّل نسخة
          // مستقلة، و⌘Q يبثّ بلا مزلاج. فطلبان متتاليان (زرٌّ أحمر ثم
          // ⌘Q قبل أن يعود القرص) كانا يمرّان معًا على الحالة المشتركة:
          // الأولى تعرض التحذير، والثانية تعدّه «إصرارًا» فتهدم — وما
          // قرأ الكاتب شيئًا. الحارس هنا يجعل الطلب الثاني ينتظر دوره،
          // ولا يُحتسب إصرارًا على تحذيرٍ لم يُعرض بعد.
          if (closing) return;
          closing = true;
          try {
            preferences.flush();
            // **فرصة استرجاع صريحة عند الإغلاق** — §٥ **ثابت**.
            // النافذة لا تُهدم على تغيير لم يصل القرص: يبقى النص في
            // الذاكرة، وتظهر الحالة والسبب، وإعادة المحاولة مستمرة.
            // **حالة التحذير تُلتقط قبل الكتابة لا بعدها.**
            //
            // `maybeDebut` يصفّر `closeWarned` عند كل «محفوظ» — وفرع
            // `busy` كلّ كتاباته ناجحة، فكان الاستنزاف نفسه يمحو
            // التحذير الذي نحن بصدد تقييمه: يعود `busy` فيُرى الكاتب
            // غيرَ محذَّر أبدًا، فيُحذَّر في كل محاولة ولا يُغلق أبدًا —
            // الحبس عينه من باب آخر. اللقطة قبل النداء تحسمه.
            const warned = closeWarned;
            const wrote = (await session?.flush()) ?? { settled: true as const };
            if (!wrote.settled) {
              // **الرفض مرةً واحدة، لا سجنًا.**
              //
              // كان كل طلب إغلاق يُرفض بلا حدّ: ⌘Q يبثّ هذا المستمع
              // نفسه، و`close_declined` يعيد تسليح مزلاجَي النواة،
              // فيُرفض الزر الأحمر و⌘W كذلك. فلم يبقَ للكاتب إلا
              // الإنهاء القسري — وهو ما يقتل النسخة الوحيدة من نصّه،
              // أي الخسارة عينها التي وُضع الرفض ليمنعها.
              //
              // والحدّ الصادق أن يُرفض **مرة**، وأن يُقال له ثمنُ
              // الإصرار، ثم يُحترم إصراره: «فرصة استرجاع صريحة» (§٥)
              // فرصةٌ لا حبس، ومن أُبلغ ثم أصرّ اختار عن علم.
              if (!warned) {
                // **التحذير يُرى أو لا يكون تحذيرًا.** `problem` يُرسم
                // داخل إطار المحرر وحده، وشاشة الإعدادات وورقة الخط
                // تغطّيانه بخلفية معتِمة و`inert` يُخرجه من شجرة
                // الوصول — فيُرسم حيث لا عين ولا قارئ شاشة. فتُغلق
                // الطبقة التي تحجبه قبل عرضه: بلا هذا كان الكاتب
                // يضغط ⌘Q مرتين ولا يرى شيئًا، ثم يُهدَم على نصّه.
                settings = false;
                fontSheet = false;

                // **السبب يُقال كما هو.** «كنتَ ما تزال تكتب» ليس عطلَ
                // قرص، ووصفُه بعلاج المساحة والأذونات يرسل الكاتب يفتّش
                // عن عطلٍ سليم — وشريط الحالة يقول «محفوظ» في اللحظة ذاتها.
                if (wrote.because === "refused") {
                  fail(
                    "لم يُغلَق Luma: نصّك لم يصل القرص بعد",
                    "نصّك محفوظ في الذاكرة والمحاولة مستمرة. أفرغ مساحة على القرص أو تحقّق من الأذونات، ثم أغلق مرة أخرى. وإن أغلقتَ مرة أخرى وهو لم يصل، ضاع ما لم يُحفَظ — فانسخه قبلها إن أردت.",
                  );
                } else {
                  fail(
                    "لم يُغلَق Luma: نصّك ما زال يصل القرص",
                    "لا عطل — آخر ما كتبته في الطريق. أمهله لحظة ثم أغلق مرة أخرى. وإن أغلقتَ وهو لم يصل، ضاع آخر ما كتبت.",
                  );
                }
                closeWarned = true;
                // المزلاج في النواة يُفتح، وإلا مرّت المحاولة التالية بلا
                // حفظ أصلًا فأُغلق التطبيق على النص نفسه الذي رفضنا فقده.
                await call("close_declined");
                return;
              }

              // أصرّ بعد أن قرأ: يمضي الإغلاق، ولا يُحبس في تطبيقه.
              console.warn(
                `[luma] إغلاق بإصرار الكاتب ومحتوًى لم يصل القرص (${wrote.because})`,
              );
            }
          // ⚠️ **الإغلاق لا يكنس الفارغ بعد** — الوصل معلَّق، والشرح في
          // `session.ts` عند `open()`. وأخطرُ ما منعه التعليق هنا:
          // الإغلاق أثناء معاينة نسخة كان يمحو المستند وسجله كاملًا
          // والنصّ معروضٌ على الشاشة — المعاينة لا تمسّ البُفر فيُقرأ
          // فارغًا وهو ليس كذلك عند صاحبه.
            try {
              const { getCurrentWindow } = await import("@tauri-apps/api/window");
              await getCurrentWindow().destroy();
            } catch (e) {
              // تعذّر الهدم بعد حفظٍ ناجح: يُفتح المزلاج وإلا مرّت
              // المحاولة التالية بلا حفظ. ويُقال للكاتب: نافذةٌ ترفض
              // الإغلاق بلا سبب معلن أسوأ من خطأ مكتوب.
              fail(
                "لم يُغلَق Luma",
                "وصل نصّك القرص، لكن إغلاق النافذة تعثّر. أعد المحاولة.",
              );
              await call("close_declined");
            }
          } finally {
            // يُحرَّر الحارس دائمًا: نسخةٌ عالقة تمنع كل إغلاق تالٍ
            closing = false;
          }
        }),
      );

      // **الآن فقط** تعلم النواة أن ثمّة من يستقبل طلب الإغلاق.
      await call("ui_ready");
    } catch (e) {
      console.error("[luma] تعذّر ربط أحداث النواة:", e);
    }

    // المرساة أول ما يتاح الجسر: قبلها لا سبيل إلى ساعة النواة
    try {
      startupAnchor = {
        process: await call<number>("startup_elapsed_ms"),
        local: performance.now(),
      };
    } catch {
      startupAnchor = null;
    }

    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      appVersion = await getVersion();
    } catch {
      appVersion = "";
    }
    try {
      dataDir = await call<string>("data_dir");
    } catch {
      dataDir = "";
    }

    // موضع أزرار النظام يُقاس ولا يُفترض — ADR ٠٠٠٣.
    try {
      const x = await call<number | null>("window_controls_x");
      if (typeof x === "number") {
        document.documentElement.dataset.windowControls =
          x < window.innerWidth / 2 ? "left" : "right";
      }
    } catch (e) {
      console.error("[luma] تعذّر قياس موضع أزرار النافذة:", e);
    }

    // التفضيلات أولًا: الثيم يُطبَّق قبل أول رسم للمحتوى فلا وميض
    try {
      const stored = await call<Record<string, unknown>>("load_preferences");
      preferences.hydrate(stored, document.documentElement, (value) => {
        void call("save_preferences", { value });
      });
      theme.hydrate(preferences.value.themeId);
    } catch {
      preferences.hydrate({}, document.documentElement, () => {});
      theme.hydrate(undefined);
    }

    marks["prefs"] = performance.now();

    // **الخطوط قبل أول رسم للنص.**
    // مستندٌ يُفتح من المكتبة بخط مستورد يُرسم به لا ببديله، وخطٌّ اختفى
    // من النظام يجب أن يعود إلى Almarai قبل أن يراه المستخدم — §٨.
    await refreshFonts();
    marks["fonts"] = performance.now();

    // نقطة الاستقبال قبل كل عمل مؤجَّل — الشرح عند نداء `ui_ready`.

    const selftest = await call<boolean>("selftest_mode");

    if (selftest) {
      /**
       * **الفحص الذاتي لا يلمس مستند المستخدم.**
       *
       * الفحص يكتب عبر مسار الإدخال الحقيقي (`insertText`) — وهذا هو
       * الغرض منه. لكن ذلك المسار يمرّ بـ`onChange` ثم بالجلسة ثم
       * بالحفظ التلقائي، فيُنشئ مستندات حقيقية في مكتبة المستخدم.
       * الجلسة تُفصل قبل البدء فلا يجد الحفظ ما يكتبه. أما اختبارات
       * التخزين فتنادي النواة مباشرةً بمعرّفاتها.
       */
      session.dispose();
      session = null;
    }
    // كل تشغيل يفتح مساحة كتابة نظيفة — لا استئناف: `Luma.md` §٤ (ADR ٠٠١٧)
    editor.focus();
    // كانت `restored`؛ ولا يُستعاد شيء منذ إلغاء الاستئناف — والعلامة
    // هي لحظة جاهزية المؤشر، وهي ما تقيسه ميزانية `openToCaret`.
    marks["caret"] = performance.now();

    if (selftest) {
      try {
        const { runSelfTest } = await import("./dev/selftest");
        const checks = await runSelfTest(editor, host, call, startupMarks());
        // رقم المرحلة من البيئة لا من الكود: كان مثبَّتًا فكتب «٥» في
        // ملف أدلة المرحلة ٦.
        const phase = Number(await call<string>("selftest_phase")) || null;
        const failed = checks.filter((c) => !c.passed).length;
        await call("write_report", {
          json: JSON.stringify(
            { phase, passed: checks.length - failed, failed, checks },
            null,
            2,
          ),
        });
      } catch (e) {
        await call("write_report", {
          json: JSON.stringify(
            {
              phase: Number(await call<string>("selftest_phase")) || null,
              failed: -1,
              error: String(e),
              stack: (e as Error)?.stack,
            },
            null,
            2,
          ),
        });
      }
    }

    if (await call<boolean>("gallery_mode")) {
      gallery = true;
    }

    // مشهد بصري يُطلب بالاسم — أداة تحقق لا تُشحن، ولا تغني عن
    // التجربة اليدوية بالماوس ولوحة المفاتيح.
    const stage = await call<string>("demo_stage");
    if (stage) {
      if (stage === "library" || stage === "history") {
        await toggleSurface(stage);
      } else if (stage === "preview") {
        await toggleSurface("history");
        const first = revisions[0];
        if (first) await preview(first.id);
      } else if (stage === "count") {
        preferences.set("showWordCount", true);
        count = editor.wordCount;
      } else if (stage === "comfort") {
        enterComfort();
      } else if (stage.startsWith("settings")) {
        const part = stage.split(":")[1];
        if (part) settingsSection = part as SettingsSectionId;
        await openSettings();
      } else if (stage === "fonts") {
        await openSettings();
        settingsSection = "writing";
        fontSheet = true;
      }
    }

    if (await call<boolean>("demo_mode")) {
      preferences.set("showWordCount", true);
      const { buildLongDocument } = await import("./dev/corpus");
      const doc: Block[] = buildLongDocument(20000);
      // **لا يُمرَّر على الجلسة:** كان يفعل، فيُحفظ مستند العرض
      // البصري (٢٠ ألف كلمة مولَّدة) مستندًا حقيقيًا في مكتبة
      // المستخدم. العرض البصري لا يحتاج حفظًا أصلًا.
      editor.setBlocks(doc);
      count = editor.wordCount;
      editor.focus();

      // تحقق بصري: تمرير إلى الوسط ثم تحديد المستند كاملًا.
      // يمرّ التحديد بمسار الإدخال الأصلي فيتولّاه المحرر — ضبط
      // نطاق DOM مباشرةً يُلغيه المحرر عند أول مزامنة.
      await new Promise((r) => setTimeout(r, 300));
      const sc = document.querySelector(".scroller");
      if (sc) sc.scrollTop = Math.round(sc.scrollHeight / 2);
      document.execCommand("selectAll");
    }
  });

  onDestroy(() => {
    for (const c of cleanups) c();
    clearTimeout(debutTimer);
    session?.dispose();
    editor.destroy();
  });
</script>

{#if gallery}
  <Gallery />
{:else}
  <EditorShell
    {title}
    {saveState}
    {saveDebut}
    showSaveStatus={previewId === null}
    activeSurface={surface}
    ontoggle={toggleSurface}
    onnew={newDocument}
    oncomfort={enterComfort}
    wordCount={count}
    showWordCount={prefs.showWordCount}
    {comfort}
    inert={settings}
    zenHidden={comfort && prefs.zenEnabled && zenHidden}
    bind:host={hostEl}
    bind:scroller={scrollerEl}
    onblankpointer={(x, y) => editor.placeCaretNear(x, y)}
  >
    {#snippet panel()}
      {#if surface === "library"}
        <LibraryPanel
          {documents}
          {damaged}
          {now}
          {currentId}
          onopen={openDocument}
        />
      {:else if surface === "history"}
        <HistoryPanel
          {revisions}
          {now}
          {previewId}
          {restoring}
          liveWordCount={count}
          onpreview={preview}
          onrestore={restore}
        />
      {/if}
    {/snippet}

    {#snippet comfortExit()}
      <Button kind="ghost" size="sm" onclick={exitComfort} data-exit-comfort>
        إنهاء المحرر المريح — {isolate("Esc")}
      </Button>
    {/snippet}

    {#snippet selectionBar()}
      {#if selection && !settings}
        <!-- يصعد من أسفل ويهبط إليه — «ease-out للظهور» §١١. -->
        <div in:surfaceIn={{ rise: 8 }} out:surfaceOut={{ rise: 8 }}>
          <SelectionToolbar
            {role}
            {strong}
            onrole={(r) => {
              editor.setRole(r);
              syncSelection();
            }}
            onstrong={() => {
              editor.toggleStrong();
              syncSelection();
            }}
            onquote={() => {
              editor.wrapInQuotes();
              syncSelection();
            }}
          />
        </div>
      {/if}
    {/snippet}

    {#snippet comfortBar()}
      {#if comfort}
        <!-- «كل طبقة تُطفأ من الشريط السفلي أو من الإعدادات» — الصفحة ١١.
             ثلاث رقاقات لا لوحة تحكم: §٧ يمنع اللوحة داخل الوضع. -->
        <!-- الترتيب نفسه الذي في الإعدادات: الآلة الكاتبة فالتركيز
             فـZen. كان مقلوبًا هنا، فمن بنى خريطته الذهنية في أحد
             الموضعين وجدها معكوسة في الآخر. -->
        <ToggleChip
          label="الآلة الكاتبة"
          on={prefs.typewriterEnabled}
          onclick={() => setPref("typewriterEnabled", !prefs.typewriterEnabled)}
        />
        <ToggleChip
          label="التركيز"
          on={prefs.focusEnabled}
          onclick={() => setPref("focusEnabled", !prefs.focusEnabled)}
        />
        <ToggleChip
          label={isolate("Zen")}
          name="Zen"
          on={prefs.zenEnabled}
          onclick={() => setPref("zenEnabled", !prefs.zenEnabled)}
        />
      {/if}
    {/snippet}

    {#snippet notice()}
      {#if problem}
        <Alert kind="critical" title={problem.title} detail={problem.detail} />
      {/if}
      {#if previewAt !== null}
        <Alert
          kind="info"
          title="أنت تعاين نسخة {sinceLabel(previewAt, now)} — للقراءة فقط"
          detail="اختر «النسخة الحالية» في السجل للعودة إلى نصّك."
        />
      {/if}
    {/snippet}
  </EditorShell>

  <!-- زر المحرر المريح عائم في الزاوية — يعود في هذه المرحلة ومعه
       سلوكه: ⌃⌘F يفعل الشيء نفسه. -->
  {#if settings}
    <SettingsScreen
      {prefs}
      section={settingsSection}
      {fonts}
      version={appVersion}
      {dataDir}
      onsection={(id) => (settingsSection = id)}
      onchange={setPref}
      onpickfont={() => (fontSheet = true)}
      onclose={closeSettings}
      onproject={openProjectPage}
      inert={fontSheet}
    />
    {#if fontSheet}
      <FontSheet
        {fonts}
        selected={prefs.fontFamily}
        {importing}
        error={fontError}
        onselect={chooseFont}
        onimport={importFont}
        onclose={closeFontSheet}
      />
    {/if}
  {/if}

{/if}

<style>
</style>
