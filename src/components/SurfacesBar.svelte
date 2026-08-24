<script lang="ts">
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
</script>

<nav class="bar luma-chrome" aria-label="الأسطح الجانبية">
  <div class="entries">
    {#each entries as entry (entry.id)}
      <span data-surface={entry.id}>
        <IconButton
          name={entry.icon}
          label={entry.label}
          active={active === entry.id}
          onclick={() => ontoggle(entry.id)}
        />
      </span>
    {/each}
  </div>
  <div class="secondary"></div>

  {#if onnew}
    <!-- **بدء نصّ جديد.** كان التطبيق بلا مسار إليه: الاستئناف يفتح
         الأخير دائمًا، والمكتبة تعرض ولا تُنشئ. فمن فرغ من نصّه لم يجد
         إلا أن يمحوه ليبدأ غيره. الزر عند نهاية القراءة في الشريط،
         حاضرٌ دائمًا وبعيدٌ عن مداخل اللوحات فلا يُخلَط بها. -->
    <span data-new-document>
      <IconButton name="add" label="نصّ جديد" onclick={onnew} />
    </span>
  {/if}

  {#if oncomfort}
    <!-- **مدخل المحرر المريح في الشريط لا عائمًا فوق الورقة.**
         كان زرًّا عائمًا في زاوية مساحة الكتابة، والورقة تتمدّد لتملأ
         ما أُتيح — فيقع الزر على حافة عمود النص. وحافةُ العمود تتحرّك
         مع حشوة الورقة المقيَّدة، فلا إزاحةَ ثابتة تُخليها عند كل عرض.
         وموضعه هنا يُخليها عند كل عرض بلا استثناء. -->
    <span data-comfort-entry>
      <IconButton name="expand" label="المحرر المريح" onclick={oncomfort} />
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
  .entries {
    display: flex;
    align-items: center;
    gap: var(--space-004);
  }
  .secondary {
    flex: 1 1 auto;
  }
</style>
