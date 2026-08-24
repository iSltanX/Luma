<script lang="ts">
  import Icon from "./Icon.svelte";
  /**
   * زر المحرر المريح (`103:106`) — ثلاث حالات: عادي، تمرير، تركيز.
   *
   * «زر دائري مستقل في زاوية النافذة» عند **نهاية القراءة** (الزاوية
   * السفلية اليسرى)، بعيدًا عن بدايتها — `Luma.md` §٧.
   *
   * **سلوكه يدخل في المرحلة ٦.** يُعرض هنا معطَّلًا لا عاملًا بلا أثر:
   * زرٌّ يستجيب للنقر ولا يفعل شيئًا يكذب على المستخدم، والمعطَّل يقول
   * الحقيقة ويصل قارئ الشاشة عبر `disabled`.
   */
  let {
    disabled = false,
    onclick,
  }: { disabled?: boolean; onclick?: () => void } = $props();
</script>

<button
  type="button"
  class="comfort luma-chrome"
  aria-label="المحرر المريح"
  data-comfort
  {disabled}
  {onclick}
>
  <Icon name="expand" size={20} decorative />
</button>

<style>
  .comfort {
    position: absolute;
    inset-block-end: var(--space-024);
    /* نهاية القراءة — الزاوية اليسرى في RTL */
    inset-inline-end: var(--space-024);
    inline-size: var(--size-comfort);
    block-size: var(--size-comfort);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    background: var(--surface-paper);
    /* الرفع بفارق السطح وحدّ قوي لا بظل — كما في `شريط التحديد` */
    border: 1px solid var(--border-strong);
    color: var(--text-secondary);
    cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease;
  }
  .comfort:hover:not(:disabled) {
    background: var(--surface-raised);
    color: var(--text-primary);
  }
  .comfort:focus-visible {
    outline: var(--size-focus-ring) solid var(--accent-graphic);
    outline-offset: var(--size-focus-offset);
  }
  .comfort:disabled {
    opacity: 0.45;
    cursor: default;
  }
  @media (prefers-reduced-motion: reduce) {
    .comfort {
      transition: none;
    }
  }
</style>
