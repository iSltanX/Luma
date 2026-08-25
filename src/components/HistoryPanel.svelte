<script lang="ts">
  import RevisionRow from "./RevisionRow.svelte";
  import EmptyState from "./EmptyState.svelte";
  import Button from "./Button.svelte";
  import { wordDelta } from "../lib/bidi";
  import type { RevisionCard } from "../lib/library";

  /**
   * لوحة السجل — ثلاث حالات (`112:339`): نسخ متاحة، معاينة، لا نسخ.
   *
   * **حواجز السلامة** — `Luma.md` §٩ **ثابت**:
   * إجراء استعادة **واحد** في التذييل، معطَّل ما دامت النسخة الحالية هي
   * المحددة؛ والمعاينة قراءة فقط؛ والاستعادة تحفظ الحالة الحالية أولًا
   * (تفعلها النواة في `restore_revision`).
   *
   * صفّ «الآن — النسخة الحالية» ليس لقطة مخزَّنة بل الحاضر نفسه:
   * اختياره هو المخرج من المعاينة.
   *
   * **بلا ترويسة:** المفتاح الذي يفتح هو الذي يغلق — `Luma.md` §٦.
   * الاسم يبقى لقارئ الشاشة في `aria-label` على العمود نفسه.
   */
  let {
    revisions,
    liveWordCount,
    previewId = null,
    restoring = false,
    now = Date.now(),
    onpreview,
    onrestore,
  }: {
    revisions: readonly RevisionCard[];
    liveWordCount: number;
    /** معرّف النسخة قيد المعاينة، أو `null` أي «النسخة الحالية». */
    previewId?: string | null;
    restoring?: boolean;
    now?: number;
    onpreview: (id: string | null) => void;
    onrestore: (id: string) => void;
  } = $props();

  /**
   * سطر الوصف تحت كل نقطة.
   *
   * التصميم يضع فيه وصفًا للتغيّر. البيانات المتاحة فعلًا هي المصدر
   * وعدد الكلمات، فيُشتقّ منها وصفٌ صادق بدل نصّ مُختلق.
   */
  function detailFor(index: number): string {
    const rev = revisions[index]!;
    if (rev.id === previewId) return "قيد المعاينة — للقراءة فقط";
    if (rev.source === "beforeRestore") return "نسخة أمان قبل استعادة";
    const older = revisions[index + 1];
    if (!older) return "بداية الكتابة";
    return wordDelta(rev.wordCount, older.wordCount);
  }
</script>

<div class="panel" data-panel="history">
  <div class="body">
    {#if revisions.length === 0}
      <EmptyState
        icon="history"
        title="لا توجد نسخ سابقة"
        hint="يحتفظ Luma بمراحل النص تلقائيًا كلما تقدّمت الكتابة."
      />
    {:else}
      <!-- `role="list"` صريح — الشرح في `LibraryPanel`. -->
      <ul class="list" role="list">
        <li>
          <RevisionRow
            label="الآن — النسخة الحالية"
            detail="آخر ما كُتب"
            wordCount={liveWordCount}
            selected={previewId === null}
            onselect={() => onpreview(null)}
          />
        </li>
        {#each revisions as rev, i (rev.id)}
          <li>
            <RevisionRow
              at={rev.createdAt}
              {now}
              detail={detailFor(i)}
              wordCount={rev.wordCount}
              selected={rev.id === previewId}
              onselect={() => onpreview(rev.id)}
            />
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if revisions.length > 0}
    <footer class="foot">
      <Button
        kind="primary"
        loading={restoring}
        disabled={previewId === null}
        onclick={() => previewId && onrestore(previewId)}
        data-restore
      >
        استعادة هذه النسخة
      </Button>
      <p class="hint">
        {previewId === null
          ? "اختر نسخة سابقة لتفعيل الاستعادة."
          : "تُحفظ النسخة الحالية في السجل قبل الاستبدال."}
      </p>
    </footer>
  {/if}
</div>

<style>
  .panel {
    inline-size: var(--size-panel);
    block-size: 100%;
    display: flex;
    flex-direction: column;
    background: var(--surface-paper);
    border-inline-end: 1px solid var(--border-subtle);
    /* والظل المتوسط يجعلها **تعلو** الورقة لا تلاصقها — §٦، والشرح
       في `LibraryPanel`. */
    box-shadow: var(--shadow-mid);
  }
  .body {
    flex: 1 1 auto;
    min-block-size: 0;
    overflow-y: auto;
    padding: var(--space-012) var(--space-016);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-004);
  }
  .foot {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-008);
    padding: var(--space-012) var(--space-016) var(--space-016);
    background: var(--surface-raised);
    border-block-start: 1px solid var(--border-subtle);
  }
  /* الزر يملأ عرض التذييل — إجراء واحد لا صفّ إجراءات */
  .foot :global(.btn) {
    inline-size: 100%;
  }
  .hint {
    font: var(--text-ui-09);
    letter-spacing: 0;
    color: var(--text-muted);
    margin: 0;
  }
</style>
