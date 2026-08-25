<script lang="ts">
  import Icon from "./Icon.svelte";
  /**
   * حقل بحث المكتبة — ثلاث حالات (`111:223`): عادي، تركيز، ممتلئ.
   *
   * «أيقونة البحث في الطرف الأيمن (بداية القراءة في RTL)، وزر المسح في
   * الطرف الأيسر ويظهر عند وجود نص.» الترتيب منطقي لا مكتوب بالجهات:
   * الأيقونة أول العنصر، وزر المسح آخره.
   *
   * `<input>` أصلي بنمط مخصص — §١٢ **ثابت**: الوصول والاختصارات
   * (والإملاء الأصلي، و`⌘A`، و`Esc`) تأتي مع العنصر لا تُبنى فوقه.
   */
  let {
    value = $bindable(""),
    label = "ابحث في نصوصك",
    placeholder = "ابحث في نصوصك…",
  }: {
    value?: string;
    label?: string;
    placeholder?: string;
  } = $props();

  let input = $state<HTMLInputElement | null>(null);

  function clear() {
    value = "";
    input?.focus();
  }
</script>

<div class="field" class:filled={value !== ""}>
  <span class="lead" aria-hidden="true"><Icon name="search" decorative /></span>
  <input
    bind:this={input}
    bind:value
    type="search"
    aria-label={label}
    {placeholder}
    onkeydown={(e) => {
      // Esc داخل الحقل يمسح الكلمة أولًا. والحقل الفارغ **يترك المفتاح
      // يصعد** فيغلق الإطارُ اللوحةَ — لا اختطاف ولا معالج ثانٍ.
      if (e.key !== "Escape" || value === "") return;
      e.stopPropagation();
      clear();
    }}
  />
  {#if value !== ""}
    <button type="button" class="clear" onclick={clear} aria-label="مسح البحث">
      <Icon name="close" size={14} decorative />
    </button>
  {/if}
</div>

<style>
  .field {
    display: flex;
    align-items: center;
    gap: var(--space-008);
    inline-size: 100%;
    block-size: var(--size-btn-md);
    padding-inline: var(--space-012);
    background: var(--surface-sunken);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-sm);
    transition: border-color var(--motion-quick) ease;
  }
  /* حلقة التركيز على الحاوية لأن الحدّ عليها — والحقل بلا حدّ خاص به */
  .field:focus-within {
    outline: var(--size-focus-ring) solid var(--accent-graphic);
    outline-offset: var(--size-focus-offset);
    border-color: var(--accent-graphic);
  }
  .lead {
    color: var(--text-muted);
    flex: none;
  }
  input {
    flex: 1 1 auto;
    min-inline-size: 0;
    /* **المدخل يملأ ارتفاع الحقل.** بدونه صندوقه ٢٤px داخل حقل يبدو
       ٣٦: الحاوية `div` لا `label`، فالنقر فوق الحشوة لا يصل المدخل
       ولا يركّزه. مُقاسًا: ٢٣٧×٢٤ — تحت عتبة ٣٢ في §١٣. */
    align-self: stretch;
    font: var(--text-ui-07);
    letter-spacing: 0;
    color: var(--text-primary);
    background: none;
    border: none;
    outline: none;
    padding: 0;
  }
  input::placeholder {
    color: var(--text-muted);
  }
  /* زر المسح الأصلي في WebKit يرسم شكله الخاص — الشكل هنا من المكتبة */
  input::-webkit-search-cancel-button {
    display: none;
  }
  /* الرمز ١٤ ومنطقة النقر ٣٢×٣٢ — الحد الأدنى في §١٣ لا يُخفَّض للجمال */
  .clear {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: var(--size-hit);
    block-size: var(--size-hit);
    /* تعويض عرض منطقة النقر حتى يبقى الرمز على حافة الحقل بصريًا */
    margin-inline-end: calc(var(--space-008) * -1);
    padding: 0;
    border: none;
    border-radius: var(--radius-full);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }
  .clear:hover {
    color: var(--text-primary);
  }
  .clear:focus-visible {
    outline: var(--size-focus-ring) solid var(--accent-graphic);
    outline-offset: var(--size-focus-offset);
  }
  @media (prefers-reduced-motion: reduce) {
    .field {
      transition: none;
    }
  }
</style>
