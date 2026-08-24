<script lang="ts">
  import type { Snippet } from "svelte";
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
    showSaveStatus = true,
    activeSurface = null,
    ontoggle,
    onnew,
    oncomfort,
    wordCount = 0,
    showWordCount = false,
    comfort = false,
    inert = false,
    zenHidden = false,
    typewriterBand = false,
    host = $bindable<HTMLElement | null>(null),
    scroller = $bindable<HTMLElement | null>(null),
    panel,
    notice,
    comfortBar,
    comfortExit,
  }: {
    title: string;
    saveState: SaveState;
    /** يختفي مؤشر الحفظ أثناء معاينة نسخة — `Luma.md` §٩ **ثابت**. */
    showSaveStatus?: boolean;
    activeSurface?: SurfaceId | null;
    ontoggle: (id: string) => void;
    /** بدء نصّ جديد — لا يُمرَّر في المحرر المريح فيختفي الزر. */
    onnew?: (() => void) | undefined;
    /** دخول المحرر المريح — لا يُمرَّر وهو مفتوح. */
    oncomfort?: (() => void) | undefined;
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
    /** شريط نطاق الآلة الكاتبة (`123:80`). */
    typewriterBand?: boolean;
    host?: HTMLElement | null;
    scroller?: HTMLElement | null;
    panel?: Snippet;
    notice?: Snippet;
    comfortBar?: Snippet;
    comfortExit?: Snippet;
  } = $props();

  /** اسم اللوحة لقارئ الشاشة — بديل الترويسة المحذوفة. */
  const panelName = $derived(
    SURFACES.find((s) => s.id === activeSurface)?.label ?? "لوحة جانبية",
  );
</script>

<div class="shell" class:comfort {inert}>
  {#if !comfort}
    <header class="titlebar luma-chrome" data-tauri-drag-region>
      <span class="title">{title}</span>
      {#if showSaveStatus}
        <div class="save"><SaveStatus state={saveState} /></div>
      {/if}
    </header>

    <SurfacesBar
      entries={OPEN_SURFACES}
      active={activeSurface}
      {ontoggle}
      onnew={onnew ?? undefined}
      oncomfort={oncomfort ?? undefined}
    />
  {:else}
    <!-- شريط سحب النافذة يبقى: لا chrome نظام يُعاد رسمه، ولا نافذة
         تصير غير قابلة للتحريك لأن المستخدم دخل وضع كتابة — §٧. -->
    <div class="drag luma-chrome" data-tauri-drag-region></div>

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
      <aside class="panel" aria-label={panelName}>{@render panel()}</aside>
    {/if}

    <div class="writing">
      {#if notice}<div class="notice">{@render notice()}</div>{/if}

      {#if typewriterBand}
        <!-- `نطاق الآلة الكاتبة` (`123:80`): شريط ثابت الموضع، والنص
             هو الذي يتحرّك إليه. مؤشر عرض بحت لا يلتقط نقرًا. -->
        <div class="band" aria-hidden="true"></div>
      {/if}

      <div class="scroller" bind:this={scroller}>
        <div class="sheet">
          <div class="column" bind:this={host}></div>
        </div>
      </div>

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
  .titlebar {
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
     النافذة: لو رُبط بالنافذة لاختفى تحت عمود اللوحة عند فتحها. */
  .count {
    position: absolute;
    inset-block-end: var(--space-016);
    inset-inline-start: var(--space-020);
    pointer-events: none;
  }

  /* ── المحرر المريح ──────────────────────────────────────────
     «تختفي المكتبة والقوائم والأدوات، وتتسع مساحة النص، ويبقى النص
     والمؤشر ووسيلة الخروج» — `Luma.md` §٧ **ثابت**. */

  /* شريط سحب رفيع مكان شريط النافذة: النافذة تبقى قابلة للتحريك */
  .drag {
    flex: none;
    block-size: var(--size-titlebar);
  }

  /* حالة الفشل داخل المحرر المريح — عند بداية القراءة، مقابل وسيلة
     الخروج، فلا يتزاحمان. */
  .fail {
    position: absolute;
    inset-block-start: var(--space-024);
    inset-inline-start: var(--space-024);
    z-index: 2;
  }

  /* لا ورقة في المحرر المريح: النص على السطح مباشرةً كما في الصفحة ١١.
     البطاقة إطارٌ للقراءة، والمحرر المريح يزيل الإطارات. */
  .comfort .sheet {
    background: none;
    border: none;
    border-radius: 0;
    /* حشوة تكفي ليبلغ السطر الأول والأخير نطاق الآلة الكاتبة — §٧.
       القيمتان بالنسبة إلى ارتفاع النافذة لا بمقدار ثابت، فتصحّان
       على كل ارتفاع. المرساة ٤٥٫٥٪ كما في `src/lib/typewriter.ts`. */
    padding-block: 45.5vh 54.5vh;
  }

  .comfort .scroller {
    padding-block: 0;
  }

  /* نطاق الآلة الكاتبة: شريط ثابت يستقرّ عنده السطر النشط */
  .band {
    position: absolute;
    inset-inline: 0;
    inset-block-start: 45.5%;
    /* ارتفاع سطر واحد من نص القراءة */
    block-size: calc(var(--luma-editor-size) * var(--luma-editor-leading));
    transform: translateY(-50%);
    background: var(--surface-paper);
    pointer-events: none;
    z-index: 0;
  }

  /* الشريط خلف النص لا فوقه */
  .comfort .scroller {
    position: relative;
    z-index: 1;
  }

  .exit {
    position: absolute;
    inset-block-start: var(--space-024);
    inset-inline-end: var(--space-024);
    z-index: 2;
    transition: opacity 200ms ease;
  }
  /* Zen يخفيها بصريًا، والتركيز عليها يعيدها فورًا: من وصلها
     بلوحة المفاتيح يراها */
  .exit.hidden {
    opacity: 0;
  }
  .exit:focus-within {
    opacity: 1;
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
    transition: opacity 200ms ease;
  }
  .comfort-bar :global(*) {
    pointer-events: auto;
  }
  /* Zen: تتراجع العناصر ولا تُزال — إزالتها تنقل التركيز فجأة */
  .comfort-bar.hidden {
    opacity: 0;
  }
  .comfort-bar.hidden:focus-within {
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .comfort-bar,
    .exit {
      transition: none;
    }
  }
</style>
