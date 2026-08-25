<script lang="ts">
  import SearchField from "./SearchField.svelte";
  import DocumentRow from "./DocumentRow.svelte";
  import EmptyState from "./EmptyState.svelte";
  import Alert from "./Alert.svelte";
  import { filterDocuments, type DocumentCard } from "../lib/library";

  /**
   * لوحة المكتبة — ثلاث حالات (`110:195`): ممتلئة، فارغة، لا نتائج.
   *
   * «تظهر بعرض ٣٢٠px ولا تغيّر محتوى المستند المفتوح ولا موضع المؤشر
   * ولا شكل المحرر.» اللوحة عمود مستقل: لا تعرف الورقة ولا تلمسها.
   *
   * **مخفية افتراضيًا** — `Luma.md` §٦ **ثابت**. من يفتحها هو الإطار.
   * لا مجلدات ولا وسوم ولا مشاركة ولا تصدير.
   *
   * **بلا ترويسة:** المفتاح الذي يفتح هو الذي يغلق، فعنوانٌ داخلها وزرُ
   * إغلاق ثانٍ تكرارٌ يشوّش السطح — `Luma.md` §٦. الاسم يبقى لقارئ
   * الشاشة في `aria-label` على العمود نفسه.
   */
  let {
    documents,
    damaged = [],
    currentId = null,
    now = Date.now(),
    onopen,
  }: {
    documents: readonly DocumentCard[];
    damaged?: readonly string[];
    currentId?: string | null;
    now?: number;
    onopen: (id: string) => void;
  } = $props();

  let query = $state("");
  const shown = $derived(filterDocuments(documents, query));
</script>

<div class="panel" data-panel="library">
  <div class="body">
    <SearchField bind:value={query} />

    {#if documents.length === 0}
      <EmptyState
        icon="library"
        title="لا توجد نصوص بعد"
        hint="ابدأ الكتابة وسيظهر النص هنا تلقائيًا — بلا تسمية ولا حفظ يدوي."
      />
    {:else if shown.length === 0}
      <EmptyState
        icon="search"
        title="لا نتائج مطابقة"
        hint="لا يوجد نص يحتوي هذه الكلمة. جرّب كلمة أخرى."
      />
    {:else}
      <p class="label">النصوص الأخيرة</p>
      <!-- `role="list"` صريح: `list-style: none` يُسقط دلالة القائمة
           في WebKit، فلا يعلن VoiceOver «قائمة، ٧ عناصر». -->
      <ul class="list" role="list">
        {#each shown as doc (doc.id)}
          <li>
            <DocumentRow {doc} {now} current={doc.id === currentId} {onopen} />
          </li>
        {/each}
      </ul>
    {/if}

    {#if damaged.length > 0}
      <!-- المستند التالف يُعرض ولا يُخفى ولا يُحذف — §١٤ -->
      <div class="notice">
        <Alert
          kind="caution"
          title="نصوص تعذّرت قراءتها"
          detail="بقيت ملفاتها كما هي ولم تُمسّ. بقية نصوصك تعمل."
        />
      </div>
    {/if}
  </div>
</div>

<style>
  .panel {
    inline-size: var(--size-panel);
    block-size: 100%;
    display: flex;
    flex-direction: column;
    background: var(--surface-paper);
    /* الفاصل عند نهاية اللوحة — الحافة اليسرى في RTL */
    border-inline-end: 1px solid var(--border-subtle);
    /* والظل المتوسط يجعلها **تعلو** الورقة لا تلاصقها: عمودٌ ينزلق
       فوق النص ثم ينسحب عنه، وفارقُ درجةٍ وحدَه لا يقول ذلك — §٦. */
    box-shadow: var(--shadow-mid);
  }
  .body {
    flex: 1 1 auto;
    min-block-size: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-008);
    padding: var(--space-012) var(--space-016);
  }
  .label {
    font: var(--text-ui-09);
    letter-spacing: 0;
    color: var(--text-muted);
    margin: 0;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-004);
  }
  .notice {
    margin-block-start: auto;
    padding-block-start: var(--space-012);
  }
</style>
