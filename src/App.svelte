<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorCore, emptyDocument, type Block, type BlockRole } from "./editor";
  import Gallery from "./dev/Gallery.svelte";
  import { EditorSession } from "./lib/session";
  import type { SaveState } from "./lib/autosave";
  import { theme } from "./lib/theme.svelte";
  import { THEMES, type ThemeId } from "./tokens/themes";
  import EditorShell from "./components/EditorShell.svelte";
  import LibraryPanel from "./components/LibraryPanel.svelte";
  import HistoryPanel from "./components/HistoryPanel.svelte";
  import SelectionToolbar from "./components/SelectionToolbar.svelte";
  import Alert from "./components/Alert.svelte";
  import { sinceLabel } from "./lib/bidi";
  import type {
    DocumentCard,
    LibraryListing,
    RevisionCard,
  } from "./lib/library";
  import type { SurfaceId } from "./lib/surfaces";

  // المرحلة ٥ — الإطار والأسطح.
  //
  // هذا الملف **يوصّل ولا يصمّم**: كل شكل مكوّن من `src/components/`،
  // وكل قاعدة سلوك من `Luma.md`. المحرر المريح والإعدادات في المرحلة ٦.

  type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

  let hostEl = $state<HTMLElement | null>(null);
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

  // ── شريط التحديد ───────────────────────────────────────────
  let selection = $state<{ top: number; left: number } | null>(null);
  let role = $state<BlockRole | null>(null);

  let showWordCount = $state(false);
  let gallery = $state(false);
  /** مبدّل الثيم المؤقت: أداة تحقق لا عنصر منتج — الإعدادات مرحلة ٦. */
  let devTools = $state(false);

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

  function pickTheme(id: ThemeId) {
    theme.apply(id);
    void invoke?.("save_preferences", { value: { themeId: id } });
  }

  /**
   * عدّ الكلمات **عند الحاجة فقط**.
   *
   * العدّاد مخفي افتراضيًا، والسجل يعرض العدد الحيّ وهو مفتوح. وعدّ
   * مستندٍ كامل مع كل ضغطة مفتاح — وهو ما كان يجري — عملٌ يُرمى في
   * الحالة الغالبة، ويُحسّ تلعثمًا على النص الطويل.
   */
  const countIsVisible = $derived(showWordCount || surface === "history");

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
    },
    // التحديد يقرّر ظهور الشريط: نصٌّ محدَّد يُظهره، وأول حرف يُكتب
    // يطوي التحديد فيختفي. «يختفي عند استئناف الكتابة» — §٥ **ثابت**.
    onSelectionChange: () => syncSelection(),
    ariaLabel: "مساحة الكتابة",
  });

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
      // فشل الفتح يترك المستند الحالي كما هو — §١٧ مبدأ ٤
      console.error("[luma] تعذّر فتح المستند:", e);
      return;
    }
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
    // الحالة الحيّة تصل القرص قبل أي استبدال في المحرر
    await session.flush();
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
    } catch (e) {
      // «تعذُّر قراءة نسخة قديمة لا يؤثر في المستند الحالي» — §٩
      console.error("[luma] تعذّرت قراءة النسخة:", e);
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
      editor.focus();
    } catch (e) {
      console.error("[luma] تعذّرت الاستعادة:", e);
    } finally {
      restoring = false;
    }
  }

  // ── لوحة المفاتيح ──────────────────────────────────────────

  function onKeydown(e: KeyboardEvent) {
    // «Esc يغلق أي لوحة مفتوحة» — §١٠ **ثابت**
    if (e.key === "Escape" && surface !== null) {
      e.preventDefault();
      closeSurface();
    }
  }

  onMount(async () => {
    // معرض المكونات على طبقة الويب — لـPlaywright وحده
    if (new URLSearchParams(location.search).has("gallery")) {
      gallery = true;
      return;
    }
    if (!hostEl) return;
    const host = hostEl;
    editor.mount(host, emptyDocument());
    editor.focus();

    window.addEventListener("keydown", onKeydown);
    cleanups.push(() => window.removeEventListener("keydown", onKeydown));

    // خارج `Luma.app` — على خادم التطوير — يعمل المحرر بلا تخزين.
    //
    // الفحص على جسر Tauri نفسه لا على نجاح الاستيراد: الحزمة تُستورد
    // في المتصفح بلا خطأ ثم يفشل أول `invoke` — فكان الفرع الخطأ يُتَّخذ
    // ويُترك وعدٌ مرفوض بلا معالج.
    if (!("__TAURI_INTERNALS__" in window)) {
      devTools = true;
      return;
    }

    const core = await import("@tauri-apps/api/core");
    invoke = core.invoke;
    const call = core.invoke;

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
      const prefs = await call<Record<string, unknown>>("load_preferences");
      theme.hydrate(prefs["themeId"]);
      showWordCount = prefs["showWordCount"] === true;
    } catch {
      theme.hydrate(undefined);
    }

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
        }),
      );

      // فقد التركيز محفّز كتابة فورية — §٥
      cleanups.push(await listen("luma://flush", () => void session?.flush()));

      // الإغلاق مؤجَّل: تُكتب آخر دفقة ثم يُغلق فعلًا
      cleanups.push(
        await listen("luma://flush-and-close", async () => {
          await session?.flush();
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

    if (selftest) {
      try {
        const { runSelfTest } = await import("./dev/selftest");
        const checks = await runSelfTest(editor, host, call);
        await call("write_report", {
          json: JSON.stringify({ phase: 5, checks }, null, 2),
        });
      } catch (e) {
        await call("write_report", {
          json: JSON.stringify(
            { phase: 5, error: String(e), stack: (e as Error)?.stack },
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
      devTools = true;
      if (stage === "library" || stage === "history") {
        await toggleSurface(stage);
      } else if (stage === "preview") {
        await toggleSurface("history");
        const first = revisions[0];
        if (first) await preview(first.id);
      } else if (stage === "count") {
        showWordCount = true;
        count = editor.wordCount;
      }
    }

    if (await call<boolean>("demo_mode")) {
      devTools = true;
      showWordCount = true;
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
    {showWordCount}
    bind:host={hostEl}
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

    {#snippet notice()}
      {#if previewAt !== null}
        <Alert
          kind="info"
          title="أنت تعاين نسخة {sinceLabel(previewAt, now)} — للقراءة فقط"
          detail="اختر «النسخة الحالية» في السجل للعودة إلى نصّك."
        />
      {/if}
    {/snippet}
  </EditorShell>

  {#if selection}
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

  {#if devTools}
    <!-- مبدّل الثيم — أداة تحقق، لا يظهر في التطبيق العادي -->
    <div class="themes luma-chrome">
      {#each THEMES as t (t.id)}
        <button
          type="button"
          class="tchip"
          class:on={theme.id === t.id}
          data-theme-switch={t.id}
          aria-pressed={theme.id === t.id}
          onclick={() => pickTheme(t.id as ThemeId)}>{t.name}</button
        >
      {/each}
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

  .themes {
    position: absolute;
    inset-block-end: var(--space-012);
    inset-inline-end: var(--space-096);
    display: flex;
    gap: var(--space-004);
  }
  .tchip {
    font: var(--text-ui-10);
    letter-spacing: 0;
    padding: var(--space-004) var(--space-008);
    min-block-size: var(--size-btn-sm);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-control);
    background: var(--surface-paper);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .tchip.on {
    background: var(--accent-subtle);
    color: var(--accent-text);
    border-color: var(--accent-graphic);
  }
  .tchip:focus-visible {
    outline: var(--size-focus-ring) solid var(--accent-graphic);
    outline-offset: var(--size-focus-offset);
  }
</style>
