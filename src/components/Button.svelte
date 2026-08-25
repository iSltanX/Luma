<script lang="ts">
  import type { Snippet } from "svelte";
  /**
   * زر — أربعة أنواع × ست حالات (`92:125`).
   *
   * كل حالة **حالة في الكود** لا لقطة تصميم — قاعدة تسليم الصفحة ١٧:
   * hover و active و focus-visible و disabled و loading.
   *
   * الأساسي = `accent-text` + `text-on-accent`. **لا `accent-graphic`
   * خلفيةً خلف نص** — §٩ **ثابت**.
   */
  let {
    kind = "primary",
    size = "md",
    loading = false,
    disabled = false,
    type = "button",
    onclick,
    children,
    ...rest
  }: {
    kind?: "primary" | "secondary" | "ghost" | "destructive";
    size?: "lg" | "md" | "sm";
    loading?: boolean;
    disabled?: boolean;
    type?: "button" | "submit";
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  } & Record<string, unknown> = $props();
</script>

<button
  {type}
  class="btn {kind} {size}"
  class:luma-hit={size === "sm"}
  disabled={disabled || loading}
  aria-busy={loading ? "true" : undefined}
  {onclick}
  {...rest}
>
  {#if loading}<span class="spinner" aria-hidden="true"></span>{/if}
  <span class="label">{@render children()}</span>
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-008);
    font: var(--text-ui-08);
    letter-spacing: 0;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    cursor: pointer;
    transition: background-color var(--motion-quick) ease, border-color var(--motion-quick) ease;
  }
  .lg { min-height: var(--size-btn-lg); padding-inline: var(--space-020); }
  .md { min-height: var(--size-btn-md); padding-inline: var(--space-016); }
  .sm { min-height: var(--size-btn-sm); padding-inline: var(--space-012); }

  .primary { background: var(--accent-text); color: var(--text-on-accent); }
  /* التمرير **لا** يحوّل التعبئة إلى `accent-graphic`: نصّ الزر عليها
     ٣٫٦٠ · ٣٫٦٥ · ٣٫٦٦ · ٣٫٦٣ · ٤٫٠٦ — دون ٤٫٥ في الثيمات الخمسة كلها.
     التعبئة تُعمَّق نحو `text/primary`، وهو نقيض `text/on-accent` في كل
     ثيم (فاتح على داكن أو العكس)، فالتباين يزيد ولا ينقص أيًّا كان
     الثيم. والحدّ أثرٌ ظاهر لا يعتمد على دعم `color-mix`: من لا يدعمها
     يرى الحدّ ويبقى النص عند ٥٫٤١ فأعلى. */
  .primary:hover:not(:disabled) {
    border-color: var(--accent-graphic);
    background: color-mix(in srgb, var(--accent-text) 88%, var(--text-primary));
  }

  .secondary {
    background: var(--surface-paper);
    color: var(--text-primary);
    border-color: var(--border-control);
  }
  .secondary:hover:not(:disabled) { background: var(--surface-sunken); }

  .ghost { background: transparent; color: var(--accent-text); }
  .ghost:hover:not(:disabled) { background: var(--accent-subtle); }

  /* التحذيري لإجراء متلف فقط */
  .destructive { background: var(--state-critical); color: var(--text-on-accent); }
  .destructive:hover:not(:disabled) { filter: brightness(1.08); }

  /* حلقة التركيز: إطار ٢px بإزاحة ٢px — لا تُلغى أبدًا */
  .btn:focus-visible {
    outline: var(--size-focus-ring) solid var(--accent-graphic);
    outline-offset: var(--size-focus-offset);
  }

  .btn:active:not(:disabled) { transform: translateY(0.5px); }

  /* المعطل مستثنى من التباين */
  .btn:disabled { opacity: 0.45; cursor: default; }

  .spinner {
    width: 12px; height: 12px; border-radius: var(--radius-full);
    border: 1.4px solid currentColor;
    border-inline-start-color: transparent;
    animation: spin 800ms linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .spinner { animation: none; }
    .btn { transition: none; }
  }
</style>
