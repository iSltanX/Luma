<script lang="ts">
  import type { Snippet } from "svelte";
  import { cubicIn, cubicOut } from "svelte/easing";
  import type { TransitionConfig } from "svelte/transition";
  import { span } from "../lib/transitions";
  import { MOTION } from "../tokens/motion";
  import SurfacesBar from "./SurfacesBar.svelte";
  import SaveStatus from "./SaveStatus.svelte";
  import Badge from "./Badge.svelte";
  import { words } from "../lib/bidi";
  import { OPEN_SURFACES, SURFACES, type SurfaceId } from "../lib/surfaces";
  import type { SaveState } from "../lib/autosave";

  /**
   * إطار المحرر (`106:97`) — **يُبنى مرة واحدة، وكل شاشة منتج نسخة منه**
   * (§١٢ **ثابت**). لا شاشة تعيد رسم الإطار لنفسها.
   *
   * التخطيط: شريط نافذة ٤٨، شريط أسطح ٥٢، ثم جسم فيه عمود اللوحة عند
   * بداية القراءة ومساحة الكتابة فيما بقي.
   *
   * **قاعدة اللوحة الواحدة** (§١٠ **ثابت**): فتح لوحة يضيف عمودًا ٣٢٠
   * ويعيد تمركز عمود النص فيما بقي. **الورقة لا يتغيّر عرضها**، فلا
   * يُعاد لفّ السطور ولا يتغيّر ارتفاع المحتوى — وهذا وحده ما يجعل
   * موضع التمرير محفوظًا بالبناء لا بحيلة تعيده بعد التغيير.
   *
   * الإطار لا يفتح لوحة ولا يغلقها: يبثّ `ontoggle` ويعرض ما يُعطى له.
   */
  let {
    title,
    saveState,
    saveDebut = false,
    showSaveStatus = true,
    activeSurface = null,
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
    wordCount = 0,
    showWordCount = false,
    comfort = false,
    inert = false,
    zenHidden = false,
    host = $bindable<HTMLElement | null>(null),
    scroller = $bindable<HTMLElement | null>(null),
    onblankpointer,
    panel,
    notice,
    comfortBar,
    comfortExit,
    selectionBar,
  }: {
    title: string;
    saveState: SaveState;
    /** الظهور الأول لـ«محفوظ» في مستند جديد — `FEEL-PLAN` M0 (ج). */
    saveDebut?: boolean;
    /** يختفي مؤشر الحفظ أثناء معاينة نسخة — `Luma.md` §٩ **ثابت**. */
    showSaveStatus?: boolean;
    activeSurface?: SurfaceId | null;
    ontoggle: (id: string) => void;
    /** بدء نصّ جديد — لا يُمرَّر في المحرر المريح فيختفي الزر. */
    onnew?: (() => void) | undefined;
    /** مغادرةٌ جارية أو لا جلسة — القاعدة نفسها التي على `candelete`. */
    cannew?: boolean;
    /** دخول المحرر المريح — لا يُمرَّر وهو مفتوح. */
    oncomfort?: (() => void) | undefined;
    /** حذف المستند المفتوح — `Luma.md` §٥ **ثابت**. */
    ondelete?: (() => void) | undefined;
    /** ثمّة مستندٌ يُحذف فعلًا. دونه الزرّ معطَّل. */
    candelete?: boolean;
    /** تراجع وإعادة — `Luma.md` §٥ **ثابت**. */
    onundo?: (() => void) | undefined;
    onredo?: (() => void) | undefined;
    canundo?: boolean;
    canredo?: boolean;
    wordCount?: number;
    /** **مخفي افتراضيًا** ويظهر بطلب المستخدم — `Luma.md` §٥ **ثابت**. */
    showWordCount?: boolean;
    /**
     * المحرر المريح — **غلاف واحد لا شاشة ثانية** (`Luma.md` §٧).
     *
     * الإطار نفسه يطوي أشرطته ولوحاته بدل أن تُركَّب شجرة أخرى:
     * تركيب شجرة ثانية يعني تفكيك `EditorCore` وإعادة بنائها، وضياع
     * المؤشر والتحديد ومكدّس التراجع في كل دخول وخروج.
     */
    comfort?: boolean;
    /**
     * يُخرج الإطار كلّه من مسار التركيز ومن شجرة الوصول.
     *
     * تُرفع حين تعلوه شاشة تغطّي النافذة (الإعدادات). بدونها يبقى
     * المحرر المحجوب أول محطات `Tab`، **وتصله الكتابة فعلًا** فيُكتب
     * في مستند المستخدم وهو لا يراه — وهذا مسّ بسلامة النص قبل أن
     * يكون مسألة وصول (§١٣، وثابت «سلامة النص أولًا»).
     */
    inert?: boolean;
    /** طبقة Zen: تتراجع العناصر أثناء الكتابة وتعود عند الحاجة. */
    zenHidden?: boolean;
    host?: HTMLElement | null;
    scroller?: HTMLElement | null;
    /**
     * نقر أصاب صندوق الورقة نفسه لا عمود النص — هامشها الجانبي، إذ لا
     * يتّسع عمود النص ليبلغه (`Luma.md`: عرض الورقة لا يتغيّر، §١٠).
     * الإطار لا يعرف ProseMirror فيبثّ الإحداثيات ولا يفسّرها.
     */
    onblankpointer?: (clientX: number, clientY: number) => void;
    panel?: Snippet;
    notice?: Snippet;
    comfortBar?: Snippet;
    comfortExit?: Snippet;
    /** شريط تنسيق النص المحدَّد — يرسو أسفل المساحة، §٥. */
    selectionBar?: Snippet;
  } = $props();

  /** اسم اللوحة لقارئ الشاشة — بديل الترويسة المحذوفة. */
  const panelName = $derived(
    SURFACES.find((s) => s.id === activeSurface)?.label ?? "لوحة جانبية",
  );

  /**
   * دخول اللوحة وخروجها — «تنساب المساحات الفرعية لتستقر حوله وتختفي
   * بسلاسة» (مبادئ التجربة ٠٨)، بمدّة اللوحات الجانبية من جدول §١١.
   *
   * الانزلاق بهامش سالب لا بعرض متغيّر: عرض اللوحة ثابت فلا يُعاد لفّ
   * محتواها أثناء الحركة، والورقة لا يتغيّر عرضها (§١٠) بل تنزاح
   * بسلاسة إلى تمركزها الجديد. ولذلك لا يستعمل `surfaceIn` المشترك:
   * ذاك يتلاشى ويصعد، وهذه تنزلق من طرفها.
   */
  const panelCss = (t: number) =>
    `margin-inline-start: calc(var(--size-panel) * ${t - 1}); opacity: ${t};`;

  function panelIn(_node: Element): TransitionConfig {
    return { duration: span(MOTION.surface), easing: cubicOut, css: panelCss };
  }

  function panelOut(_node: Element): TransitionConfig {
    // دخول المحرر المريح يطوي اللوحة فورًا: انسحابها البطيء داخل
    // مشهدٍ تبدّل كاملًا ضجيج لا انسياب.
    //
    // ولا تلتقط نقرًا وهي ذاهبة: نقرةٌ بعد الإغلاق مباشرةً كانت تصيب
    // صفَّ مستندٍ في لوحةٍ يراها المستخدم تنسحب — الشرح في
    // `lib/transitions.ts`.
    return {
      duration: span(MOTION.surface, comfort),
      easing: cubicIn,
      css: (t) => `${panelCss(t)} pointer-events: none;`,
    };
  }
