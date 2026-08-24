<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorCore, emptyDocument } from "./editor";
  import { words } from "./lib/bidi";

  // المرحلة ٢ — عرض بالحد الأدنى: ورقة واحدة وعمود نص.
  // الإطار وشريط الأسطح والمكتبة والثيمات في المرحلتين ٤ و٥.

  let hostEl = $state<HTMLDivElement | null>(null);
  let count = $state(0);

  const editor = new EditorCore({
    onChange: (next) => {
      count = next.reduce(
        (n, b) => n + (b.text.trim() ? b.text.trim().split(/\s+/).length : 0),
        0,
      );
    },
    ariaLabel: "مساحة الكتابة",
  });

  let unlisten: (() => void) | undefined;

  onMount(async () => {
    if (!hostEl) return;
    editor.mount(hostEl, emptyDocument());
    editor.focus();

    try {
      const { listen } = await import("@tauri-apps/api/event");
      // مكدّس تراجع واحد: القائمة تبثّ، والمحرر ينفّذ.
      unlisten = await listen<string>("luma://menu", (e) => {
        if (e.payload === "undo") editor.undo();
        else if (e.payload === "redo") editor.redo();
      });

      const { invoke } = await import("@tauri-apps/api/core");

      if (await invoke<boolean>("selftest_mode")) {
        try {
          const { runSelfTest } = await import("./dev/selftest");
          const checks = await runSelfTest(editor, hostEl);
          await invoke("write_report", {
            json: JSON.stringify({ phase: 2, checks }, null, 2),
          });
        } catch (e) {
          // الفشل الصامت يخفي السبب — يُكتب ليُقرأ
          await invoke("write_report", {
            json: JSON.stringify(
              { phase: 2, error: String(e), stack: (e as Error)?.stack },
              null,
              2,
            ),
          });
        }
      }

      if (await invoke<boolean>("demo_mode")) {
        const { buildLongDocument } = await import("./dev/corpus");
        editor.setBlocks(buildLongDocument(20000));
        editor.focus();
      }
    } catch (e) {
      console.error("[luma] تعذّرت تهيئة جسر النواة:", e);
    }
  });

  onDestroy(() => {
    unlisten?.();
    editor.destroy();
  });
</script>

<div class="titlebar" data-tauri-drag-region>
  <span class="title">بدون عنوان</span>
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
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    background: var(--surface-canvas);
  }
  .title {
    font-size: 13px;
    color: var(--text-muted);
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

  /* رقاقة عدّ الكلمات — مخفية حتى يوجد محتوى. الإظهار بالطلب
     وربطها بالإعدادات في المرحلة ٦. Luma.md §٥ */
  .count {
    position: absolute;
    inset-block-end: 16px;
    inset-inline-start: 20px;
    font-size: 12px;
    color: var(--text-muted);
    pointer-events: none;
  }
</style>
