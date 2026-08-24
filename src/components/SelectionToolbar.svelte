<script lang="ts">
  import type { BlockRole } from "../editor";

  /**
   * شريط التحديد (`113:375`) — حالتان: عادي، وفقرة محددة.
   *
   * «يظهر عند تحديد نص فقط ويختفي عند استئناف الكتابة — لا يوجد شريط
   * تنسيق دائم في Luma.» `Luma.md` §٥ **ثابت**.
   *
   * **المجموعة المعتمدة ثلاثة أدوار وعلامة اقتباس.** H3 وغامق وقائمة
   * في التصميم بوسم «مرشحة» — و«لا ميزة خارج `Luma.md`» يمنع بناءها
   * قبل اعتمادها. **ولا مائل**: العربية لا تُمال، وبديل التمييز «».
   *
   * لا يسرق التركيز: `mousedown` مُلغى، فيبقى المؤشر والتحديد في النص.
   */
  let {
    role,
    onrole,
    onquote,
  }: {
    role: BlockRole | null;
    onrole: (r: BlockRole) => void;
    onquote: () => void;
  } = $props();

  const ROLES: ReadonlyArray<{ id: BlockRole; label: string; name: string }> = [
    { id: "body", label: "عادي", name: "فقرة عادية" },
    { id: "h1", label: "H1", name: "عنوان رئيسي" },
    { id: "h2", label: "H2", name: "عنوان فرعي" },
  ];

  const COUNT = ROLES.length + 1;

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
      class="tool"
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
    class="tool"
    aria-label="إحاطة بعلامة الاقتباس العربية"
    tabindex={focused === ROLES.length ? 0 : -1}
    data-quote
    onfocus={() => (focused = ROLES.length)}
    onclick={onquote}
  >
    «»
  </button>
</div>

<style>
  .toolbar {
    display: inline-flex;
    align-items: center;
    gap: var(--space-004);
    padding: var(--space-004) var(--space-008);
    background: var(--surface-raised);
    /* التصميم يرفع الطبقة بظل. الظل لون، ولا لون خارج طبقة الرموز —
       ولا رمز ظل في مجموعات Figma الثلاث. الرفع هنا بفارق السطح وحدّ
       قوي، وهو ما يصفه §٩ لثيم «ليل» أصلًا: «تعتمد الطبقات على فرق
       السطح أكثر من الظل». الطريقة نفسها في `إشعار عابر`. */
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
  }
  .tool {
    inline-size: var(--size-hit);
    block-size: var(--size-hit);
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
     حلقة التركيز: تلك خارجية بإزاحة ٢px. */
  .tool.on {
    background: var(--accent-subtle);
    color: var(--accent-text);
    box-shadow: inset 0 0 0 1px var(--accent-graphic);
  }
  .tool:focus-visible {
    outline: var(--size-focus-ring) solid var(--accent-graphic);
    outline-offset: var(--size-focus-offset);
  }
  .sep {
    inline-size: 1px;
    block-size: var(--space-016);
    background: var(--border-subtle);
  }
</style>
