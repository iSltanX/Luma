/**
 * تصدير المستند إلى نصّ — `Luma.md` §٢٠ مسألة ٢٠،
 * [ADR ٠٠٢٠](../../docs/decisions/0020-export.md).
 *
 * **دوالّ خالصة لا تلمس القرص ولا النواة.** الكتابة في Rust خلف لوحة
 * حفظ يختارها المستخدم؛ وهذه تبني النصّ وحده، فتُختبر بلا جسر ولا
 * نافذة عرض.
 *
 * والنموذج يخدم Markdown مباشرةً: `Luma.md` §٣ يجعل المحتوى **قائمة
 * كتل مسطّحة** لا شجرة، وأدوارها خمسة، وعلاماتها واحدة (`strong`).
 * فالخريطة ١:١ بلا فقد — ولا حاجة إلى مُسلسِل عام.
 */

import type { Block, InlineMark } from "../editor/blocks";

/** بادئة كل دور في Markdown. الجسم بلا بادئة. */
const MARKDOWN_PREFIX: Record<Block["role"], string> = {
  body: "",
  h1: "# ",
  h2: "## ",
  h3: "### ",
  quote: "> ",
};

/**
 * يطبّق علامات الوزن على نصّ كتلة.
 *
 * العلامات إزاحات داخل النصّ نفسه (`InlineMark.from`/`to`)، فتُطبَّق
 * **من آخرها إلى أولها**: الإدراج من البداية يزيح ما بعده فتفسد بقية
 * الإزاحات. والمتداخلة أو المقلوبة تُتجاهَل بدل أن تُنتج نصًّا مشوَّهًا.
 */
function applyStrong(text: string, marks: readonly InlineMark[]): string {
  const usable = marks
    .filter((m) => m.type === "strong")
    .filter((m) => m.from >= 0 && m.to <= text.length && m.from < m.to)
    .sort((a, b) => b.from - a.from);

  let out = text;
  let lastFrom = Number.POSITIVE_INFINITY;
  for (const m of usable) {
    // تداخلٌ مع ما طُبِّق قبله: يُترك — `**` داخل `**` لا معنى له
    if (m.to > lastFrom) continue;
    out = `${out.slice(0, m.from)}**${out.slice(m.from, m.to)}**${out.slice(m.to)}`;
    lastFrom = m.from;
  }
  return out;
}

/**
 * أول كتلة فيها نصّ فعلي — هي مصدر العنوان المشتقّ.
 *
 * مرآةُ `Document::display_title` في `storage/model.rs`: يمرّ على الكتل
 * ويأخذ أول سطر غير فارغ.
 */
function firstTextBlockIndex(blocks: readonly Block[]): number {
  return blocks.findIndex((b) => b.text.trim() !== "");
}

/**
 * هل العنوان مشتقٌّ من أول كتلة؟ عندها **لا تُكرَّر**.
 *
 * لا مسار في المنتج اليوم يضبط عنوانًا صريحًا (المكتبة «تعرض وتفتح
 * وتبحث» بلا إعادة تسمية — §٦)، فالعنوان دائمًا أول سطر. وكتابته
 * ترويسةً ثم إعادةُ الكتلة نفسها بعدها تُنتج سطرًا مضاعفًا في كل ملف
 * مصدَّر. والمقارنة تحتمل القصّ: النواة تقصّ العنوان عند ٦٠ محرفًا.
 */
function titleComesFromFirstBlock(title: string, blocks: readonly Block[]): boolean {
  const i = firstTextBlockIndex(blocks);
  if (i < 0) return false;
  const line = blocks[i]!.text.trim();
  // `EditorSession.displayTitle()` يُلحق «…» عند القصّ عند ٦٠ محرفًا،
  // فالمقارنة الحرفية تفشل على أول سطرٍ طويل — ويتكرّر السطر في الملف.
  const t = title.trim().replace(/…$/, "").trimEnd();
  return t !== "" && (line === t || line.startsWith(t));
}

/** ما يحتاجه التصدير — لا مستند التخزين كاملًا. */
export interface ExportDocument {
  readonly title: string;
  readonly blocks: readonly Block[];
}

/**
 * Markdown — الصيغة الأولى.
 *
 * العنوان ترويسةَ `#` في الأعلى؛ فإن كان مشتقًّا من أول كتلة حلّ محلّها
 * ولم يتكرّر. والكتل يفصلها سطر فارغ — وهو فاصل الفقرات في Markdown
 * لا زينة: بدونه تلتحم الفقرتان في واحدة عند العرض.
 */
export function toMarkdown(doc: ExportDocument): string {
  const skip = titleComesFromFirstBlock(doc.title, doc.blocks)
    ? firstTextBlockIndex(doc.blocks)
    : -1;

  const parts: string[] = [`# ${doc.title.trim()}`];

  doc.blocks.forEach((b, i) => {
    if (i === skip) return;
    if (b.text.trim() === "") return; // كتلة فارغة لا تصير سطرًا فارغًا ثالثًا
    parts.push(`${MARKDOWN_PREFIX[b.role]}${applyStrong(b.text, b.marks)}`);
  });

  return `${parts.join("\n\n")}\n`;
}

/**
 * نصّ عادٍ — بلا أي علامة.
 *
 * لا `#` ولا `**`: من يختار `.txt` يريد الحروف وحدها. والعنوان يبقى
 * (قرار المنتج: «العنوان المشتقّ يدخل الملف») سطرًا أولَ بلا تزيين.
 */
export function toPlainText(doc: ExportDocument): string {
  const skip = titleComesFromFirstBlock(doc.title, doc.blocks)
    ? firstTextBlockIndex(doc.blocks)
    : -1;

  const parts: string[] = [doc.title.trim()];

  doc.blocks.forEach((b, i) => {
    if (i === skip) return;
    if (b.text.trim() === "") return;
    parts.push(b.text);
  });

  return `${parts.join("\n\n")}\n`;
}

/** الصيغ المعروضة — ثلاث، وHTML ليست منها (§٢٠ مسألة ٢٠). */
export const EXPORT_FORMATS = ["markdown", "text", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** الامتداد لكل صيغة. */
export const EXTENSION: Record<ExportFormat, string> = {
  markdown: "md",
  text: "txt",
  pdf: "pdf",
};

/**
 * اسم ملفٍ آمن من عنوان عربي.
 *
 * **لا يُنقَّى إلا ما يكسر نظام الملفات**: `/` فاصل مسار على كل نظام،
 * و`:` كان فاصلًا تاريخيًّا في HFS ويظهر في Finder شرطةً مائلة، و`\0`
 * ينهي السلسلة في نداءات النظام. أما العربية والمسافات والتشكيل فتبقى
 * كما هي — macOS يقبلها، وتنقيتُها يشوّه عنوان الكاتب بلا سبب.
 *
 * والنقطة في الأول تُزال: ملفٌ يبدأ بها مخفيّ في Finder.
 */
export function safeFileName(title: string): string {
  const cleaned = title
    // `\u0000` ينهي السلسلة في نداءات النظام، و`/` و`:` يكسران المسار
    .replace(/[/:\u0000]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .trim();
  return cleaned === "" ? "بدون عنوان" : cleaned.slice(0, 60);
}
