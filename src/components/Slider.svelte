<script lang="ts">
  /**
   * منزلق — مبني على `<input type=range>` الأصلي بنمط مخصص.
   * **RTL:** يمتلئ من اليمين — `dir` الموروث يتولّى ذلك في WebKit.
   */
  let {
    value = $bindable(0), min = 0, max = 100, step = 1, label, disabled = false,
    format,
  }: {
    value?: number; min?: number; max?: number; step?: number;
    label: string; disabled?: boolean; format?: (v: number) => string;
  } = $props();
</script>

<div class="wrap" class:disabled>
  <div class="head">
    <span class="label">{label}</span>
    <span class="value">{format ? format(value) : value}</span>
  </div>
  <input
    type="range" bind:value {min} {max} {step} {disabled}
    aria-label={label}
    aria-valuetext={format ? format(value) : String(value)}
  />
</div>

<style>
  .wrap { display: flex; flex-direction: column; gap: var(--space-008); }
  .wrap.disabled { opacity: 0.45; }
  .head { display: flex; justify-content: space-between; align-items: baseline; }
  .label { font: var(--text-ui-07); letter-spacing: 0; color: var(--text-primary); }
  .value { font: var(--text-ui-10); letter-spacing: 0; color: var(--text-muted); }

  input {
    -webkit-appearance: none; appearance: none;
    inline-size: 100%; background: transparent;
    /* منطقة نقر ٣٢ */
    block-size: var(--size-hit); margin: 0; cursor: pointer;
  }
  input::-webkit-slider-runnable-track {
    block-size: var(--size-slider-track);
    border-radius: var(--radius-full);
    background: var(--surface-sunken);
    border: 1px solid var(--border-control);
  }
  input::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    inline-size: var(--size-slider-knob); block-size: var(--size-slider-knob);
    border-radius: var(--radius-full);
    background: var(--accent-graphic);
    border: none;
    margin-block-start: calc(
      (var(--size-slider-track) - var(--size-slider-knob)) / 2 - 1px
    );
  }
  input:focus-visible {
    outline: var(--size-focus-ring) solid var(--accent-graphic);
    outline-offset: var(--size-focus-offset);
  }
  input:disabled { cursor: default; }
</style>
