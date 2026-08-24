/**
 * `EditorSession` — حالة مستند مفتوح واحد.
 *
 * تملك: المستند الجاري، وربط المحرر بالحفظ، وحالة الحفظ.
 * **لا تلمس الملفات مباشرة** — §٢. النواة الأصلية تفعل.
 *
 * وجودها هو ما يُبقي `EditorCore` جاهلًا بالتخزين: المحرر يُبلّغ
 * بالتغيير، والجلسة تقرر ماذا يعني ذلك.
 */

import type { Block, EditorCore } from "../editor";
import { Autosave, type SaveState } from "./autosave";

/** يُنشأ المعرّف عند أول محتوى فعلي لا عند فتح المساحة. */
function newDocumentId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `d-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
}

interface Bridge {
  save(payload: {
    id: string;
    title: string | null;
    blocks: Block[];
    createdAt: number | null;
  }): Promise<void>;
  load(id: string): Promise<{
    id: string;
    title: string | null;
    blocks: Block[];
    createdAt: number;
  }>;
  mostRecent(): Promise<string | null>;
}

export interface SessionOptions {
  editor: EditorCore;
  bridge: Bridge;
  onSaveState: (s: SaveState) => void;
  onTitleChange?: (title: string) => void;
}

export class EditorSession {
  private editor: EditorCore;
  private bridge: Bridge;
  private autosave: Autosave<{ id: string; blocks: Block[] }>;
  private onSaveState: (s: SaveState) => void;
  private onTitleChange: ((t: string) => void) | undefined;

  private documentId: string | null = null;
  private createdAt: number | null = null;
  private explicitTitle: string | null = null;
  /** آخر حالة أُبلغ عنها — تبقى في الذاكرة ولو فشل القرص. */
  private buffer: Block[] = [];

  constructor(opts: SessionOptions) {
    this.editor = opts.editor;
    this.bridge = opts.bridge;
    this.onSaveState = opts.onSaveState;
    this.onTitleChange = opts.onTitleChange;

    this.autosave = new Autosave({
      write: async ({ id, blocks }) => {
        await this.bridge.save({
          id,
          title: this.explicitTitle,
          blocks,
          createdAt: this.createdAt,
        });
      },
      onState: (s) => this.onSaveState(s),
    });
  }

  get currentId(): string | null {
    return this.documentId;
  }

  get hasUnsaved(): boolean {
    return this.autosave.hasPending;
  }

  /** المحتوى الحيّ في الذاكرة — المرجع حتى تنجح الكتابة. */
  get contents(): Block[] {
    return this.buffer;
  }

  /**
   * يستأنف آخر مستند، أو يفتح مساحة جديدة إن لم يكن ثمة شيء.
   *
   * «لا يبدأ من المكتبة» — `Luma.md` §٢٠ مسألة ١ **ثابت**.
   */
  async resume(): Promise<void> {
    let id: string | null = null;
    try {
      id = await this.bridge.mostRecent();
    } catch {
      // تعذّر التعداد لا يمنع الكتابة: تُفتح مساحة جديدة
    }
    if (!id) return;

    try {
      const doc = await this.bridge.load(id);

      // **ما كتبه المستخدم قبل أن يجهز الاستئناف لا يُستبدل.**
      //
      // المؤشر حيّ من أول لحظة عمدًا — §١٤: «تظهر مساحة الكتابة قبل
      // تحميل الفهارس والأسطح الثانوية». وبين ظهوره ووصول المستند
      // المستأنف نافذةٌ قِيست ٨٥ms على جهاز سريع، وتطول مع مكتبة
      // كبيرة أو جهاز أبطأ. من كتب فيها كان نصّه يُمحى صامتًا.
      //
      // الفحص هنا لا قبل `load`: الكتابة قد تقع أثناء القراءة نفسها.
      // وما كُتب يبقى ويصير مستندًا جديدًا عبر `handleChange` — ولا
      // يُكتب فوق المستند المستأنف لأن الجلسة لم تتبنَّ معرّفه.
      if (this.editor.getBlocks().some((b) => b.text.trim() !== "")) return;

      this.documentId = doc.id;
      this.createdAt = doc.createdAt;
      this.explicitTitle = doc.title;
      this.buffer = doc.blocks;
      this.editor.setBlocks(doc.blocks);
      this.onTitleChange?.(this.displayTitle());
    } catch {
      // مستند تالف لا يمنع الكتابة — تُفتح مساحة جديدة بدله
      this.documentId = null;
    }
  }

  /**
   * يفتح مستندًا آخر — **بعد حفظ الحالي أولًا**.
   *
   * «فتح نص سابق يستبدل المحتوى الحالي بعد حفظه تلقائيًا» — `Luma.md`
   * §٦ **ثابت**. الحفظ أولًا لا بالتوازي: لو فشل، لا يُستبدل شيء
   * ويبقى المستند الحالي كما هو في المحرر وفي الذاكرة.
   */
  async open(id: string): Promise<void> {
    if (id === this.documentId) return;
    // «الحفظ أولًا لا بالتوازي: لو فشل، لا يُستبدل شيء» — والجواب
    // يُقرأ الآن بدل أن يُفترض.
    if (!(await this.flush())) {
      throw new Error("تعذّر حفظ المستند الحالي، فلم يُفتح غيره");
    }

    const doc = await this.bridge.load(id);
    this.documentId = doc.id;
    this.createdAt = doc.createdAt;
    this.explicitTitle = doc.title;
    this.buffer = doc.blocks;
    this.editor.setBlocks(doc.blocks);
    this.onTitleChange?.(this.displayTitle());
  }

  /**
   * يبدأ نصًّا جديدًا — **بعد حفظ الحالي أولًا**.
   *
   * القاعدة نفسها التي يتبعها `open()`: لو لم يصل النص القرص لا
   * يُستبدل شيء. والمستند الجديد لا يُنشأ هنا بل عند أول محتوى فعلي
   * («بمجرد أول محتوى ينشأ المستند» — `Luma.md` §٤)، فمساحةٌ فارغة
   * تُترك بلا كتابة لا تُخلّف ضجيجًا في المكتبة.
   */
  async startNew(): Promise<void> {
    if (!(await this.flush())) {
      throw new Error("تعذّر حفظ النص الحالي، فلم يُبدأ غيره");
    }
    this.documentId = null;
    this.createdAt = null;
    this.explicitTitle = null;
    this.buffer = [];
    this.editor.setBlocks([]);
    this.onTitleChange?.(this.displayTitle());
  }

  /**
   * يتبنّى محتوى جاء من خارج المحرر — ناتج استعادة نسخة من السجل.
   *
   * النواة كتبته على القرص قبل أن يصل هنا (`restore_revision`)، ومع ذلك
   * يمرّ بمسار الحفظ نفسه: لا يوجد محتوى في المحرر لا تعرفه الجلسة.
   */
  adopt(blocks: Block[]): void {
    this.buffer = blocks;
    this.editor.setBlocks(blocks);
    this.onTitleChange?.(this.displayTitle());
    if (this.documentId) {
      this.autosave.push({ id: this.documentId, blocks });
    }
  }

  /**
   * يُستدعى من `onChange` في المحرر.
   *
   * **المستند يُنشأ عند أول محتوى فعلي** لا عند فتح المساحة:
   * «بمجرد أول محتوى ينشأ المستند ويبدأ الحفظ ويظهر في المكتبة»
   * — `Luma.md` §٤، ومسألة ٣ في §٢٠.
   */
  handleChange(blocks: Block[]): void {
    this.buffer = blocks;

    if (!this.documentId) {
      // المسح بحثًا عن محتوى يقع **قبل إنشاء المستند فقط**. بعده الجواب
      // معروف، وتكراره مع كل ضغطة مفتاح مسحٌ كامل بلا فائدة.
      if (!blocks.some((b) => b.text.trim() !== "")) return;
      this.documentId = newDocumentId();
      this.createdAt = Date.now();
    }

    this.onTitleChange?.(this.displayTitle());
    this.autosave.push({ id: this.documentId, blocks });
  }

  /** عنوان صريح كتبه المستخدم. `null` يعيده إلى الاشتقاق من أول سطر. */
  setTitle(title: string | null): void {
    this.explicitTitle = title && title.trim() ? title.trim() : null;
    this.onTitleChange?.(this.displayTitle());
    if (this.documentId) {
      this.autosave.push({ id: this.documentId, blocks: this.buffer });
    }
  }

  displayTitle(): string {
    if (this.explicitTitle) return this.explicitTitle;
    for (const b of this.buffer) {
      const line = b.text.trim();
      if (line) return line.length > 60 ? `${line.slice(0, 60).trimEnd()}…` : line;
    }
    return "بدون عنوان";
  }

  /**
   * كتابة فورية — فقد التركيز، الإغلاق، تبديل المستند.
   *
   * **يُبلّغ**: `true` إن وصل كل شيء القرص. من ينوي استبدال المحتوى
   * بعده مُلزَمٌ بقراءة الجواب — §٥ **ثابت**.
   */
  flush(): Promise<boolean> {
    return this.autosave.flush();
  }

  dispose(): void {
    this.autosave.dispose();
  }
}
