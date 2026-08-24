<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorCore, emptyDocument, type Block } from "./editor";
  import { words } from "./lib/bidi";
  import { EditorSession } from "./lib/session";
  import type { SaveState } from "./lib/autosave";
  import SaveStatus from "./components/SaveStatus.svelte";

  // المرحلة ٣ — الحفظ والاستمرارية.
  // الإطار وشريط الأسطح والمكتبة والثيمات في المرحلتين ٤ و٥.

  let hostEl = $state<HTMLDivElement | null>(null);
  let count = $state(0);
  let title = $state("بدون عنوان");
  let saveState = $state<SaveState>({ kind: "idle" });

  let session: EditorSession | null = null;
  const cleanups: Array<() => void> = [];

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

    if (await invoke<boolean>("demo_mode")) {
      const { buildLongDocument } = await import("./dev/corpus");
      const doc: Block[] = buildLongDocument(20000);
      editor.setBlocks(doc);
      session.handleChange(doc);
      editor.focus();
    }
  });

  onDestroy(() => {
    for (const c of cleanups) c();
    session?.dispose();
    editor.destroy();
  });
</script>

<div class="titlebar" data-tauri-drag-region>
  <span class="title">{title}</span>
  <div class="save"><SaveStatus state={saveState} /></div>
</div>

<div class="scroller">
  <div class="sheet">
    <div class="column" bind:this={hostEl}></div>
  </div>
</div>

{#if count > 0}
  <div class="count">{words(count)}</div>
{/if}

<style>
  .titlebar {
    height: var(--titlebar-h);
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    flex: 0 0 auto;
    background: var(--surface-canvas);
    padding-inline: 16px;
  }
  .title {
    grid-column: 2;
    font-size: 13px;
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

  .scroller {
    flex: 1 1 auto;
    overflow-y: auto;
    display: grid;
    grid-template-columns: var(--sheet-w);
    justify-content: center;
    align-content: stretch;
    background: var(--surface-canvas);
  }

  .sheet {
    min-height: 100%;
    padding-inline: var(--sheet-pad);
    padding-block: 80px 40vh;
    background: var(--surface-paper);
  }

  .column {
    max-width: var(--column-w);
    margin-inline: auto;
  }

  .count {
    position: absolute;
    inset-block-end: 16px;
    inset-inline-start: 20px;
    font-size: 12px;
    color: var(--text-muted);
    pointer-events: none;
  }
</style>
