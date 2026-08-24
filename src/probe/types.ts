/**
 * عقد المقارنة بين أسس نواة المحرر — المرحلة ١.
 *
 * كل مرشح يجب أن يحقق القدرات الخمس في `IMPLEMENTATION.md` §١.
 * المرشح الذي يعجز عن واحدة يسقط، ولا يُعوَّض العجز بكود مكتوب يدويًا.
 *
 * هذا الملف أداة قياس مؤقتة. المرحلة ٢ تستبدله بـ`EditorCore` حقيقي.
 */

/** أدوار الكتل المعتمدة — `Luma.md` §٥. لا مائل، ولا تنسيق غني. */
export type BlockRole = "body" | "h1" | "h2";

/** علامة داخل السطر — فارغة حتى تُعتمد مجموعة التنسيق المرشحة. */
export interface InlineMark {
  readonly type: string;
  readonly from: number;
  readonly to: number;
}

/** الكتلة: مصدر المحتوى الوحيد — `IMPLEMENTATION.md` §٣. */
export interface Block {
  id: string;
  role: BlockRole;
  text: string;
  marks: InlineMark[];
}

/** القدرات الخمس التي يُحكم بها على المرشح. */
export interface CapabilityReport {
  /** ١ — تحكم في التمرير بحسب موضع المؤشر. */
  caretRect: boolean;
  /** ٢ — طبقة عرض تخفت المحيط بلا لمس النموذج. */
  focusDecorations: boolean;
  /** ٣ — صحة العربية: اتجاه أساسي مصرَّح به وتحديد سليم. */
  arabicDirection: boolean;
  /** ٤ — تجميع التراجع بحسب دفقة الكتابة. */
  undoGrouping: boolean;
  /** ٥ — تخطيط لا يعيد رسم المستند كله مع كل حرف. */
  incrementalLayout: boolean;
}

export interface EditorCandidate {
  readonly id: string;
  readonly name: string;
  /** ما الذي يوفّره الأساس نفسه دون كتابة يدوية. */
  readonly capabilities: CapabilityReport;

  mount(host: HTMLElement, initial: Block[]): void;
  destroy(): void;

  getBlocks(): Block[];
  focus(): void;

  /** مستطيل المؤشر في إحداثيات النافذة — أساس وضع الآلة الكاتبة. */
  caretRect(): DOMRect | null;

  /** تفعيل تخفيت المحيط. يجب ألا يغيّر `getBlocks()` إطلاقًا. */
  setFocusMode(enabled: boolean): void;

  /** عدد عمليات التراجع المتاحة — لقياس التجميع. */
  undoDepth(): number;
  undo(): void;

  /**
   * بصمة النموذج المرجعي — لا الـDOM المعروض.
   *
   * هذا هو الفيصل في القدرة ٢: التخفيت يجب ألّا يغيّر هذه البصمة.
   * عند مرشح يكون الـDOM نفسه هو النموذج، فأي صنف يُكتب عليه
   * يغيّر البصمة — وهذا بالضبط ما تمنعه §٧.
   */
  modelSignature(): string;

  /** هل يتيح الأساس ضبط نافذة تجميع التراجع برمجيًا؟ */
  readonly undoGroupingIsConfigurable: boolean;
}