</script>

<div class="shell" class:comfort {inert}>
  <!-- **شريط النافذة قائم في الوضعين، وشريط الأسطح ينطوي.**
       كان الوضعان شجرتين تتبادلان مكانهما، فيقع أكبر تحوّل في المنتج
       قطعًا واحدًا. الآن يبقى شريط السحب حيث هو — وهو منطقة السحب في
       الحالين — ويذوب سطحه وما يحمله، بينما ينطوي شريط الأسطح
       بارتفاعه. و`inert` يُخرج ما انطوى من التركيز ومن القراءة،
       فلا يبقى للقارئ الآلي ما لا يراه صاحبه — §٧. -->
  <header
    class="titlebar luma-chrome"
    data-tauri-drag-region
    inert={comfort || undefined}
  >
    <span class="title">{title}</span>
    {#if showSaveStatus}
      <div class="save"><SaveStatus state={saveState} debut={saveDebut} /></div>
    {/if}
  </header>

  <div class="surfaces" inert={comfort || undefined}>
    <SurfacesBar
      entries={OPEN_SURFACES}
      active={activeSurface}
      {ontoggle}
      onnew={onnew ?? undefined}
      {cannew}
      oncomfort={oncomfort ?? undefined}
      ondelete={ondelete ?? undefined}
      {candelete}
      onundo={onundo ?? undefined}
      onredo={onredo ?? undefined}
      {canundo}
      {canredo}
    />
  </div>

  {#if comfort}
    {#if saveState.kind === "failed"}
      <!-- **الفشل وحده يخترق المحرر المريح.** §٧ يخفي «المكتبة
           والقوائم والأدوات»، ولا يخفي أن نصّك لم يصل القرص: ذاك ليس
           أداة بل حالة النص نفسه، وسلامةُ النص تعلو كل خاصية ثانوية.
           ولا يخفيه Zen: صمتٌ عن الفشل ليس هدوءًا. -->
      <div class="fail luma-chrome" data-comfort-save-failed>
        <SaveStatus state={saveState} />
      </div>
    {/if}

    {#if comfortExit}
      <!-- وسيلة الخروج **ظاهرة دائمًا** ولا تعتمد على حركة المؤشر
           وحدها — §٧ **ثابت**. عند نهاية القراءة (الزاوية اليسرى)
           بعيدًا عن أول السطر. -->
      <div class="exit luma-chrome" class:hidden={zenHidden}>
        {@render comfortExit()}
      </div>
    {/if}
  {/if}

  <div class="body">
    {#if panel && activeSurface !== null && !comfort}
      <!-- اللوحة أولًا في الشجرة: هي عند بداية القراءة بصريًا، وهي
           التالية لمدخلها في ترتيب التركيز — فمن فتحها بلوحة المفاتيح
           يصلها بـTab واحدة. ولا حبس تركيز فيها — §١٠ **ثابت**. -->
      <aside class="panel" aria-label={panelName} in:panelIn out:panelOut>
        {@render panel()}
      </aside>
    {/if}

    <div class="writing">
      {#if notice}<div class="notice">{@render notice()}</div>{/if}

      <div class="scroller" bind:this={scroller}>
        <!-- نقرٌ أصاب صندوق الورقة نفسه — لا العمود ولا أي عنصر داخله —
             يعني الهامش الجانبي: `e.target === e.currentTarget` وحدها
             تميّزه، إذ يلتقط العمود نقره أصلًا حين يقع داخل حدوده.
             `preventDefault` يمنع بدء سحب-تحديد على خلفية لا نص فيها.
             `role="presentation"`: هذا صندوقٌ زخرفي، والمحرر الفعلي
             القابل للوصول هو `.column` بداخله، ببطاقته الخاصة. -->
        <div
          class="sheet"
          role="presentation"
          onmousedown={(e) => {
            if (e.target !== e.currentTarget || !onblankpointer) return;
            e.preventDefault();
            onblankpointer(e.clientX, e.clientY);
          }}
        >
          <div class="column" bind:this={host}></div>
        </div>
      </div>

      {#if selectionBar}
        <!-- **مكانٌ ثابت لا طوفٌ فوق التحديد.**
             «تظهر أدوات التنسيق عند تحديد النص وتختفي عند استئناف
             الكتابة، **بنمط ثابت** لا يجعل استعادتها غامضة» — §٥
             **ثابت**. والمكان الواحد أوفى بذلك من موضعٍ يتنقّل مع كل
             تحديد، ولا يحجب السطر الذي فوقه، ولا يزاحم نطاق الآلة
             الكاتبة. ولا شريط دائم: الوعاء نفسه لا يُركَّب بلا تحديد. -->
        <div class="selection-bar luma-chrome">
          {@render selectionBar()}
        </div>
      {/if}

      {#if comfortBar}
        <div class="comfort-bar luma-chrome" class:hidden={zenHidden}>
          {@render comfortBar()}
        </div>
      {/if}

      {#if showWordCount && !comfort}
        <div class="count luma-chrome"><Badge>{words(wordCount)}</Badge></div>
      {/if}
    </div>
  </div>
</div>

<style>
  .shell {
    position: relative;
    flex: 1 1 auto;
    min-block-size: 0;
    display: flex;
    flex-direction: column;
    background: var(--surface-canvas);
  }

  /* ── شريط النافذة ───────────────────────────────────────────
     ثلاثة أعمدة: طرفان بعرض ٢٢٠ وعنوان في الوسط. أحد الطرفين محجوز
     لأزرار النظام، والآخر لحالة الحفظ — وأيّهما أيّ يقرّره **موضع
     الأزرار الفعلي** لا اتجاه المحتوى (ADR ٠٠٠٣، والمتغيّران في
     `app.css`). في RTL العمود ١ هو الأيمن والعمود ٣ هو الأيسر. */
  /* **الانتقال يُكتب على الحالة المقصودة لا على العنصر وحده:** فيتبع
     المنحنى اتجاهَه — ease-out للعودة (ظهور) وease-in للدخول (خروج). */
  .titlebar {
    transition:
      background-color var(--motion-structural) var(--ease-enter),
      border-color var(--motion-structural) var(--ease-enter);
    flex: none;
    display: grid;
    grid-template-columns:
      var(--size-titlebar-slot) 1fr
      var(--size-titlebar-slot);
    align-items: center;
    block-size: var(--size-titlebar);
    padding-inline: var(--space-020);
    background: var(--surface-paper);
    border-block-end: 1px solid var(--border-subtle);
  }
  .title {
    grid-column: 2;
    /* الصف صريح: الشبكة تضع العناصر بالترتيب ولا تعود إلى الوراء،
       فالعنوان في العمود ٢ يدفع حالةَ الحفظ في العمود ١ إلى **صفّ
       ثانٍ**. مُقاسًا: الشريط صار صفّين (٣٥٫٥px + ١١٫٥px) داخل ارتفاع
       ٤٨ ثابت، فارتفع العنوان عن مركزه وانضغطت الحالة تحته. */
    grid-row: 1;
    justify-self: center;
    font: var(--text-ui-07);
    letter-spacing: 0;
    color: var(--text-secondary);
    max-inline-size: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .save {
    grid-column: var(--luma-status-col);
    grid-row: 1;
    justify-self: var(--luma-status-justify);
    display: flex;
    align-items: center;
  }

  /* ── الجسم ──────────────────────────────────────────────────── */
  .body {
    flex: 1 1 auto;
    min-block-size: 0;
    display: flex;
  }
  .panel {
    flex: none;
    inline-size: var(--size-panel);
  }
  .writing {
    position: relative;
    flex: 1 1 auto;
    min-inline-size: 0;
    display: flex;
    flex-direction: column;
  }

  .notice {
    flex: none;
    padding: var(--space-008) var(--space-016) 0;
  }
  /* المقطع مُمرَّر دائمًا وقد لا يعرض شيئًا (لا معاينة جارية)، فيبقى
     الوعاء بحشوته ويدفع الورقة بلا سبب. الفارغ يُطوى. */
  .notice:empty {
    display: none;
  }

  /* ── مساحة الكتابة ──────────────────────────────────────────
     مسؤول تمرير **واحد**: `.scroller`. لا ارتفاع ثابت، ولا قصّ،
     ولا طبقة تمرير ثانية.

     كانت شبكة (`grid`) بـ`align-content: stretch`، فكان صفّها يُشدّ
     إلى ارتفاع الحاوية المرئي، و`min-height: 100%` على الورقة يُحلّ
     على مساحة الشبكة لا على ارتفاع المحتوى — فتتوقف خلفية الورقة عند
     حدود النافذة بينما يستمر النص خارجها. الحاوية الآن كتلة عادية،
     فتنمو الورقة مع محتواها ويبقى السطح متصلًا. */
  .scroller {
    flex: 1 1 auto;
    /* بدونه لا ينكمش عنصر المرونة تحت محتواه فلا يُمرَّر شيء */
    min-block-size: 0;
    overflow-y: auto;
    overflow-x: hidden;
    /* هامش خارجي ضيّق: المساحة للنص لا للفراغ حوله */
    padding-inline: var(--space-016);
    padding-block: var(--space-020) var(--space-032);
  }

  /* الورقة: بطاقة متصلة على الخلفية، كما في `إطار المحرر` في Figma.
     الحدّ ونصف القطر ليسا زينة — بدونهما تختفي الورقة في «ليل» حيث
     surface/paper وsurface/canvas متقاربان. */
  .sheet {
    inline-size: min(
      100%,
      calc(var(--editor-measure) + var(--size-sheet-pad) * 2)
    );
    margin-inline: auto;
    min-block-size: 100%;
    background: var(--surface-paper);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    /* الظل الخفيف من نظام الظلال (اللغة البصرية §٦): «لإشعار المستخدم
       بالارتفاع دون إحداث فوضى بصرية» — FEEL-PLAN M0. */
    box-shadow: var(--shadow-low);
    transition:
      background-color var(--motion-structural) var(--ease-enter),
      border-color var(--motion-structural) var(--ease-enter),
      border-radius var(--motion-structural) var(--ease-enter),
      box-shadow var(--motion-structural) var(--ease-enter);
    /* النافذة الضيّقة: **يتقلّص عمود النص نحو ٥٢٠ قبل أن تتقلّص
       الورقة**. الحشوة تبقى عند حدّها ما دام العمود فوق أدناه، فإذا
       بلغه أعطت الحشوةُ لتُبقيه عنده، وبعدها فقط ينكمش كل شيء. */
    padding-inline: clamp(
      var(--space-016),
      calc((100% - var(--size-column-min)) / 2),
      var(--size-sheet-pad)
    );
    padding-block: var(--space-048) 40vh;
  }

  /* الورقة تحمل القياس، فالعمود يملأها. لا تحديد عرض مكرَّر. */
  .column {
    inline-size: 100%;
  }

  /* عدّاد الكلمات عند بداية القراءة أسفل مساحة الكتابة — لا أسفل
     النافذة: لو رُبط بالنافذة لاختفى تحت عمود اللوحة عند فتحها.

     **الإزاحة تحسب عرض `.sheet` نفسه لا رقمًا ثابتًا** — كانت `880px`
     مكتوبة حرفيًا (عرض الورقة الافتراضي وحده)، فتصدق فقط حين يكون
     «عرض منطقة الكتابة» عند أقصاه. أي قيمة أضيق منه (المدى ٥٢٠–٨٠٠،
     الإعدادات ← الكتابة) تُضيّق `.sheet` فعليًا وتُبقي العدّاد عند
     الموضع القديم — فيطفو في القماش بعيدًا عن حافة الورقة. الصيغة هنا
     مطابقة لصيغة `.sheet` أدناه حرفًا بحرف؛ أي تغيير هناك يجب أن
     يتكرر هنا. */
  .count {
    position: absolute;
    inset-block-end: var(--space-016);
    inset-inline-start: max(
      20px,
      calc(
        (100% - min(100%, calc(var(--editor-measure) + var(--size-sheet-pad) * 2))) / 2 +
          20px
      )
    );
    pointer-events: none;
  }

  /* ── المحرر المريح ──────────────────────────────────────────
     «تختفي المكتبة والقوائم والأدوات، وتتسع مساحة النص، ويبقى النص
     والمؤشر ووسيلة الخروج» — `Luma.md` §٧ **ثابت**. */

  /* شريط سحب رفيع مكان شريط النافذة: النافذة تبقى قابلة للتحريك */
  /* شريط الأسطح ينطوي بارتفاعه — «٥٠٠ للتمدد والتحولات الهيكلية
     الكبيرة لتفادي الارتجاج البصري»، §١١. */
  .surfaces {
    flex: none;
    overflow: hidden;
    block-size: var(--size-surfaces-bar);
    transition:
      block-size var(--motion-structural) var(--ease-enter),
      opacity var(--motion-structural) var(--ease-enter);
  }
  .comfort .surfaces {
    block-size: 0;
    opacity: 0;
    transition:
      block-size var(--motion-structural) var(--ease-exit),
      opacity var(--motion-structural) var(--ease-exit);
  }

  /* وفي الوضع المريح يصير شريط النافذة سطحَ سحبٍ لا أكثر */
  .comfort .titlebar {
    background-color: transparent;
    border-block-end-color: transparent;
    transition:
      background-color var(--motion-structural) var(--ease-exit),
      border-color var(--motion-structural) var(--ease-exit);
  }
  .title,
  .save {
    transition: opacity var(--motion-structural) var(--ease-enter);
  }
  .comfort .title,
  .comfort .save {
    opacity: 0;
    transition: opacity var(--motion-structural) var(--ease-exit);
  }

  /* حالة الفشل داخل المحرر المريح — عند بداية القراءة، مقابل وسيلة
     الخروج، فلا يتزاحمان. */
  .fail {
    position: absolute;
    /* متمركز في شريط السحب ٤٨: بـ`--space-024` كان يشغل ٢٤–٥٢ فيقطع
       الشريط ويحجب زاويته عن سحب النافذة. */
    inset-block-start: calc((var(--size-titlebar) - var(--size-btn-sm)) / 2);
    inset-inline-start: var(--space-024);
    z-index: 2;
  }

  /* لا ورقة في المحرر المريح: النص على السطح مباشرةً كما في الصفحة ١١.
     البطاقة إطارٌ للقراءة، والمحرر المريح يزيل الإطارات. */
  .comfort .sheet {
    /* **تذوب ولا تُستبدل**: الحدّ يبقى بعرضه ويفقد لونه، فلا يتغيّر
       التخطيط بمقدار بكسلين وسط الحركة. */
    background-color: transparent;
    border-color: transparent;
    border-radius: 0;
    /* والظل كذلك: ورقة أخفت خلفيتها وأبقت ظلها ترسم حافتين شبحيتين */
    box-shadow: none;
    transition:
      background-color var(--motion-structural) var(--ease-exit),
      border-color var(--motion-structural) var(--ease-exit),
      border-radius var(--motion-structural) var(--ease-exit),
      box-shadow var(--motion-structural) var(--ease-exit);
    /* حشوة تكفي ليبلغ السطر الأول والأخير نطاق الآلة الكاتبة — §٧.
       تُحسب في `App.svelte` من ارتفاع **المساحة** لا من ارتفاع
       النافذة: `vh` يشمل شريط السحب ٤٨px والمساحةُ لا تشمله، وفارقُ
       المرجعين قِيس نحو ٢٢px فكان سطر بداية المستند يقف خارج شريطه.
       والقيمتان الاحتياطيتان لما قبل أول حساب. */
    padding-block: var(--comfort-pad-top) var(--comfort-pad-bottom);
  }

  /* نطاق الآلة الكاتبة: شريط ثابت يستقرّ عنده السطر النشط */
  /* **لا مستطيل خلف السطر النشط.**
     كان نطاق الآلة الكاتبة يُرسم سطحًا بحدّين: في «ليل» شريطٌ فاتح
     يقطع النص فيُتعب العين، وفي النهاري لوحٌ باهت يزاحم الحبر. وموضع
     السطر يُحَسّ بسكونه لا بإطارٍ حوله — والفرق بين الجملة النشطة وما
     حولها صار في الحبر وحده. وبزواله زال تناقضٌ آخر: الشريط المرسوم
     ٣٦px بينما نطاق السكون خُمس الارتفاع، فكان السطر يستقرّ خارج
     شريطه وهو داخل نطاقه. */
  .comfort .scroller {
    padding-block: 0;
  }

  .exit {
    position: absolute;
    /* الشرح عند `.fail` — والزاوية المقابلة تبقى للسحب */
    inset-block-start: calc((var(--size-titlebar) - var(--size-btn-sm)) / 2);
    inset-inline-end: var(--space-024);
    z-index: 2;
    transition: opacity var(--motion-quick) ease;
  }
  /* Zen يخفيها بصريًا، والتركيز عليها يعيدها فورًا: من وصلها
     بلوحة المفاتيح يراها */
  .exit.hidden {
    opacity: 0;
    /* لا يلتقط نقرًا وهو غير مرئي: النقر بلا حركة مؤشر (لوحة اللمس)
       كان يُنهي الوضع من عنصرٍ لا يراه صاحبه. */
    pointer-events: none;
  }
  .exit:focus-within {
    opacity: 1;
  }

  /* شريط التحديد: أسفل المساحة ومتمركز — الموضع نفسه في الوضعين.

     الإزاحة `--space-048` لا `--space-024`: تلك كانت تُسكن الشريط على
     حافة الورقة السفلية فيتقاطع مع زاويتها المدوَّرة ويبدو ملتصقًا لا
     عائمًا. القيمة ثابتة كسابقتها — رقمٌ واحد لا نقطة تتبع التحديد —
     وسِعت فقط لترفعه عن الحافة بمسافة واضحة. */
  .selection-bar {
    position: absolute;
    inset-block-end: var(--space-048);
    inset-inline: 0;
    z-index: 3;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  .selection-bar :global(*) {
    pointer-events: auto;
  }
  /* في المحرر المريح يعلو رقاقات الطبقات ولا يزاحمها: كلاهما أسفل
     المساحة، وإخفاء أحدهما لأجل الآخر يجعل استعادته غامضة — §٥. */
  .comfort .selection-bar {
    inset-block-end: calc(
      var(--space-048) + var(--size-btn-sm) + var(--space-012)
    );
  }

  /* شريط الطبقات ووسيلة الخروج — يتراجعان مع Zen ويعودان */
  .comfort-bar {
    position: absolute;
    inset-block-end: var(--space-024);
    inset-inline: 0;
    /* فوق المُمرِّر: حشوة الورقة السفلية تمتدّ ٥٤٫٥vh فتغطّي أسفل
       المساحة، ولولا هذا لالتقطت النقر بدل الرقاقات */
    z-index: 2;
    display: flex;
    justify-content: center;
    gap: var(--space-008);
    pointer-events: none;
    transition: opacity var(--motion-quick) ease;
  }
  .comfort-bar :global(*) {
    pointer-events: auto;
  }
  /* Zen: تتراجع العناصر ولا تُزال — إزالتها تنقل التركيز فجأة */
  .comfort-bar.hidden {
    opacity: 0;
  }
  .comfort-bar.hidden :global(*) {
    pointer-events: none;
  }
  .comfort-bar.hidden:focus-within {
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .comfort-bar,
    .exit,
    .titlebar,
    .surfaces,
    .title,
    .save,
    .sheet {
      transition: none;
    }
  }
</style>
