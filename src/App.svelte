<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorCore, emptyDocument, type Block } from "./editor";
  import { words } from "./lib/bidi";
  import Gallery from "./dev/Gallery.svelte";
  import { EditorSession } from "./lib/session";
  import type { SaveState } from "./lib/autosave";
  import SaveStatus from "./components/SaveStatus.svelte";
  import { theme } from "./lib/theme.svelte";
  import { THEMES, type ThemeId } from "./tokens/themes";

  // المرحلة ٣ — الحفظ والاستمرارية.
  // الإطار وشريط الأسطح والمكتبة والثيمات في المرحلتين ٤ و٥.

  let hostEl = $state<HTMLDivElement | null>(null);
  let count = $state(0);
  let title = $state("بدون عنوان");
  let saveState = $state<SaveState>({ kind: "idle" });

  let session: EditorSession | null = null;
  let gallery = $state(false);
  const cleanups: Array<() => void> = [];
  let savePrefs: ((v: Record<string, unknown>) => void) | null = null;

  /** تبديل الثيم: يُطبَّق فورًا ثم يُحفظ. لا انتظار للقرص قبل الرؤية. */
  function pickTheme(id: ThemeId) {
    theme.apply(id);
    savePrefs?.({ themeId: id });
  }

  const editor = new EditorCore({
    onChange: (blocks) => {
      count = blocks.reduce(
        (n, b) => n + (b.text.trim() ? b.text.trim().split(/\s+/).length : 0),
        0,
      );
      session?.handleChange(blocks);
    },
    ariaLabel: "مساحة الكتابة",
  });

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

    let invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    try {
      const core = await import("@tauri-apps/api/core");
      invoke = core.invoke;
    } catch {
      return; // خارج Luma.app — المحرر يعمل بلا تخزين
    }

    // التفضيلات أولًا: الثيم يُطبَّق قبل أول رسم للمحتوى فلا وميض
    try {
      const prefs = await invoke<Record<string, unknown>>("load_preferences");
      theme.hydrate(prefs["themeId"]);
    } catch {
      theme.hydrate(undefined);
    }
    savePrefs = (v) => void invoke("save_preferences", { value: v });

    session = new EditorSession({
      editor,
      bridge: {
        save: (p) => invoke("save_document", { payload: p }),
        load: (id) => invoke("load_document", { id }),
        mostRecent: () => invoke("most_recent_document"),
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

    // تعذُّر الاستئناف لا يمنع الكتابة: تُفتح مساحة جديدة
    try {
      await session.resume();
    } catch (e) {
      console.error("[luma] تعذّر الاستئناف:", e);
    }
    editor.focus();

    if (await invoke<boolean>("selftest_mode")) {
      try {
        const { runSelfTest } = await import("./dev/selftest");
        const checks = await runSelfTest(editor, host, invoke);
        await invoke("write_report", {
          json: JSON.stringify({ phase: 3, checks }, null, 2),
        });
      } catch (e) {
        await invoke("write_report", {
          json: JSON.stringify(
            { phase: 3, error: String(e), stack: (e as Error)?.stack },
            null,
            2,
          ),
        });
      }
    }

    if (await invoke<boolean>("gallery_mode")) {
      gallery = true;
    }

    if (await invoke<boolean>("demo_mode")) {
      const { buildLongDocument } = await import("./dev/corpus");
      const doc: Block[] = buildLongDocument(20000);
      editor.setBlocks(doc);
      session.handleChange(doc);
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
<div class="titlebar luma-chrome" data-tauri-drag-region>
  <span class="title">{title}</span>
  <div class="save"><SaveStatus state={saveState} /></div>
</div>

<div class="scroller">
  <div class="sheet">
    <div class="column" bind:this={hostEl}></div>
  </div>
</div>

{#if count > 0}
  <div class="count luma-chrome">{words(count)}</div>
{/if}

<!-- مبدّل الثيم — مؤقت حتى تصل الإعدادات في المرحلة ٦ -->
<div class="themes luma-chrome">
  {#each THEMES as t (t.id)}
    <button
      type="button" class="tchip" class:on={theme.id === t.id}
      data-theme-switch={t.id} aria-pressed={theme.id === t.id}
      onclick={() => pickTheme(t.id as ThemeId)}
    >{t.name}</button>
  {/each}
</div>
{/if}

<style>
  .titlebar {
    height: var(--size-titlebar);
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    flex: 0 0 auto;
    background: var(--surface-canvas);
    padding-inline: 16px;
  }
  .title {
    grid-column: 2;
    font: var(--text-ui-08);
    letter-spacing: 0;
    color: var(--text-muted);
    max-width: 40ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* حالة الحفظ في الطرف المقابل للعنوان.
     ملاحظة المرحلة ٥: موضع أزرار النافذة يحدده النظام (ADR ٠٠٠٣)،
     فالحشوة المحجوزة يجب أن تتبع جانبها الفعلي لا أن تُثبَّت. */
  .save {
    grid-column: 3;
    justify-self: end;
  }

  /* ── منطقة الكتابة ──────────────────────────────────────────
     مسؤول تمرير **واحد**: `.scroller`. لا ارتفاع ثابت، ولا قصّ،
     ولا طبقة تمرير ثانية.

     كانت شبكة (`grid`) بـ`align-content: stretch`، فكان صفّها يُشدّ
     إلى ارتفاع الحاوية المرئي، و`min-height: 100%` على الورقة يُحلّ
     على مساحة الشبكة لا على ارتفاع المحتوى — فتتوقف خلفية الورقة عند
     حدود النافذة بينما يستمر النص خارجها. الحاوية الآن كتلة عادية،
     فتنمو الورقة مع محتواها ويبقى السطح متصلًا. */
  .scroller {
    flex: 1 1 auto;
    /* بدونه لا ينكمش عنصر المرونة تحت محتواه فلا يُمرَّر شيء */
    min-block-size: 0;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--surface-canvas);
    padding-inline: var(--space-024);
    padding-block: var(--space-020) var(--space-032);
  }

  /* الورقة: بطاقة متصلة على الخلفية، كما في `إطار المحرر` في Figma.
     الحدّ ونصف القطر ليسا زينة — بدونهما تختفي الورقة في «ليل» حيث
     surface/paper وsurface/canvas متقاربان. */
  .sheet {
    inline-size: min(
      100%,
      calc(var(--editor-measure) + var(--size-sheet-pad) * 2)
    );
    margin-inline: auto;
    min-block-size: 100%;
    background: var(--surface-paper);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding-inline: var(--size-sheet-pad);
    padding-block: var(--space-048) 40vh;
  }

  /* الورقة تحمل القياس، فالعمود يملأها. لا تحديد عرض مكرَّر. */
  .column {
    inline-size: 100%;
  }

  /* نوافذ ضيّقة: تنكمش الحشوة قبل أن ينكمش النص */
  @media (max-width: 700px) {
    .scroller {
      padding-inline: var(--space-008);
    }
    .sheet {
      padding-inline: var(--space-024);
    }
  }

  .themes {
    position: absolute;
    inset-block-end: var(--space-012);
    inset-inline-end: var(--space-020);
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

  .count {
    position: absolute;
    inset-block-end: 16px;
    inset-inline-start: 20px;
    font: var(--text-ui-09);
    letter-spacing: 0;
    color: var(--text-muted);
    pointer-events: none;
  }
</style>
