<script lang="ts">
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons";
  /**
   * تنبيه — أربعة أنواع (`104:118`). غير حاجب، ويبقى حتى يُعالج سببه.
   * **كل نوع يحمل أيقونة ونصًّا:** لا معنى يُنقل باللون وحده — §١٧ مبدأ ٩.
   */
  let { kind = "info", title, detail = "" }:
    { kind?: "info" | "success" | "caution" | "critical";
      title: string; detail?: string } = $props();

  const ICON: Record<string, IconName> = {
    info: "info", success: "check", caution: "caution", critical: "error",
  };
  const ROLE: Record<string, string> = {
    info: "معلومة", success: "نجاح", caution: "تنبيه", critical: "خطأ",
  };
</script>

<div class="alert {kind}" role={kind === "critical" ? "alert" : "status"}>
  <span class="icon"><Icon name={ICON[kind]!} label={ROLE[kind]!} /></span>
  <div class="body">
    <strong class="title">{title}</strong>
    {#if detail}<span class="detail">{detail}</span>{/if}
  </div>
</div>

<style>
  .alert {
    display: flex; gap: var(--space-012);
    padding: var(--space-012) var(--space-016);
    border-radius: var(--radius-sm);
    align-items: flex-start;
  }
  .icon { margin-block-start: 2px; flex: none; }
  .body { display: flex; flex-direction: column; gap: 2px; }
  .title { font: var(--text-ui-08); letter-spacing: 0; }
  .detail { font: var(--text-ui-09); letter-spacing: 0; color: var(--text-secondary); }

  .info { background: var(--state-info-bg); color: var(--state-info); }
  .success { background: var(--state-positive-bg); color: var(--state-positive); }
  .caution { background: var(--state-caution-bg); color: var(--state-caution); }
  .critical { background: var(--state-critical-bg); color: var(--state-critical); }
</style>
