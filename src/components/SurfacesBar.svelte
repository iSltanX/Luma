<script lang="ts">
  import { tick } from "svelte";
  import IconButton from "./IconButton.svelte";
  import type { SurfaceEntry } from "../lib/surfaces";

  /**
   * شريط الأسطح (`106:111`) — **مدخل واحد لكل لوحة** (§١٠ **ثابت**).
   *
   * المداخل عند بداية القراءة (يمين)، ومكان الأدوات الثانوية عند
   * نهايتها. المكوّن يحتمل الأسطح الخمسة كما في التصميم، ولا يعرض إلا
   * ما نُفِّذ فعلًا: مدخلٌ لا يفتح شيئًا وعدٌ كاذب.
   *
   * المدخل يبدّل: الضغط عليه وهو نشط يغلق اللوحة — «تُغلق من زر ظاهر
   * داخلها أو من المفتاح نفسه» `Luma.md` §٦.
   */
  let {
    entries,
    active = null,
    ontoggle,
    onnew,
    oncomfort,
  }: {
    entries: readonly SurfaceEntry[];
    active?: string | null;
    ontoggle: (id: string) => void;
    /** يبدأ نصًّا جديدًا. لا يُمرَّر في المحرر المريح فيختفي الزر. */
    onnew?: (() => void) | undefined;
    /** يدخل المحرر المريح. لا يُمرَّر وهو مفتوح. */
    oncomfort?: (() => void) | undefined;
  } = $props();

  /**
   * المدخل النشط آخر ترتيب التبويب في الشريط — «وهي التالية لمدخلها
   * في ترتيب Tab» (§١٠): Tab واحدة بعد الفتح تصل أول عنصر في اللوحة،
   * لا أربع تمرّ بأزرار لا تخصّها. النقل في DOM وحده: كل عنصر يحمل
   * `order` بموضعه المرسوم، فلا يتغيّر من الشريط بكسل.
   */
  const inactive = $derived(entries.filter((e) => e.id !== active));
  const current = $derived(entries.find((e) => e.id === active) ?? null);
  const slot = (id: string) => entries.findIndex((e) => e.id === id) + 1;

  let nav = $state<HTMLElement | null>(null);

  /**
   * نقل الزر في DOM يُسقط تركيزه، وصاحب لوحة المفاتيح واقفٌ عليه لحظة
   * الفتح. يُعاد التركيز إلى الزر نفسه — لا إلى اللوحة: «الفتح لا ينقل
   * التركيز» §١٠. والإغلاق يُترك لمساره القائم: العودة إلى النص.
   */
  async function toggle(id: string, e: MouseEvent) {
    const held = document.activeElement === e.currentTarget;
    ontoggle(id);
    if (!held) return;
    await tick();
    if (active === id)
      nav
        ?.querySelector<HTMLButtonElement>(`[data-surface="${id}"] button`)
        ?.focus();
  }
</script>

<nav class="bar luma-chrome" aria-label="الأسطح الجانبية" bind:this={nav}>
  {#each inactive as entry (entry.id)}
    <span data-surface={entry.id} style:order={slot(entry.id)}>
      <IconButton
        name={entry.icon}
        label={entry.label}
        active={false}
        onclick={(e) => toggle(entry.id, e)}
      />
    </span>
  {/each}
  {#if onnew || oncomfort}
    <!-- **الأفعال في عنقود المداخل لا في الطرف المقابل.**
         كانا يتيمين عند نهاية القراءة: جزيرتان متباعدتان في شريطٍ
         واحد تشتّتان العين وتُطيلان مسارها. والعنقود الواحد عند بداية
         القراءة أقصر لعين RTL، والفاصل الرفيع يمنع خلط «مدخل لوحة»
         بـ«فعل» — فرقٌ في المعنى يستحق فرقًا في الشكل. -->
    <span class="sep" aria-hidden="true" style:order={entries.length + 1}></span>
  {/if}

  {#if onnew}
    <!-- **بدء نصّ جديد.** كان التطبيق بلا مسار إليه: الاستئناف يفتح
         الأخير دائمًا، والمكتبة تعرض ولا تُنشئ. فمن فرغ من نصّه لم يجد
         إلا أن يمحوه ليبدأ غيره. الزر عند نهاية القراءة في الشريط،
         حاضرٌ دائمًا وبعيدٌ عن مداخل اللوحات فلا يُخلَط بها. -->
    <span data-new-document style:order={entries.length + 2}>
      <IconButton name="add" label="نصّ جديد" onclick={onnew} />
    </span>
  {/if}

  {#if oncomfort}
    <!-- **مدخل المحرر المريح في الشريط لا عائمًا فوق الورقة.**
         كان زرًّا عائمًا في زاوية مساحة الكتابة، والورقة تتمدّد لتملأ
         ما أُتيح — فيقع الزر على حافة عمود النص. وحافةُ العمود تتحرّك
         مع حشوة الورقة المقيَّدة، فلا إزاحةَ ثابتة تُخليها عند كل عرض.
         وموضعه هنا يُخليها عند كل عرض بلا استثناء. -->
    <span data-comfort-entry style:order={entries.length + 3}>
      <IconButton name="expand" label="المحرر المريح" onclick={oncomfort} />
    </span>
  {/if}

  {#if current}
    <!-- المدخل النشط: آخر الشريط في DOM وموضعه المرسوم بـ`order` —
         الشرح عند اشتقاق `inactive` أعلاه. -->
    <span data-surface={current.id} style:order={slot(current.id)}>
      <IconButton
        name={current.icon}
        label={current.label}
        active
        onclick={(e) => toggle(current.id, e)}
      />
    </span>
  {/if}

  <!-- الطرف المقابل فراغٌ خالص: لا شيء يزاحم النص من هناك -->
  <div class="quiet" style:order={entries.length + 4}></div>
</nav>

<style>
  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-004);
    block-size: var(--size-surfaces-bar);
    padding-inline: var(--space-020);
    background: var(--surface-paper);
    border-block-end: 1px solid var(--border-subtle);
  }
  .quiet {
    flex: 1 1 auto;
  }
  /* فاصل بين المداخل والأفعال — بارتفاع الأيقونة لا بارتفاع الشريط */
  .sep {
    inline-size: 1px;
    block-size: var(--size-icon);
    margin-inline: var(--space-004);
    background: var(--border-subtle);
  }
</style>
