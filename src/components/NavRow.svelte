<script lang="ts">
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons";
  /** صف تنقل — ثلاث حالات (`114:398`). رمزه الطرفي مؤشر تقدّم، لا سهم رجوع. */
  let { label, icon, active = false, onclick }:
    { label: string; icon?: IconName; active?: boolean; onclick?: () => void } = $props();
</script>

<button type="button" class="row" class:active aria-current={active ? "page" : undefined} {onclick}>
  {#if icon}<Icon name={icon} decorative />{/if}
  <span class="label">{label}</span>
  <span class="chev" aria-hidden="true"><Icon name="back" decorative size={14} /></span>
</button>

<style>
  .row {
    display: flex; align-items: center; gap: var(--space-012);
    inline-size: 100%; min-block-size: 40px;
    padding-inline: var(--space-012);
    background: transparent; border: none; cursor: pointer;
    border-radius: var(--radius-sm);
    color: var(--text-primary); text-align: start;
  }
  .row:hover { background: var(--surface-sunken); }
  /* `accent/subtle` على السطح ١٫١٠–١٫٢٥:١ — فارقٌ لا يكاد يُدرَك، فلا
     يبقى من «النشط» إلا لون النص: معنًى باللون وحده (§١٧ مبدأ ٩). حدّ
     `accent/graphic` إشارةُ شكلٍ فوق ٣:١، وهي الإشارة نفسها التي
     تستعملها `ThemeCard` و`ToggleChip` أصلًا. */
  .row.active {
    background: var(--accent-subtle);
    color: var(--accent-text);
    box-shadow: inset 0 0 0 1px var(--accent-graphic);
  }
  .row:focus-visible {
    outline: var(--size-focus-ring) solid var(--accent-graphic);
    outline-offset: var(--size-focus-offset);
  }
  .label { font: var(--text-ui-07); letter-spacing: 0; flex: 1; }
  /* مؤشر تقدّم لا رجوع: أيقونة «رجوع» مرسومة إلى اليمين، والقلب
     يوجّهها إلى اليسار — جهة التقدّم في RTL (ADR ٠٠٠٨) */
  .chev { color: var(--text-muted); transform: scaleX(-1); }
</style>
