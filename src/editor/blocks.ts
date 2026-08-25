/**
 * نموذج المحتوى — `IMPLEMENTATION.md` §٣.
 *
 * المحتوى **قائمة كتل مرتّبة**، لا نصًّا منسَّقًا مؤرشفًا ولا RTF ولا HTML.
 * هذا التزام منتج لا تفصيل تقني: تغيير الخط أو الثيم لا يغيّر بنية المحتوى.
 *
 * لا يستورد هذا الملف شيئًا من التخزين ولا المكتبة ولا الواجهة.
 */

/**
 * الأدوار المعتمدة.
 *
 * كانت ثلاثة، فاعتُمد معها عنوانٌ ثالث واقتباسُ كتلة — والمرشَّحان
 * موسومان في التصميم. **والقائمة مسطّحة لا متداخلة** حين تأتي: نموذج
 * المحتوى «قائمة كتل مرتّبة» (§٣)، ولا تُكسر بنيتُه لأجل زخرفة.
 */
export const BLOCK_ROLES = ["body", "h1", "h2", "h3", "quote"] as const;
export type BlockRole = (typeof BLOCK_ROLES)[number];

/**
 * علامات داخل السطر.
 *
 * **الوزن وحده.** `Luma.md` §٥: «لا مائل. العربية لا تُمال؛ بديل
 * التمييز هو علامة الاقتباس العربية «» أو **الوزن**» — فالغامق هو ما
 * تسمّيه الوثيقة نفسها بديلًا، لا استثناءً منها.
 *
 * ولا يتسرّب بلصق: `handlePaste` يُدخل نصًّا عاديًا دائمًا، فالحارس
 * باقٍ في المسار لا في فقر المخطط.
 */
export const MARK_TYPES = ["strong"] as const;
export type MarkType = (typeof MARK_TYPES)[number];

/** علامة داخل السطر — بإزاحات داخل نصّ الكتلة نفسه. */
export interface InlineMark {
  readonly type: MarkType;
  readonly from: number;
  readonly to: number;
}

export interface Block {
  readonly id: string;
  readonly role: BlockRole;
  readonly text: string;
  readonly marks: readonly InlineMark[];
}

export function isBlockRole(v: unknown): v is BlockRole {
  return typeof v === "string" && (BLOCK_ROLES as readonly string[]).includes(v);
}

let seq = 0;
/**
 * معرّف كتلة.
 *
 * `crypto.randomUUID` حين يتوفر، وإلا عدّاد مع طابع زمني.
 * المعرّف يعيش مع الكتلة ولا يُشتق من موضعها، فإعادة الترتيب لا تغيّره.
 */
export function newBlockId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  seq += 1;
  return `b-${Date.now().toString(36)}-${seq}`;
}

export function createBlock(
  role: BlockRole = "body",
  text = "",
  id: string = newBlockId(),
): Block {
  return { id, role, text, marks: [] };
}

/**
 * المستند الفارغ: كتلة نصية واحدة.
 *
 * ليس Empty State ولا شاشة ترحيب — محرر جاهز ومؤشر. `Luma.md` §٤ **ثابت**
 */
export function emptyDocument(): Block[] {
  return [createBlock("body", "")];
}

/** هل المستند بلا محتوى فعلي؟ يحسمه وجود نص لا وجود كتل. */
export function isEmptyDocument(blocks: readonly Block[]): boolean {
  return blocks.every((b) => b.text.trim() === "");
}

export function wordCount(blocks: readonly Block[]): number {
  let n = 0;
  for (const b of blocks) {
    const t = b.text.trim();
    if (t) n += t.split(/\s+/).length;
  }
  return n;
}

/** مقتطف قصير للمكتبة — بلا محارف تحكم، وبلا قطع في منتصف كلمة. */
export function excerpt(blocks: readonly Block[], max = 120): string {
  const text = blocks
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join(" ")
    // محدِّدات الاتجاه لا تظهر في نص معروض
    .replace(/[⁦-⁩‎‏]/g, "")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
}

/**
 * يتحقق من بنية غير موثوقة ويعيدها كتلًا صالحة.
 *
 * يُستخدم عند قراءة أي مصدر خارجي. لا يرمي: البيانات التالفة تُصلَح
 * أو تُسقَط، ولا يمنع المستخدمَ من الكتابة عطبٌ في كتلة واحدة.
 */
export function coerceBlocks(input: unknown): Block[] {
  if (!Array.isArray(input)) return emptyDocument();
  const out: Block[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const text = typeof r["text"] === "string" ? r["text"] : "";
    const role = isBlockRole(r["role"]) ? r["role"] : "body";
    let id = typeof r["id"] === "string" && r["id"] ? r["id"] : newBlockId();
    if (seen.has(id)) id = newBlockId(); // المعرّفات المكررة تفسد المطابقة
    seen.add(id);
    out.push({ id, role, text, marks: [] });
  }
  return out.length > 0 ? out : emptyDocument();
}

/** تساوي محتوى — يتجاهل المعرّفات، ويُستخدم للمقارنة والاختبار. */
export function sameContent(
  a: readonly Block[],
  b: readonly Block[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return !!y && x.role === y.role && x.text === y.text;
  });
}
