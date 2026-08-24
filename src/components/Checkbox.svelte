<script lang="ts">
  import Icon from "./Icon.svelte";
  /** خانة اختيار — ثلاث قيم (`99:94`): محدد، غير محدد، **جزئي**. */
  let {
    checked = $bindable(false), indeterminate = false, label, disabled = false,
  }: {
    checked?: boolean; indeterminate?: boolean; label: string; disabled?: boolean;
  } = $props();
</script>

<label class="wrap" class:disabled>
  <input
    type="checkbox" bind:checked {disabled}
    indeterminate={indeterminate}
    aria-checked={indeterminate ? "mixed" : checked ? "true" : "false"}
  />
  <span class="box" aria-hidden="true">
    {#if indeterminate}<span class="dash"></span>
    {:else if checked}<Icon name="check" decorative size={12} />{/if}
  </span>
  <span class="text">{label}</span>
</label>

<style>
  .wrap {
    display: inline-flex; align-items: center; gap: var(--space-012);
    min-block-size: var(--size-hit); cursor: pointer;
  }
  .wrap.disabled { opacity: 0.45; cursor: default; }
  input { position: absolute; opacity: 0; inline-size: 0; block-size: 0; }
  .box {
    inline-size: 18px; block-size: 18px; flex: none;
    border-radius: var(--radius-xs);
    border: 1px solid var(--border-control);
    background: var(--surface-paper);
    display: flex; align-items: center; justify-content: center;
    color: var(--text-on-accent);
  }
  input:checked + .box, input:indeterminate + .box {
    background: var(--accent-graphic); border-color: var(--accent-graphic);
  }
  .dash { inline-size: 9px; block-size: 1.6px; background: currentColor; }
  input:focus-visible + .box {
    outline: var(--size-focus-ring) solid var(--accent-graphic);
    outline-offset: var(--size-focus-offset);
  }
  .text { font: var(--text-ui-07); letter-spacing: 0; color: var(--text-primary); }
</style>
