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
    cannew = true,
    oncomfort,
    ondelete,
    candelete = false,
    onundo,
    onredo,
    canundo = false,
    canredo = false,
  }: {
    entries: readonly SurfaceEntry[];
    active?: string | null;
    ontoggle: (id: string) => void;
    /** يبدأ نصًّا جديدًا. لا يُمرَّر في المحرر المريح فيختفي الزر. */
    onnew?: (() => void) | undefined;
    /**
     * مغادرةٌ جارية أو لا جلسة — الشرط نفسه الذي يمنع `newDocument()`
     * من الدخول (`App.svelte`). افتراضه `true` كي لا يُكسر استدعاءٌ
     * قديم بلا هذا الطرف؛ ومن يمرّر `onnew` عليه أن يمرّره أيضًا —
     * وإلا بقي الزرّ مضيئًا يعد بفعلٍ سيُسقطه `if (busy) return`.
     */
    cannew?: boolean;
    /** يدخل المحرر المريح. لا يُمرَّر وهو مفتوح. */
    oncomfort?: (() => void) | undefined;
    /** يحذف المستند المفتوح — `Luma.md` §٥ **ثابت**. */
    ondelete?: (() => void) | undefined;
    /** ثمّة مستندٌ يُحذف فعلًا. دونه الزرّ معطَّل: لا شيء يُحذف. */
    candelete?: boolean;
    /** تراجع وإعادة — مدخل ثانٍ إلى مكدّس المحرر، §٥ **ثابت**. */
    onundo?: (() => void) | undefined;
    onredo?: (() => void) | undefined;
    /** يتبعان **عمق المكدّس الفعلي** لا وجود الكتابة — `historyReaches`. */
    canundo?: boolean;
    canredo?: boolean;
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
    <!-- **بدء نصّ جديد.** المكتبة تعرض ولا تُنشئ، فمن فرغ من نصّه
         أثناء الجلسة لم يجد إلا أن يمحوه ليبدأ غيره — الزرّ مساره
         (والتشغيل نفسه يفتح مساحة نظيفة منذ ADR ٠٠١٧). الزر عند
         نهاية القراءة في الشريط، حاضرٌ دائمًا وبعيدٌ عن مداخل
         اللوحات فلا يُخلَط بها. -->
    <span data-new-document style:order={entries.length + 2}>
      <IconButton name="add" label="نصّ جديد" disabled={!cannew} onclick={onnew} />
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

  <!-- الفراغ يدفع أفعال المستند إلى نهاية القراءة ويفصلها عن العنقود.
       غير قابل للتركيز، فموضعه في DOM لا يمسّ ترتيب Tab. -->
  <div class="quiet" style:order={entries.length + 4}></div>

  {#if onundo}
    <!-- **التراجع والإعادة بجوار الحذف** — `Luma.md` §٥ **ثابت**.
         ترتيبهما من بداية القراءة: تراجعٌ فإعادةٌ فحذف، فيقع الحذف
         «في أقصى الطرف» كما نصّ القرار، ويسبق التراجعُ الإعادةَ كما
         يُقرآن. وترتيب DOM هو ترتيب Tab هنا، فهما يوافقان المرسوم.

         **ولا يُعكس شكلهما مع RTL** (↶ ↷): دلالتهما زمنية لا اتجاهية،
         بخلاف «رجوع» الذي يشير إلى اليمين لأنه ملاحة. وهما أيقونتان
         متمايزتان لا واحدةٌ مقلوبة، فعكسهما — لو أُريد يومًا — تبديلُ
         مسارَين لا قلبُ محور.

         **مدخل ثانٍ إلى المكدّس الواحد** لا مكدّس ثانٍ: الحالة تتبع
         `undoDepth`/`redoDepth` من `prosemirror-history` نفسه. -->
    <!-- **`mousedown` مُلغى فلا يسرق الزرّ التركيز** — نمط
         `SelectionToolbar` نفسه («لا يسرق التركيز: `mousedown` مُلغى،
         فيبقى المؤشر والتحديد في النص»).

         بدونه يقع إفسادُ نصّ حقيقي، أُعيد إنتاجه على WebKit: النقر
         يُخرج التركيز من المحرر إلى `<body>` (وWebKit لا يُركّز الأزرار
         بالنقر)، فينهار تحديد DOM إلى الإزاحة صفر — والتراجع نفسه صحيح،
         لكن **أول حرف يُكتب بعده يُدسّ في رأس المستند**. وهو يصيب
         بالضبط من بُني له الزرّان: «وصول فأري ظاهر لمن لا يعرف
         الاختصار» (ADR ٠٠١٧ §٤). -->
    <span data-undo style:order={entries.length + 5}>
      <IconButton
        name="undo"
        label="تراجع"
        disabled={!canundo}
        onclick={onundo}
        onmousedown={(e) => e.preventDefault()}
      />
    </span>
  {/if}

  {#if onredo}
    <span data-redo style:order={entries.length + 6}>
      <IconButton
        name="redo"
        label="إعادة"
        disabled={!canredo}
        onclick={onredo}
        onmousedown={(e) => e.preventDefault()}
      />
    </span>
  {/if}

  {#if ondelete}
    <!-- **أفعال المستند عند نهاية القراءة** — `Luma.md` §٥ **ثابت**:
         «في الطرف المقابل لمداخل الأسطح… ثلاثة أزرار حاضرة دائمًا،
         تعمل على المستند المفتوح وحده»، والحذف «في أقصى الطرف».
         (التراجع والإعادة يلحقان به — القرار ٤.)

         **وهذا لا ينقض ما قبله.** أُخرج «نصّ جديد» و«المحرر المريح» من
         هذا الطرف لأنهما كانا **يتيمين** فيه: جزيرتان متباعدتان في
         شريط واحد. وأفعال المستند عنقودٌ ثالث قائم بذاته، وموضعه
         مسجَّل في §٥ — والفرق بين «فعلٍ على المستند» و«مدخل لوحة»
         يستحق طرفًا مستقلًّا كما استحقّ فاصلًا هناك.

         **بلا حوار تأكيد** بقرار §٢٠ مسألة ١٩: «لا يُزيل إلا ما يقرؤه
         الكاتب الآن، والسلّة هي التدارك» — وهي مبنيّة (ADR ٠٠١٩).
         و`IconButton` خافتٌ في سكونه (`text/secondary`) يشتدّ تحت
         المؤشر (`text/primary`)، وهو نصّ القرار حرفًا بحرف: لا لون
         إنذار طُلب ولا يليق بسطحٍ غايته الهدوء.

         **وموضعه في DOM قبل المدخل النشط لا بعده** — كان بعده، فسرق
         منه آخرَ محطة تبويب في الشريط: كشفته مراجعة خصومية على القرار
         ٣ وأعادت إنتاجه في متصفح حقيقي. المدخل النشط يجب أن يبقى آخر
         ما يُركَّز في الشريط لتصل `Tab` بعده إلى اللوحة مباشرةً —
         «اللوحة هي التالية لمدخلها في ترتيب Tab» (`IMPLEMENTATION.md`
         §١٠، والشرح عند اشتقاق `inactive` أعلاه). وأسوأ من كسر
         الترتيب أن يحلّ محلَّه **فعلٌ هادم**: من فتح لوحةً بلوحة
         المفاتيح ثم ضغط `Tab` ظانًّا أنه يدخلها كان يقف على «حذف
         النص». -->
    <span data-delete-document style:order={entries.length + 7}>
      <IconButton
        name="delete"
        label="حذف النص"
        disabled={!candelete}
        onclick={ondelete}
      />
    </span>
  {/if}

  {#if current}
    <!-- المدخل النشط: **آخر ما يُركَّز في الشريط** وموضعه المرسوم
         بـ`order` — الشرح عند اشتقاق `inactive` أعلاه. -->
    <span data-surface={current.id} style:order={slot(current.id)}>
      <IconButton
        name={current.icon}
        label={current.label}
        active
        onclick={(e) => toggle(current.id, e)}
      />
    </span>
  {/if}
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
