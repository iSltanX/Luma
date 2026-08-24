<script lang="ts">
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons";
  /**
   * زر أيقونة — ست حالات (`98:91`)، منها «نشط».
   *
   * **التسمية الوصفية إلزامية** (§٩)، ومنطقة النقر ٣٢×٣٢ فعليًا حتى
   * والرمز ١٦×١٦ — §١٣.
   */
  let {
    name, label, active = false, disabled = false, onclick,
  }: {
    name: IconName; label: string; active?: boolean;
    disabled?: boolean; onclick?: (e: MouseEvent) => void;
  } = $props();
</script>

<button
  type="button" class="ib" class:active aria-label={label}
  aria-pressed={active ? "true" : undefined} {disabled} {onclick}
>
  <Icon {name} decorative />
</button>

<style>
  .ib {
    inline-size: var(--size-hit); block-size: var(--size-hit);
    display: inline-flex; align-items: center; justify-content: center;
    border: none; background: transparent; color: var(--text-secondary);
    border-radius: var(--radius-sm); cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease;
  }
  .ib:hover:not(:disabled) { background: var(--surface-sunken); color: var(--text-primary); }
  .ib:active:not(:disabled) { background: var(--border-subtle); }
  /* إشارة شكل مع اللون — الشرح في `NavRow`. */
  .ib.active {
    background: var(--accent-subtle); color: var(--accent-text);
    box-shadow: inset 0 0 0 1px var(--accent-graphic);
  }
  .ib:focus-visible {
    outline: var(--size-focus-ring) solid var(--accent-graphic);
    outline-offset: var(--size-focus-offset);
  }
  .ib:disabled { opacity: 0.45; cursor: default; }
  @media (prefers-reduced-motion: reduce) { .ib { transition: none; } }
</style>
