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
  }: {
    entries: readonly SurfaceEntry[];
    active?: string | null;
    ontoggle: (id: string) => void;
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
  <!-- مكان الأدوات الثانوية في التصميم — يبقى محجوزًا وفارغًا -->
  <div class="secondary" aria-hidden="true"></div>
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
