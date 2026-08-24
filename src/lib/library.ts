/**
 * أنواع المكتبة والسجل كما تعرضها النواة، وتصفية البحث.
 *
 * الأنواع مرآة لِـ`storage::model` في Rust: `DocumentSummary` و
 * `RevisionSummary`. **لا كيان جديد هنا** — §١٧ مبدأ ١٠.
 */

/** بطاقة مستند في المكتبة — عنوان ومقتطف ووقت. `Luma.md` §٦. */
export interface DocumentCard {
  id: string;
  title: string;
  excerpt: string;
  wordCount: number;
  updatedAt: number;
  lastOpenedAt: number;
}

/** بطاقة لقطة في السجل — بلا محتوى، فالقائمة لا تُحمّل النصوص كلها. */
export interface RevisionCard {
  id: string;
  createdAt: number;
  source: "automatic" | "beforeRestore";
  wordCount: number;
}

/** تعداد المكتبة كما يعود من `list_documents`. */
export interface LibraryListing {
  documents: DocumentCard[];
  /** مستندات تعذّرت قراءتها — تُعرض ولا تُخفى. */
  damaged: string[];
}

/** التشكيل والتطويل لا يُكتبان في البحث عادةً، فلا يجوز أن يمنعا مطابقة. */
const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

/**
 * تطبيع عربي خفيف للمطابقة.
 *
 * الهمزات وصور الألف والياء والتاء المربوطة تُكتب بصور متعدّدة للكلمة
 * الواحدة. بحث لا يوحّدها يفشل على نصّ كتبه المستخدم نفسه.
 */
export function normalize(text: string): string {
  return text
    .replace(TASHKEEL, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * تصفية المكتبة بكلمة بحث.
 *
 * «البحث أداة استرجاع خفيفة داخل المكتبة» — `Luma.md` §٦ **توجه**.
 * يطابق العنوان والمقتطف فقط: لا فهرسة، ولا نصّ كامل، ولا ترتيب بالصلة.
 */
export function filterDocuments(
  documents: readonly DocumentCard[],
  query: string,
): DocumentCard[] {
  const q = normalize(query);
  if (!q) return [...documents];
  return documents.filter((d) =>
    normalize(`${d.title} ${d.excerpt}`).includes(q),
  );
}
