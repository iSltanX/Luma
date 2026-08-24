<script lang="ts">
  import { sinceLabel } from "../lib/bidi";
  import type { DocumentCard } from "../lib/library";

  /**
   * صف مستند في المكتبة — أربع حالات (`105:121`): عادي، تمرير، محدد، تركيز.
   *
   * «العنوان يمين والوقت يسار. المحدد يستخدم accent/subtle + accent/text —
   * لا يُعتمد على اللون وحده.» ولذلك يحمل المحدد ثلاثة مؤشرات معًا:
   * الخلفية، ولون النص، وشريط على الحافة اليمنى، و`aria-current` لقارئ
   * الشاشة — §١٧ مبدأ ٩ **ثابت**.
   *
   * الوقت **نسبي بالكلمات**: «منذ ساعة» لا «١١:٤٥ م» — `Luma.md` §١٦.
   */
  let {
    doc,
    current = false,
    now = Date.now(),
    onopen,
  }: {
    doc: DocumentCard;
    current?: boolean;
    now?: number;
    onopen: (id: string) => void;
  } = $props();
</script>

<button
  type="button"
  class="row"
  class:current
  data-document-row={doc.id}
  aria-current={current ? "true" : undefined}
  onclick={() => onopen(doc.id)}
>
  <span class="head">
    <span class="title">{doc.title}</span>
    <span class="when">{sinceLabel(doc.updatedAt, now)}</span>
  </span>
  <span class="excerpt">{doc.excerpt}</span>
  {#if current}<span class="mark" aria-hidden="true"></span>{/if}
</button>

<style>
  .row {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-004);
    inline-size: 100%;
    /* التصميم يكتب ١٤ أفقيًا، وليست خطوة في سلّم المسافات — تُقرَّب إلى
       أقرب خطوة بدل إدخال قيمة خارج السلّم (§٩ «المسافات سلّم من ١٤ خطوة») */
    padding: var(--space-012);
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
  .current {
    background: var(--accent-subtle);
  }
  .current:hover {
    background: var(--accent-subtle);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-008);
    inline-size: 100%;
  }
  .title {
    font: var(--text-ui-08);
    letter-spacing: 0;
    color: var(--text-primary);
    /* العنوان يأخذ ما يكفيه ويقصّ، والوقت لا يُزاح */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .current .title {
    color: var(--accent-text);
  }
  .when {
    margin-inline-start: auto;
    flex: none;
    font: var(--text-ui-09);
    letter-spacing: 0;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .excerpt {
    font: var(--text-ui-09);
    letter-spacing: 0;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* الشريط على **بداية القراءة** — الحافة اليمنى في RTL */
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
