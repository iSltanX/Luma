<script lang="ts">
  /**
   * رقاقة تبديل — مفتاح وضع في المحرر المريح (`123:84`).
   *
   * **إضافة إلى المكتبة لا استثناء في الشاشة.** التصميم يرسم في
   * الصفحة ١١ ثلاث رقاقات لكل طبقة، ولا مقابل لها في الصفحة ١٧: لا
   * `شارة` (غير تفاعلية) ولا `زر أيقونة` (بلا نص). وقاعدة الاستيراد
   * §١٢ **ثابت** تقول إن النقص يُعالَج في المكتبة — فبُنيت هنا مرة
   * واحدة لتُستعمل حيثما لزم.
   *
   * **الحالة لا تُنقل باللون وحده** (§١٧ مبدأ ٩): خلفية، ولون نص،
   * ونقطة ممتلئة أو فارغة، و`aria-pressed` لقارئ الشاشة.
   */
  let {
    label,
    name = label,
    on = false,
    onclick,
  }: {
    label: string;
    /**
     * معرّف ثابت للاختبار.
     *
     * منفصل عن `label` لأن التسمية المعروضة قد تحمل محدِّدات اتجاه
     * (`isolate`) حين يكون فيها مقطع لاتيني — §٧ **ثابت**.
     */
    name?: string;
    on?: boolean;
    onclick: () => void;
  } = $props();
</script>

<button
  type="button"
  class="chip"
  class:on
  aria-pressed={on}
  data-chip={name}
  {onclick}
>
  <span class="dot" class:on aria-hidden="true"></span>
  <span class="label">{label}</span>
</button>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-008);
    min-block-size: var(--size-btn-sm);
    padding-inline: var(--space-012);
    border-radius: var(--radius-full);
    border: 1px solid var(--border-subtle);
    background: var(--surface-paper);
    color: var(--text-secondary);
    font: var(--text-ui-09);
    letter-spacing: 0;
    cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease;
  }
  .chip:hover {
    background: var(--surface-raised);
    color: var(--text-primary);
  }
  .chip.on {
    background: var(--accent-subtle);
    border-color: var(--accent-graphic);
    color: var(--accent-text);
  }
  .chip:focus-visible {
    outline: var(--size-focus-ring) solid var(--accent-graphic);
    outline-offset: var(--size-focus-offset);
  }

  /* النقطة ممتلئة عند التشغيل ومفرَّغة عند الإطفاء — فرقٌ في الشكل
     لا في اللون وحده */
  .dot {
    inline-size: var(--space-008);
    block-size: var(--space-008);
    border-radius: var(--radius-full);
    border: 1px solid currentColor;
  }
  .dot.on {
    background: currentColor;
  }

  @media (prefers-reduced-motion: reduce) {
    .chip {
      transition: none;
    }
  }
</style>
