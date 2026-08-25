<script lang="ts">
  import type { BlockRole } from "../editor";

  /**
   * شريط التحديد (`113:375`) — حالتان: عادي، وفقرة محددة.
   *
   * «يظهر عند تحديد نص فقط ويختفي عند استئناف الكتابة — لا يوجد شريط
   * تنسيق دائم في Luma.» `Luma.md` §٥ **ثابت**.
   *
   * **المجموعة:** أربعة أدوار (عادي · عنوان · فرعي · ثالث)، واقتباسُ
   * كتلة، والوزن، وعلامة الاقتباس العربية. اعتُمدت H3 والاقتباس
   * والوزن بعد أن كانت «مرشَّحة» في التصميم — والوزن تسمّيه `Luma.md`
   * §٥ نفسها بديلَ التمييز للعربية.
   *
   * **ولا مائل**: العربية لا تُمال.
   *
   * لا يسرق التركيز: `mousedown` مُلغى، فيبقى المؤشر والتحديد في النص.
   */
  let {
    role,
    strong = false,
    onrole,
    onstrong,
    onquote,
  }: {
    role: BlockRole | null;
    /** التحديد كلّه موزون — حالة زرّ الوزن. */
    strong?: boolean;
    onrole: (r: BlockRole) => void;
    onstrong: () => void;
    onquote: () => void;
  } = $props();

  const ROLES: ReadonlyArray<{ id: BlockRole; label: string; name: string }> = [
    { id: "body", label: "عادي", name: "فقرة عادية" },
    { id: "h1", label: "H1", name: "عنوان رئيسي" },
    { id: "h2", label: "H2", name: "عنوان فرعي" },
    { id: "h3", label: "H3", name: "عنوان ثالث" },
  ];

  /** الأدوار، ثم الاقتباس الكتلي، ثم الوزن، ثم علامة الاقتباس. */
  const COUNT = ROLES.length + 3;

  /**
   * تركيز متنقّل: الشريط محطة تركيز **واحدة** والأسهم تنقل بين أدواته.
   *
   * بدونه يستهلك الشريطُ أربع ضغطات Tab بين النص وما بعده. والأسهم
   * تتبع الاتجاه المرئي: الواجهة RTL فالأدوات تتوالى يسارًا، ولذلك
   * `ArrowLeft` يتقدّم و`ArrowRight` يرجع — عكس LTR.
   *
   * الحاوية `tabindex="-1"`: ليست محطة في تسلسل Tab، والتركيز عليها
   * برمجيًّا فقط. المحطة هي الأداة النشطة.
   */
  let focused = $state(0);
  let bar = $state<HTMLElement | null>(null);

  function move(to: number) {
    focused = (to + COUNT) % COUNT;
    bar?.querySelectorAll<HTMLButtonElement>(".tool")[focused]?.focus();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "ArrowLeft") move(focused + 1);
    else if (e.key === "ArrowRight") move(focused - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(COUNT - 1);
    else return;
    e.preventDefault();
  }
</script>

<div
  bind:this={bar}
  class="toolbar luma-chrome"
  role="toolbar"
  aria-label="تنسيق النص المحدَّد"
  data-selection-toolbar
  tabindex={-1}
  {onkeydown}
  onmousedown={(e) => e.preventDefault()}
