<script lang="ts">
  import type { Snippet } from "svelte";
  /** صف إعداد — ثلاثة أنواع (`114:382`): مفتاح، منزلق، قيمة. */
  let { label, hint = "", control }:
    { label: string; hint?: string; control: Snippet } = $props();
</script>

<div class="row">
  <div class="text">
    <span class="label">{label}</span>
    {#if hint}<span class="hint">{hint}</span>{/if}
  </div>
  <div class="control">{@render control()}</div>
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
