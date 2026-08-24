<script lang="ts">
  import { sinceLabel, words } from "../lib/bidi";

  /**
   * نقطة في السجل الزمني — أربع حالات (`105:166`): عادي، تمرير،
   * النسخة الحالية، قيد المعاينة.
   *
   * «التحديد يُنقل بخلفية accent/subtle وشريط على الحافة اليمنى ونص
   * واضح — لا بنقطة لونية وحدها.» ثلاثة مؤشرات معًا كما في صف المستند.
   *
   * لا يحمل الصف إجراءً: **إجراء الاستعادة واحد في تذييل اللوحة**، فلا
   * تقع استعادة بلمسة عابرة — `Luma.md` §٩ **ثابت**.
   */
  let {
    label,
    detail,
    wordCount,
    at,
    now = Date.now(),
    selected = false,
    onselect,
  }: {
    /** نص السطر الأول — يستبدله «الآن — النسخة الحالية» في صف الحاضر. */
    label?: string;
    detail: string;
    wordCount: number;
    at?: number;
    now?: number;
    selected?: boolean;
    onselect: () => void;
  } = $props();

  const when = $derived(label ?? (at ? sinceLabel(at, now) : "الآن"));
</script>

<button
  type="button"
  class="row"
  class:selected
  aria-current={selected ? "true" : undefined}
  onclick={onselect}
>
  <span class="head">
    <span class="when">{when}</span>
    <span class="count">{words(wordCount)}</span>
  </span>
  <span class="detail">{detail}</span>
  {#if selected}<span class="mark" aria-hidden="true"></span>{/if}
</button>

<style>
  .row {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-002);
    inline-size: 100%;
    padding: var(--space-008) var(--space-012);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    text-align: start;
    cursor: pointer;
    transition: background-color 120ms ease;
  }
  .row:hover {
    background: var(--surface-sunken);
  }
  .row:focus-visible {
    outline: var(--size-focus-ring) solid var(--accent-graphic);
    outline-offset: var(--size-focus-offset);
  }
  .selected,
  .selected:hover {
    background: var(--accent-subtle);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-008);
    inline-size: 100%;
  }
  .when {
    font: var(--text-ui-08);
    letter-spacing: 0;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .selected .when {
    color: var(--accent-text);
  }
  .count {
    margin-inline-start: auto;
    flex: none;
    font: var(--text-ui-09);
    letter-spacing: 0;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .detail {
    font: var(--text-ui-09);
    letter-spacing: 0;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mark {
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    inline-size: var(--size-panel-mark);
    border-radius: var(--radius-xs);
    background: var(--accent-graphic);
  }

  @media (prefers-reduced-motion: reduce) {
    .row {
      transition: none;
    }
  }
</style>
