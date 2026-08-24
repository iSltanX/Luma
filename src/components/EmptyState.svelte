<script lang="ts">
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons";
  /**
   * حالة فارغة داخل لوحة — شكل واحد تستعمله المكتبة والسجل.
   *
   * الشكل نفسه في `لوحة المكتبة` (`110:155`) و`لوحة السجل` (`112:334`):
   * أيقونة ٢٤ ثم سطر يشرح ثم سطر يهدّئ. بُني مرة واحدة بدل نسختين —
   * قاعدة الاستيراد §١٢ **ثابت**.
   */
  let { icon, title, hint }: { icon: IconName; title: string; hint: string } =
    $props();
</script>

<div class="empty">
  <span class="mark"><Icon name={icon} size={24} decorative /></span>
  <p class="title">{title}</p>
  <p class="hint">{hint}</p>
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-008);
    inline-size: 100%;
    padding-inline: var(--space-024);
    /* الحالة الفارغة لا تعلو الترويسة: تبدأ بعد مساحة تنفّس */
    padding-block-start: var(--space-096);
    text-align: center;
  }
  .mark {
    color: var(--text-muted);
  }
  .title {
    font: var(--text-ui-07);
    letter-spacing: 0;
    color: var(--text-secondary);
    margin: 0;
  }
  .hint {
    font: var(--text-ui-09);
    letter-spacing: 0;
    color: var(--text-muted);
    margin: 0;
  }
</style>
