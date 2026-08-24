<script lang="ts">
  import type { Snippet } from "svelte";
  /**
   * صف إعداد — ثلاثة أنواع (`114:382`): مفتاح، منزلق، قيمة.
   *
   * **التلميح يصل قارئ الشاشة.** الصف يحمل الشرح («يُطبَّق فورًا»،
   * «بين ١٫٤ و٢٫٢») وعنصر التحكم يحمل الاسم وحده، فكان الشرح يُرى
   * ولا يُسمع. `aria-describedby` على الوعاء يربطهما — §١٣.
   */
  let { label, hint = "", control }:
    { label: string; hint?: string; control: Snippet } = $props();

  /** معرّف فريد لكل صف: التلميحات كثيرة والمعرّف لا يتكرر. */
  const hintId = `luma-hint-${crypto.randomUUID().slice(0, 8)}`;
</script>

<div class="row">
  <div class="text">
    <span class="label">{label}</span>
    {#if hint}<span class="hint" id={hintId}>{hint}</span>{/if}
  </div>
  <div class="control" aria-describedby={hint ? hintId : undefined}>
    {@render control()}
  </div>
</div>

<style>
  .row {
    display: flex; align-items: center; justify-content: space-between;
    gap: var(--space-024); min-block-size: 64px;
    padding-inline: var(--space-016);
    border-block-end: 1px solid var(--border-subtle);
  }
  .text { display: flex; flex-direction: column; gap: 2px; }
  .label { font: var(--text-ui-07); letter-spacing: 0; color: var(--text-primary); }
  .hint { font: var(--text-ui-09); letter-spacing: 0; color: var(--text-muted); }
  .control { flex: none; }
</style>
