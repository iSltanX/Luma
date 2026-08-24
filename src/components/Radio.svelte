<script lang="ts">
  /** زر اختيار — قيمتان × ثلاث حالات (`99:104`). */
  let {
    group = $bindable<string>(), value, label, disabled = false,
  }: { group?: string; value: string; label: string; disabled?: boolean } = $props();
</script>

<label class="wrap" class:disabled>
  <input type="radio" bind:group {value} {disabled} />
  <span class="dot" aria-hidden="true"></span>
  <span class="text">{label}</span>
</label>

<style>
  .wrap {
    display: inline-flex; align-items: center; gap: var(--space-012);
    min-block-size: var(--size-hit); cursor: pointer;
  }
  .wrap.disabled { opacity: 0.45; cursor: default; }
  input { position: absolute; opacity: 0; inline-size: 0; block-size: 0; }
  .dot {
    inline-size: 18px; block-size: 18px; flex: none;
    border-radius: var(--radius-full);
    border: 1px solid var(--border-control);
    background: var(--surface-paper);
    display: flex; align-items: center; justify-content: center;
  }
  input:checked + .dot::after {
    content: ""; inline-size: 8px; block-size: 8px;
    border-radius: var(--radius-full); background: var(--accent-graphic);
  }
  input:checked + .dot { border-color: var(--accent-graphic); }
  input:focus-visible + .dot {
    outline: var(--size-focus-ring) solid var(--accent-graphic);
    outline-offset: var(--size-focus-offset);
  }
  .text { font: var(--text-ui-07); letter-spacing: 0; color: var(--text-primary); }
</style>
