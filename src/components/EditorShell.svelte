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
    wordCount = 0,
    showWordCount = false,
    host = $bindable<HTMLElement | null>(null),
    panel,
    notice,
  }: {
    title: string;
    saveState: SaveState;
    /** يختفي مؤشر الحفظ أثناء معاينة نسخة — `Luma.md` §٩ **ثابت**. */
    showSaveStatus?: boolean;
    activeSurface?: SurfaceId | null;
    ontoggle: (id: string) => void;
    wordCount?: number;
    /** **مخفي افتراضيًا** ويظهر بطلب المستخدم — `Luma.md` §٥ **ثابت**. */
    showWordCount?: boolean;
    host?: HTMLElement | null;
    panel?: Snippet;
    notice?: Snippet;
  } = $props();

  /** اسم اللوحة لقارئ الشاشة — بديل الترويسة المحذوفة. */
  const panelName = $derived(
    SURFACES.find((s) => s.id === activeSurface)?.label ?? "لوحة جانبية",
  );
</script>

<div class="shell">
  <header class="titlebar luma-chrome" data-tauri-drag-region>
    <span class="title">{title}</span>
    {#if showSaveStatus}
      <div class="save"><SaveStatus state={saveState} /></div>
    {/if}
  </header>

  <SurfacesBar entries={OPEN_SURFACES} active={activeSurface} {ontoggle} />

  <div class="body">
    {#if panel && activeSurface !== null}
      <!-- اللوحة أولًا في الشجرة: هي عند بداية القراءة بصريًا، وهي
           التالية لمدخلها في ترتيب التركيز — فمن فتحها بلوحة المفاتيح
           يصلها بـTab واحدة. ولا حبس تركيز فيها — §١٠ **ثابت**. -->
      <aside class="panel" aria-label={panelName}>{@render panel()}</aside>
    {/if}

    <div class="writing">
      {#if notice}<div class="notice">{@render notice()}</div>{/if}

      <div class="scroller">
        <div class="sheet">
          <div class="column" bind:this={host}></div>
        </div>
      </div>

      {#if showWordCount}
        <div class="count luma-chrome"><Badge>{words(wordCount)}</Badge></div>
      {/if}
    </div>
  </div>
</div>

<style>
  .shell {
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
</style>
