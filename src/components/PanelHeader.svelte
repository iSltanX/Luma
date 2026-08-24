<script lang="ts">
  import IconButton from "./IconButton.svelte";
  /**
   * ترويسة لوحة (`103:88`) — **تفرض وجود زر الإغلاق** (§١٢).
   * `onclose` إلزامي: لا لوحة بلا مخرج ظاهر — §١٠ **ثابت**.
   */
  let { title, onclose }: { title: string; onclose: () => void } = $props();
</script>

<header class="head">
  <h2 class="title">{title}</h2>
  <IconButton name="close" label="إغلاق {title}" onclick={onclose} />
</header>

<style>
  .head {
    display: flex; align-items: center; justify-content: space-between;
    gap: var(--space-012);
    block-size: var(--size-surfaces-bar);
    padding-inline: var(--space-016);
    background: var(--surface-raised);
    border-block-end: 1px solid var(--border-subtle);
  }
  .title { font: var(--text-ui-08); letter-spacing: 0; margin: 0; color: var(--text-primary); }
</style>
