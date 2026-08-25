<script lang="ts">
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons";
  /** إشعار عابر — ثلاثة أنواع (`104:137`). **واحد في كل وقت، لا يتراكم** (§١٢). */
  let { kind = "neutral", text, action = "", onclick }:
    {
      kind?: "neutral" | "success" | "critical";
      text: string;
      /** نصّ الإجراء. **لا يُمرَّر بلا `onclick`** — زرٌّ لا يفعل شيئًا
          واجهةٌ لميزة غير موجودة (§١٢ **ثابت**). */
      action?: string;
      onclick?: () => void;
    } = $props();
  const ICON: Record<string, IconName | null> = {
    neutral: null, success: "check", critical: "error",
  };
</script>

<div class="toast {kind}" role="status" aria-live="polite">
  {#if ICON[kind]}<Icon name={ICON[kind]!} decorative />{/if}
  <span class="text">{text}</span>
  {#if action}
    <button type="button" class="action luma-hit" {onclick}>{action}</button>
  {/if}
</div>

<style>
  .toast {
    display: inline-flex; align-items: center; gap: var(--space-012);
    min-block-size: 44px; padding-inline: var(--space-016);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    /* الظل المتوسط — «للأدوات العائمة» (§٦) */
    box-shadow: var(--shadow-mid);
    color: var(--text-primary);
    font: var(--text-ui-07); letter-spacing: 0;
  }
  .success { color: var(--state-positive); }
  .critical { color: var(--state-critical); }
  .text { color: var(--text-primary); }
  .action {
    font: var(--text-ui-08); letter-spacing: 0;
    background: none; border: none; cursor: pointer;
    color: var(--accent-text); padding: var(--space-004);
  }
  .action:focus-visible {
    outline: var(--size-focus-ring) solid var(--accent-graphic);
    outline-offset: var(--size-focus-offset);
  }
</style>
