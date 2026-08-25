<script lang="ts">
  import { COLOR_VALUES, type ThemeId } from "../tokens/themes";
  import Icon from "./Icon.svelte";
  /**
   * بطاقة ثيم — خمسة ثيمات × حالتان (`114:489`).
   *
   * المعاينة تقرأ القيم من طبقة الرموز نفسها، **فلا تنحرف عن الثيم
   * الفعلي أبدًا** — وهو ما يفعله المكوّن في Figma بوضع صريح لكل متغيّر.
   * هذا الاستثناء الوحيد لقراءة القيم مباشرةً، لأن البطاقة تعرض ثيمًا
   * غير المطبَّق.
   */
  let { id, name, selected = false, onselect }:
    { id: ThemeId; name: string; selected?: boolean; onselect: (id: ThemeId) => void } = $props();

  const c = $derived(COLOR_VALUES);
</script>

<button
  type="button" class="card" class:selected
  aria-pressed={selected} onclick={() => onselect(id)}
>
  <span
    class="preview"
    style:background={c["surface/canvas"]![id]}
    style:border-color={c["border/subtle"]![id]}
    aria-hidden="true"
  >
    <span class="sheet" style:background={c["surface/paper"]![id]}>
      <span class="line long" style:background={c["editor/ink"]![id]}></span>
      <span class="line" style:background={c["text/muted"]![id]}></span>
      <span class="dot" style:background={c["accent/graphic"]![id]}></span>
    </span>
  </span>
  <span class="foot">
    <span class="name">{name}</span>
    {#if selected}<Icon name="check" label="محدَّد" size={14} />{/if}
  </span>
</button>

<style>
  .card {
    display: flex; flex-direction: column; gap: var(--space-008);
    inline-size: 148px; padding: var(--space-008);
    background: var(--surface-paper);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    /* الظل الخفيف — «للبطاقات» (§٦) */
    box-shadow: var(--shadow-low);
    cursor: pointer; text-align: start;
  }
  /* الصف المحدد = accent-subtle + accent-text — §٩ */
  .card.selected { background: var(--accent-subtle); border-color: var(--accent-graphic); }
  .card:focus-visible {
    outline: var(--size-focus-ring) solid var(--accent-graphic);
    outline-offset: var(--size-focus-offset);
  }
  .preview {
    block-size: 84px; border-radius: var(--radius-xs);
    border: 1px solid; display: flex; align-items: flex-end;
    justify-content: center; padding-block-start: var(--space-012);
    overflow: hidden;
  }
  .sheet {
    inline-size: 78%; block-size: 84%;
    border-start-start-radius: var(--radius-xs);
    border-start-end-radius: var(--radius-xs);
    padding: var(--space-008);
    display: flex; flex-direction: column; gap: 5px; align-items: flex-end;
  }
  .line { block-size: 3px; inline-size: 60%; border-radius: var(--radius-full); opacity: 0.85; }
  .line.long { inline-size: 85%; }
  .dot { inline-size: 10px; block-size: 3px; border-radius: var(--radius-full); }
  .foot { display: flex; align-items: center; justify-content: space-between; gap: var(--space-008); }
  .name { font: var(--text-ui-10); letter-spacing: 0; color: var(--text-primary); }
  .card.selected .name { color: var(--accent-text); }
</style>
