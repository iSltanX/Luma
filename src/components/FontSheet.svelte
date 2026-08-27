<script lang="ts">
  import Badge from "./Badge.svelte";
  import Button from "./Button.svelte";
  import IconButton from "./IconButton.svelte";
  import Alert from "./Alert.svelte";
  import Radio from "./Radio.svelte";
  import { untrack } from "svelte";
  import {
    coverageBadge,
    coverageLabel,
    coverageNotice,
    sourceLabel,
    type FontReference,
    type FontSource,
  } from "../lib/fonts";
  import { fontStack } from "../lib/preferences.svelte";
  import { surfaceIn, surfaceOut } from "../lib/transitions";
  import { isolate } from "../lib/bidi";

  /**
   * ورقة اختيار خط الكتابة (`127:436`).
   *
   * ثلاثة تبويبات للمصادر الثلاثة، وقائمة بأزرار اختيار، ومعاينة حيّة
   * بالخط المحدَّد، واستيراد من ملف.
   *
   * **التغطية معلومة لا مرشِّح** (§٨ **ثابت**): الخطوط اللاتينية تُعرض
   * بشارتها ولا تُخفى، «لأن المنتج ثنائي اللغة في الرؤية» §١١.
   */
  let {
    fonts,
    selected,
    importing = false,
    error = null,
    onselect,
    onimport,
    onclose,
  }: {
    fonts: readonly FontReference[];
    selected: string;
    importing?: boolean;
    error?: string | null;
    onselect: (font: FontReference) => void;
    onimport: () => void;
    onclose: () => void;
  } = $props();

  const TABS: FontSource[] = ["imported", "system", "bundled"];

  /**
   * يفتح التبويب الذي فيه الخط المختار، لا الأول دائمًا.
   *
   * `untrack` لأن هذه قيمة ابتدائية لا مشتقّة: بعدها التبويب يتبع
   * المستخدم، ولا يقفز كلما تغيّرت قائمة الخطوط.
   */
  let tab = $state<FontSource>(
    untrack(() => fonts.find((f) => f.id === selected)?.source ?? "bundled"),
  );

  const shown = $derived(fonts.filter((f) => f.source === tab));
  const active = $derived(fonts.find((f) => f.id === selected) ?? null);
  const notice = $derived(active ? coverageNotice(active) : null);

  /**
   * مجموعة أزرار الاختيار.
   *
   * `<input type=radio>` أصلي بنمط مخصص — §١٢ **ثابت**: الأسهم بين
   * الخيارات والإعلان لقارئ الشاشة يأتيان مع العنصر. حدث `change`
   * يصعد من الحقل، فيُلتقط على الحاوية مرة واحدة.
   */
  let group = $state("");
  // تُزامَن نزولًا: الاستيراد يختار الخط الجديد من الأب، فيتبعه الزر
  $effect(() => {
    group = selected;
  });

  /**
   * تنقّل التبويبات بالأسهم — عُرف `tablist` وما يوجبه `role="tab"`.
   *
   * إعلانُ الدور بلا سلوكه أسوأ من عدم إعلانه: قارئ الشاشة يقول
   * «تبويب ١ من ٣» فينتظر المستخدم الأسهم ولا تعمل. والتركيز متنقّل
   * (`roving tabindex`) كما في `SelectionToolbar`: محطة `Tab` واحدة
   * للمجموعة كلها لا ثلاث.
   *
   * **الأسهم معكوسة في RTL**: `ArrowLeft` يتقدّم لأن التالي يسارًا.
   */
  function onTabKeys(e: KeyboardEvent) {
    const step = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const i = TABS.indexOf(tab);
    const next = TABS[(i + step + TABS.length) % TABS.length]!;
    tab = next;
    // التركيز يتبع الاختيار — نمط `automatic activation` في ARIA
    queueMicrotask(() =>
      document.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus(),
    );
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onclose();
    }
  }

  /**
   * جذر الورقة — **يستقبل التركيز عند الفتح**.
   *
   * الورقة تعلو شاشة الإعدادات، وتلك تصير `inert` تحتها. بلا نقل
   * التركيز هنا يبقى في عنصرٍ خرج للتوّ من الشجرة فيسقط إلى `<body>`،
   * فلا يجد `Tab` من أين يبدأ ولا يصل `Esc` معالجًا.
   */
  let root = $state<HTMLElement | null>(null);
  $effect(() => {
    root?.focus();
  });
