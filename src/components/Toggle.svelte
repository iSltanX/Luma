<script lang="ts">
  /**
   * مفتاح — مبني على `<input type=checkbox>` الأصلي بنمط مخصص، لا
   * عنصر مرسوم: «لأن الوصول والاختصارات يأتيان معها» — §١٢ **ثابت**.
   *
   * **RTL:** التشغيل يحرّك المقبض **يسارًا** — `Luma.md` §١٦.
   */
  let {
    checked = $bindable(false), label, disabled = false,
  }: { checked?: boolean; label: string; disabled?: boolean } = $props();
</script>

<label class="wrap" class:disabled>
  <input type="checkbox" bind:checked {disabled} />
  <span class="track" aria-hidden="true"><span class="knob"></span></span>
  <span class="text">{label}</span>
</label>

<style>
  .wrap {
    display: inline-flex; align-items: center; gap: var(--space-012);
    /* منطقة نقر ٤٤×٤٤ */
    min-block-size: 44px; cursor: pointer;
  }
  .wrap.disabled { opacity: 0.45; cursor: default; }
  input { position: absolute; opacity: 0; inline-size: 0; block-size: 0; }

  .track {
    inline-size: var(--size-toggle-w); block-size: var(--size-toggle-h);
    border-radius: var(--radius-full); background: var(--surface-sunken);
    /* border-control هو الحدّ الوحيد المسموح أن يعرّف عنصر تحكم */
    border: 1px solid var(--border-control);
    display: flex; align-items: center; padding: 1px;
    transition: background-color 140ms ease, border-color 140ms ease;
  }
  .knob {
    inline-size: var(--size-toggle-knob); block-size: var(--size-toggle-knob);
    border-radius: var(--radius-full); background: var(--surface-paper);
    /* يبدأ يمينًا (إيقاف) ويتحرك يسارًا (تشغيل) في RTL */
    margin-inline-start: auto;
    transition: margin 140ms ease;
  }
  input:checked + .track {
    background: var(--accent-graphic); border-color: var(--accent-graphic);
  }
  input:checked + .track .knob { margin-inline-start: 0; margin-inline-end: auto; }

  input:focus-visible + .track {
    outline: var(--size-focus-ring) solid var(--accent-graphic);
    outline-offset: var(--size-focus-offset);
  }
  .text { font: var(--text-ui-07); letter-spacing: 0; color: var(--text-primary); }
  @media (prefers-reduced-motion: reduce) {
    .track, .knob { transition: none; }
  }
</style>