>
  {#each ROLES as r, i (r.id)}
    <button
      type="button"
      class="tool luma-hit"
      class:on={role === r.id}
      aria-pressed={role === r.id}
      aria-label={r.name}
      tabindex={focused === i ? 0 : -1}
      data-role={r.id}
      onfocus={() => (focused = i)}
      onclick={() => onrole(r.id)}
    >
      {r.label}
    </button>
  {/each}

  <span class="sep" aria-hidden="true"></span>

  <button
    type="button"
    class="tool luma-hit"
    class:on={role === "quote"}
    aria-pressed={role === "quote"}
    aria-label="اقتباس كتلة"
    tabindex={focused === ROLES.length ? 0 : -1}
    data-role="quote"
    onfocus={() => (focused = ROLES.length)}
    onclick={() => onrole("quote")}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true" class="glyph">
      <path
        d="M13 3.5v9M9.5 5.5h-4M9.5 8h-4M9.5 10.5h-4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      />
    </svg>
  </button>

  <button
    type="button"
    class="tool strong luma-hit"
    class:on={strong}
    aria-pressed={strong}
    aria-label="وزن — تمييز داخل السطر"
    tabindex={focused === ROLES.length + 1 ? 0 : -1}
    data-strong
    onfocus={() => (focused = ROLES.length + 1)}
    onclick={onstrong}
  >
    ب
  </button>

  <button
    type="button"
    class="tool luma-hit"
    aria-label="إحاطة بعلامة الاقتباس العربية"
    tabindex={focused === ROLES.length + 2 ? 0 : -1}
    data-quote
    onfocus={() => (focused = ROLES.length + 2)}
    onclick={onquote}
  >
    «»
  </button>
</div>

<style>
  .toolbar {
    display: inline-flex;
    align-items: center;
    gap: var(--space-002);
    /* بلا حشوة رأسية: الهدف اللمسي ٣٢ داخل الأزرار نفسها (§١٣)،
       وحشوةٌ فوقه تزيد الشريط سُمكًا بلا أن تزيد أحدًا وصولًا. */
    padding: 0 var(--space-004);
    background: var(--surface-raised);
    /* الأداة العائمة تُرفع بالظل المتوسط من نظام الظلال (اللغة
       البصرية §٦) — دخل الظل طبقة الرموز في FEEL-PLAN M0 فزال مانع
       «لا رمز ظل». والحدّ يبقى معه: في «ليل» تعتمد الطبقات على فرق
       السطح والحدّ أكثر من الظل (§٩). */
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-mid);
  }
  .tool {
    /* الهدف اللمسي ٣٢ يبقى بصندوق الالتقاط (`.luma-hit`، §٥) — والمرسوم
       ينحف إلى ٢٨ فلا يثقل الشريط رأسيًّا وحده دون سائر أزرار Luma
       الصغيرة (`--size-btn-sm`، الزر الصغير ورقاقات المحرر المريح). */
    position: relative;
    isolation: isolate;
    inline-size: var(--size-hit);
    block-size: var(--size-btn-sm);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font: var(--text-ui-08);
    letter-spacing: 0;
    color: var(--text-secondary);
    background: none;
    border: none;
    border-radius: var(--radius-xs);
    cursor: pointer;
  }
  .tool:hover {
    background: var(--surface-sunken);
    color: var(--text-primary);
  }
  /* إشارة شكل مع اللون — الشرح في `NavRow`. والحدّ الداخلي يتمايز عن
     حلقة التركيز: تلك خارجية بإزاحة ٢px.

     الخلفية واللبد على شبه‌عنصر أضيق رأسيًّا من صندوق الزر، لا الزر
     نفسه: بلغ الصندوق كاملًا كان محشورًا لا ساكنًا. القاعدة نصف قطر
     الزر (`--radius-xs`)، والداخل = الخارج − الحشوة، فيبقيان مركَّزين
     بصريًّا. `isolation: isolate` أعلاه يحصر `z-index` السالب داخل
     الزر وحده فلا يرسم تحت طبقات الشريط أو الصفحة. */
  .tool.on {
    color: var(--accent-text);
  }
  .tool.on::before {
    content: "";
    position: absolute;
    z-index: -1;
    inset-inline: 0;
    inset-block: var(--space-002);
    border-radius: calc(var(--radius-xs) - var(--space-002));
    background: var(--accent-subtle);
    box-shadow: inset 0 0 0 1px var(--accent-graphic);
  }
  .tool:focus-visible {
    outline: var(--size-focus-ring) solid var(--accent-graphic);
    outline-offset: var(--size-focus-offset);
  }
  /* حرف «ب» بوزنه هو ما يدلّ على الوزن — لا رمز لاتيني B */
  .strong {
    font-weight: 700;
  }
  .glyph {
    inline-size: var(--size-icon);
    block-size: var(--size-icon);
  }
  .sep {
    inline-size: 1px;
    block-size: var(--space-016);
    background: var(--border-subtle);
  }
</style>
