<script lang="ts">
  import type { Snippet } from "svelte";
  /** شارة — خمسة أنواع (`100:135`). **لا تنقل حالة حرجة وحدها** (§١٢). */
  let { kind = "neutral", children }:
    { kind?: "accent" | "neutral" | "positive" | "caution" | "critical";
      children: Snippet } = $props();
</script>

<span class="badge {kind}">{@render children()}</span>

<style>
  .badge {
    display: inline-flex; align-items: center;
    min-block-size: 22px; padding-inline: var(--space-008);
    border-radius: var(--radius-full);
    font: var(--text-ui-09); letter-spacing: 0;
  }
  .accent { background: var(--accent-subtle); color: var(--accent-text); }
  .neutral { background: var(--surface-sunken); color: var(--text-secondary); }
  .positive { background: var(--state-positive-bg); color: var(--state-positive); }
  .caution { background: var(--state-caution-bg); color: var(--state-caution); }
  .critical { background: var(--state-critical-bg); color: var(--state-critical); }
</style>
