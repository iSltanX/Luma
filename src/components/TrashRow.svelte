<script lang="ts">
  import Button from "./Button.svelte";
  import { sinceLabel, untilTrashEmptyLabel, words } from "../lib/bidi";
  import type { TrashCard } from "../lib/library";

  /**
   * صفّ عنصر في السلّة — بشكل صفّ المكتبة (`DocumentRow`) ومعه سطر
   * مهلة وزرّ استعادة، إذ لا فتح هنا: العنصر لا يُقرأ إلا بعد عودته.
   *
   * **لا فاصل «·» قرب رقم** — `lib/bidi.ts`: شكله شكل «٠»، فـ«١٦ ·
   * كلمة» يُقرأ «١٦٠ كلمة». عدد الكلمات ووقت الحذف صفّان منفصلان
   * بمسافة تلقائية بينهما لا فاصل مكتوب — نمط `RevisionRow` نفسه.
   */
  let {
    doc,
    retentionMs,
    now = Date.now(),
    busy = false,
    onrestore,
  }: {
    doc: TrashCard;
    retentionMs: number;
    now?: number;
    busy?: boolean;
    onrestore: (id: string) => void;
  } = $props();
</script>

<div class="row" data-trash-row={doc.id}>
  <div class="text">
    <span class="head">
      <span class="title">{doc.title}</span>
      <span class="count">{words(doc.wordCount)}</span>
    </span>
    {#if doc.excerpt}<span class="excerpt">{doc.excerpt}</span>{/if}
    <span class="meta">
      <span class="when">حُذف {sinceLabel(doc.deletedAt, now)}</span>
      <span class="expiry">{untilTrashEmptyLabel(doc.deletedAt, retentionMs, now)}</span>
    </span>
  </div>
  <Button
    kind="secondary"
    size="sm"
    loading={busy}
    disabled={busy}
    onclick={() => onrestore(doc.id)}
    data-restore={doc.id}
  >
    استعادة
  </Button>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-012);
    inline-size: 100%;
    padding: var(--space-012);
    border-radius: var(--radius-sm);
    border-block-end: 1px solid var(--border-subtle);
  }
  .text {
    flex: 1 1 auto;
    min-inline-size: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-002);
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
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
  .meta {
    display: flex;
    align-items: center;
    gap: var(--space-008);
    inline-size: 100%;
  }
  .when {
    font: var(--text-ui-09);
    letter-spacing: 0;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .expiry {
    margin-inline-start: auto;
    flex: none;
    font: var(--text-ui-09);
    letter-spacing: 0;
    color: var(--text-secondary);
    white-space: nowrap;
  }
</style>
