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
  import ComfortButton from "./components/ComfortButton.svelte";
  import ToggleChip from "./components/ToggleChip.svelte";
  import Button from "./components/Button.svelte";
  import Alert from "./components/Alert.svelte";
  import { isolate, sinceLabel } from "./lib/bidi";
  import { preferences } from "./lib/preferences.svelte";
  import { typewriterScroll } from "./lib/typewriter";
  import type { FontReference } from "./lib/fonts";
  import { declareImportedFonts } from "./lib/font-faces";
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
  let selection = $state<{ top: number; left: number } | null>(null);
  let role = $state<BlockRole | null>(null);

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
   * الاستئناف، والفتح، وأول محتوى يُنشئ المستند.
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
      currentId = session?.currentId ?? null;
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
  function zenRecede() {
    zenHidden = true;
  }

  function zenReveal() {
    if (!zenHidden) return;
    zenHidden = false;
  }

  function enterComfort() {
    if (comfort) return;
    // إغلاق ما يزاحم: «تختفي المكتبة والقوائم والأدوات» §٧
    exitPreview();
    surface = null;
    settings = false;
    comfort = true;
    editor.setFocusMode(prefs.focusEnabled);
    editor.focus();
    // أول تمركز بعد أن يتّسع التخطيط ويُعاد حساب الحشوة
    requestAnimationFrame(() => runTypewriter());
  }

  /**
   * الخروج **لا يغيّر موضع المؤشر ولا حالة النص** — §٧ **ثابت**.
   *
   * لا يُلمس المحتوى ولا التحديد: تُطفأ طبقة التركيز (وهي عرض بحت)
   * ويعود الإطار بأشرطته.
   */
  function exitComfort() {
    if (!comfort) return;
    comfort = false;
    zenHidden = false;
    editor.setFocusMode(false);
    editor.focus();
  }

  function toggleComfort() {
    if (comfort) exitComfort();
    else enterComfort();
  }

  function syncSelection() {
    const rect = editor.selectionRect();
    if (!rect || !editor.isEditable) {
      selection = null;
      role = null;
      return;
    }
    role = editor.currentRole();
    // إحداثيات النافذة: الشريط ثابت الموضع فلا يزيحه تمرير الورقة أفقيًا
    selection = { top: rect.top, left: rect.left + rect.width / 2 };
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
    if (!(await session.flush())) {
      fail(
        "تعذّرت المعاينة",
        "لم يصل نصّك الحالي إلى القرص بعد، ولا يُستبدل نصٌّ غير محفوظ.",
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
      selection = null;
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
  async function closeSettings() {
    settings = false;
    fontSheet = false;
    await tick();
    // المعاينة تنتهي عند فتح الإعدادات، فالعودة دائمًا إلى قابل للتحرير
    editor.setEditable(true);
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
    // مستندٌ يُستأنف بخط مستورد يجب أن يُرسم به لا ببديله، وخطٌّ اختفى
    // من النظام يجب أن يعود إلى Almarai قبل أن يراه المستخدم — §٨.
    await refreshFonts();
    marks["fonts"] = performance.now();

    session = new EditorSession({
      editor,
      bridge: {
        save: (p) => call("save_document", { payload: p }),
        load: (id) => call("load_document", { id }),
        mostRecent: () => call("most_recent_document"),
      },
      onSaveState: (s) => (saveState = s),
      onTitleChange: (t) => (title = t),
    });

    try {
      const { listen } = await import("@tauri-apps/api/event");

      cleanups.push(
        await listen<string>("luma://menu", (e) => {
          if (e.payload === "undo") editor.undo();
          else if (e.payload === "redo") editor.redo();
          else if (e.payload === "settings") void openSettings();
        }),
      );

      // فقد التركيز محفّز كتابة فورية — §٥
      cleanups.push(await listen("luma://flush", () => void session?.flush()));

      // الإغلاق مؤجَّل: تُكتب آخر دفقة ثم يُغلق فعلًا
      cleanups.push(
        await listen("luma://flush-and-close", async () => {
          preferences.flush();
          // **فرصة استرجاع صريحة عند الإغلاق** — §٥ **ثابت**.
          // النافذة لا تُهدم على تغيير لم يصل القرص: يبقى النص في
          // الذاكرة، وتظهر الحالة والسبب، وإعادة المحاولة مستمرة.
          const saved = (await session?.flush()) ?? true;
          if (!saved) {
            fail(
              "لم يُغلَق Luma: نصّك لم يصل القرص بعد",
              "نصّك محفوظ في الذاكرة والمحاولة مستمرة. أفرغ مساحة على القرص أو تحقّق من الأذونات، ثم أغلق مرة أخرى.",
            );
            // المزلاج في النواة يُفتح، وإلا مرّت المحاولة التالية بلا
            // حفظ أصلًا فأُغلق التطبيق على النص نفسه الذي رفضنا فقده.
            await call("close_declined");
            return;
          }
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().destroy();
        }),
      );
    } catch (e) {
      console.error("[luma] تعذّر ربط أحداث النواة:", e);
    }

    const selftest = await call<boolean>("selftest_mode");

    if (selftest) {
      /**
       * **الفحص الذاتي لا يلمس مستند المستخدم.**
       *
       * الفحص يكتب عبر مسار الإدخال الحقيقي (`insertText`) — وهذا هو
       * الغرض منه. لكن ذلك المسار يمرّ بـ`onChange` ثم بالجلسة ثم
       * بالحفظ التلقائي، فكان يكتب نصّ الفحص **فوق المستند المستأنف**.
       * الجلسة تُفصل قبل البدء ولا يُستأنف شيء، فلا يجد الحفظ ما يكتب
       * فوقه. أما اختبارات التخزين فتنادي النواة مباشرةً بمعرّفاتها.
       */
      session.dispose();
      session = null;
    } else {
      // تعذُّر الاستئناف لا يمنع الكتابة: تُفتح مساحة جديدة
      try {
        await session.resume();
        currentId = session.currentId;
        count = editor.wordCount;
      } catch (e) {
        console.error("[luma] تعذّر الاستئناف:", e);
      }
    }
    editor.focus();
    marks["restored"] = performance.now();

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
      // **لا يُمرَّر على الجلسة:** كان يفعل، فيُكتب مستند العرض
      // البصري (٢٠ ألف كلمة مولَّدة) **فوق مستند المستخدم المستأنف**.
      // العرض البصري لا يحتاج حفظًا أصلًا.
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
    showSaveStatus={previewId === null}
    activeSurface={surface}
    ontoggle={toggleSurface}
    wordCount={count}
    showWordCount={prefs.showWordCount}
    {comfort}
    inert={settings}
    zenHidden={comfort && prefs.zenEnabled && zenHidden}
    typewriterBand={comfort && prefs.typewriterEnabled}
    bind:host={hostEl}
    bind:scroller={scrollerEl}
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

    {#snippet comfortBar()}
      {#if comfort}
        <!-- «كل طبقة تُطفأ من الشريط السفلي أو من الإعدادات» — الصفحة ١١.
             ثلاث رقاقات لا لوحة تحكم: §٧ يمنع اللوحة داخل الوضع. -->
        <ToggleChip
          label={isolate("Zen")}
          name="Zen"
          on={prefs.zenEnabled}
          onclick={() => setPref("zenEnabled", !prefs.zenEnabled)}
        />
        <ToggleChip
          label="التركيز"
          on={prefs.focusEnabled}
          onclick={() => setPref("focusEnabled", !prefs.focusEnabled)}
        />
        <ToggleChip
          label="الآلة الكاتبة"
          on={prefs.typewriterEnabled}
          onclick={() => setPref("typewriterEnabled", !prefs.typewriterEnabled)}
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
  {#if !comfort && !settings}
    <ComfortButton onclick={enterComfort} />
  {/if}

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

  <!-- شريط التحديد يعلو كل شيء بـ`fixed`، فلا يكفي أن يصير الإطار
       `inert` تحته: يُشرَط بالشاشة نفسها. -->
  {#if selection && !settings}
    <div
      class="floating"
      style:top="{selection.top}px"
      style:left="{selection.left}px"
    >
      <SelectionToolbar
        {role}
        onrole={(r) => {
          editor.setRole(r);
          syncSelection();
        }}
        onquote={() => {
          editor.wrapInQuotes();
          syncSelection();
        }}
      />
    </div>
  {/if}

{/if}

<style>
  /* شريط التحديد فوق النص المحدَّد: `fixed` بإحداثيات النافذة، فلا
     يحتاج سلفًا محدَّد الموضع ولا يتأثر بتمرير الورقة. */
  .floating {
    position: fixed;
    /* فوق التحديد بفجوة صغيرة، ومتمركز على منتصفه */
    transform: translate(-50%, calc(-100% - var(--space-008)));
    z-index: 2;
  }

</style>