</script>

<!-- الحاجب: نقرة خارج الورقة تغلقها، وهو أيضًا ما يمنع الوصول إلى ما
     تحتها بالفأرة. التركيز لا يُحبس داخلها — §١٠ **ثابت**. -->
<div
  class="scrim"
  role="presentation"
  onclick={onclose}
  onkeydown={onkeydown}
  in:surfaceIn
  out:surfaceOut
></div>

<!--
  الورقة تصعد قليلًا وهي تظهر. و`base` يحمل تحويل التمركز: الإزاحة
  تُكتب في `transform` نفسه، فبدونه يُلغى التمركز أثناء الحركة فتقفز
  الورقة إلى طرف النافذة ثم تعود.
-->
<div
  class="sheet"
  in:surfaceIn={{ rise: 8, base: "translateX(50%) " }}
  out:surfaceOut={{ rise: 8, base: "translateX(50%) " }}
  role="dialog"
  aria-modal="true"
  aria-label="اختيار خط الكتابة"
  data-font-sheet
  bind:this={root}
  tabindex={-1}
  {onkeydown}
>
  <header class="head">
    <h2 class="title">اختيار خط الكتابة</h2>
    <span class="spacer"></span>
    <IconButton name="close" label="إغلاق اختيار الخط" onclick={onclose} />
  </header>

  <!-- المعالج على الأزرار لا على الحاوية: الحاوية ليست هدف تركيز،
       والمفتاح يصل من الزر المركَّز عليه أصلًا. -->
  <div class="tabs" role="tablist" aria-label="مصادر الخطوط">
    {#each TABS as t (t)}
      <button
        type="button"
        role="tab"
        class="tab luma-hit"
        class:on={tab === t}
        aria-selected={tab === t}
        aria-controls="luma-font-list"
        tabindex={tab === t ? 0 : -1}
        data-tab={t}
        onclick={() => (tab = t)}
        onkeydown={onTabKeys}
      >
        {sourceLabel(t)}
      </button>
    {/each}
  </div>

  <div
    class="list"
    id="luma-font-list"
    role="tabpanel"
    aria-label={sourceLabel(tab)}
    onchange={() => {
      const picked = fonts.find((f) => f.id === group);
      if (picked) onselect(picked);
    }}
  >
    {#if shown.length === 0}
      <p class="empty">
        {tab === "imported"
          ? `لم تستورد خطًّا بعد. استورد ملف ${isolate("OTF")} أو ${isolate("TTF")} من زر الاستيراد.`
          : "لا خطوط في هذا المصدر."}
      </p>
    {:else}
      {#each shown as font (font.id)}
        <div class="row" data-font={font.id}>
          <!-- يملأ الصف: كان الصف يبدو قابلًا للنقر بعرضه كله ولا
               يستجيب إلا فوق اسم الخط ودائرته. -->
          <Radio
            bind:group
            name="luma-font"
            value={font.id}
            label={font.familyName}
            block
          />
          <span class="spacer"></span>
          <Badge kind={coverageBadge(font.arabicCoverage)}>
            {coverageLabel(font.arabicCoverage)}
          </Badge>
        </div>
      {/each}
    {/if}
  </div>

  <div class="preview">
    <p class="label">معاينة</p>
    <p class="sample" style:font-family={fontStack(active?.familyName ?? "")}>
      أبجد هوّز حطّي كلمن سعفص قرشت ثخذ ضظغ — ٠١٢٣٤٥٦٧٨٩
    </p>
    <p class="sample small" style:font-family={fontStack(active?.familyName ?? "")}>
      تَشْكِيلٌ كَامِلٌ لِاخْتِبَارِ الحَرَكَاتِ — Mixed العربية and English
    </p>
    {#if error}
      <Alert kind="critical" title="تعذّر استيراد الخط" detail={error} />
    {:else if notice}
      <Alert kind="caution" title="تغطية عربية ناقصة" detail={notice} />
    {/if}
  </div>

  <footer class="foot">
    <Button kind="secondary" loading={importing} onclick={onimport} data-import>
      استيراد خط من ملف…
    </Button>
    <span class="spacer"></span>
    <Button kind="primary" onclick={onclose}>تم</Button>
  </footer>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 3;
    /* الحاجب فارقُ سطح لا لون مكتوب: طبقة الرموز بلا رمز ظلّ */
    background: var(--surface-canvas);
    opacity: 0.72;
  }
  .sheet {
    position: fixed;
    inset-block: var(--space-048);
    inset-inline-start: 50%;
    transform: translateX(50%);
    inline-size: min(600px, calc(100vw - var(--space-064)));
    z-index: 4;
    display: flex;
    flex-direction: column;
    background: var(--surface-paper);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    /* الظل العميق — «للنوافذ الحوارية» (اللغة البصرية §٦). حوارٌ يطفو
       فوق شاشةٍ كاملة، وارتفاعه هو ما يقول إنها تحته لا خلفه. */
    box-shadow: var(--shadow-deep);
    overflow: hidden;
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-012);
    min-block-size: var(--size-surfaces-bar);
    padding-inline: var(--space-016) var(--space-012);
    background: var(--surface-raised);
    border-block-end: 1px solid var(--border-subtle);
  }
  .title {
    font: var(--text-ui-08);
    letter-spacing: 0;
    margin: 0;
    color: var(--text-primary);
  }
  .spacer {
    flex: 1 1 auto;
  }

  .tabs {
    flex: none;
    display: flex;
    gap: var(--space-004);
    padding: var(--space-012) var(--space-016);
    border-block-end: 1px solid var(--border-subtle);
  }
  .tab {
    min-block-size: var(--size-btn-sm);
    padding-inline: var(--space-012);
    border-radius: var(--radius-full);
    border: 1px solid transparent;
    background: none;
    color: var(--text-secondary);
    font: var(--text-ui-09);
    letter-spacing: 0;
    cursor: pointer;
  }
  .tab:hover {
    background: var(--surface-sunken);
    color: var(--text-primary);
  }
  .tab.on {
    background: var(--accent-subtle);
    border-color: var(--accent-graphic);
    color: var(--accent-text);
  }
  .tab:focus-visible {
    outline: var(--size-focus-ring) solid var(--accent-graphic);
    outline-offset: var(--size-focus-offset);
  }

  .list {
    flex: 1 1 auto;
    min-block-size: 0;
    overflow-y: auto;
    padding: var(--space-008) var(--space-012);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-012);
    min-block-size: var(--space-040);
    padding-inline: var(--space-012);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .row:hover {
    background: var(--surface-sunken);
  }
  .empty {
    font: var(--text-ui-09);
    letter-spacing: 0;
    color: var(--text-muted);
    padding: var(--space-016);
    margin: 0;
  }

  .preview {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-008);
    padding: var(--space-016);
    border-block-start: 1px solid var(--border-subtle);
    background: var(--surface-sunken);
  }
  .label {
    font: var(--text-ui-10);
    letter-spacing: 0;
    color: var(--text-muted);
    margin: 0;
  }
  /* المعاينة بمقاس المستخدم وتباعده، لا بمقاسٍ مكتوب هنا: غايتها أن
     يرى كيف سيبدو نصّه — ومعاينةٌ بمقاسٍ آخر تُري شيئًا لا يكتبه. */
  .sample {
    margin: 0;
    font-size: var(--luma-editor-size);
    line-height: var(--luma-editor-leading);
    letter-spacing: 0;
    color: var(--editor-ink);
  }
  .sample.small {
    /* ٪٨٠ من مقاس المستخدم — لكن لا دون أرضية ١٢ نقطة (CLAUDE.md
       بند ٤): أصغر مقاسٍ ممكن للخط (١٤px) × ٪٨٠ = ١١٫٢px، فكان
       نصٌّ عربي مشكَّل يُرسم دون الحدّ في شاشة مشحونة — والمسوح
       الآلية لا تصل هذه اللوحة (docs/audit/AUDIT-2026-08-27.md). */
    font-size: max(12px, calc(var(--luma-editor-size) * 0.8));
  }

  .foot {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-012);
    padding: var(--space-016);
    background: var(--surface-raised);
    border-block-start: 1px solid var(--border-subtle);
  }
</style>
