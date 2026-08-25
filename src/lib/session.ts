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
import { Autosave, type FlushOutcome, type SaveState } from "./autosave";

/**
 * لم يستقرّ النص على القرص، فلم تقع المغادرة.
 *
 * يحمل **السبب** لا الخبر وحده: من يعرض الرسالة يحتاج التمييز بين
 * قرصٍ رفض — وعلاجه عند صاحبه — وكاتبٍ لم يتوقف، ولا علاج له إلا
 * لحظة. وخلطُهما كان يعرض تشخيص عطلِ قرصٍ سليم.
 */
export class NotSettledError extends Error {
  constructor(
    readonly because: "refused" | "busy",
    action: string,
  ) {
    super(
      because === "refused"
        ? `تعذّر حفظ النص الحالي، فلم ${action}`
        : `النص الحالي ما زال يصل القرص، فلم ${action} بعد`,
    );
    this.name = "NotSettledError";
  }
}

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
  remove(id: string): Promise<void>;
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

    // **ما كُتب قبل أن توجد الجلسة تتبنّاه الجلسة.**
    //
    // المؤشر حيّ من أول لحظة عمدًا (§١٤)، والجلسة تُنشأ بعده. وما
    // يُكتب في تلك النافذة لا يبلغ `handleChange` — لأن `session` كان
    // `null` حين وقع `onChange` — فيبقى في المحرر وحده: لا يعرفه
    // الحفظ التلقائي، ولا يعدّه `flush()` معلَّقًا، فيقول **صادقًا** إن
    // كل شيء وصل القرص. ثم يُستبدل المحرر عند فتح مستند آخر فيختفي
    // النص بلا أثر ولا رسالة.
    //
    // ويكفي أن تُسأل الحالةُ الراهنة مرة عند الإنشاء.
    const existing = this.editor.getBlocks();
    if (existing.some((b) => b.text.trim() !== "")) {
      this.handleChange(existing);
    }
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

  /** الفراغ يحسمه النص لا عدد الكتل — `Luma.md` §٤. */
  private get isEmpty(): boolean {
    return !this.buffer.some((b) => b.text.trim() !== "");
  }

  /**
   * يحذف المستند الحالي إن كان فارغًا — **عند المغادرة وحدها**.
   *
   * «المستند الفارغ لا يبقى بعد مغادرته» — `Luma.md` §٤ **ثابت**
   * ([ADR ٠٠١٧](../../docs/decisions/0017-clean-start-and-deletion.md)).
   * والمغادرة ثلاث: بدء نصّ جديد، وفتح مسودة أخرى، وإغلاق التطبيق.
   *
   * **لا يُستدعى إلا بعد `flush()` ناجح، والترتيب ليس تفصيلًا.**
   * الحذف يتسابق مع الحفظ التلقائي: البُفر يسبق القرص دائمًا، فلو
   * قُرئ الفراغ وكتابةٌ معلَّقة لم تصل بعد، حُذف مستندٌ لم يكن فارغًا
   * — أو وصلت الكتابة بعد الحذف فبعثته من جديد. وبعد `flush()` ناجح
   * وحده يصير البُفر خبرًا صادقًا عن القرص: `pending` فارغ، فما يُقرأ
   * هنا هو ما استقرّ هناك.
   *
   * وفشل الحفظ يمنع الحذف من أصله: من يستدعيه يتوقف قبل أن يبلغه.
   *
   * **يُبلّغ:** `true` إن حُذف شيء.
   */
  async discardIfEmpty(): Promise<boolean> {
    const id = this.documentId;
    if (!id || !this.isEmpty) return false;

    // **كتابةٌ لم تصل القرص تمنع المحو.**
    //
    // عقد `flush` صار صادقًا (يستنزف ويقول لماذا لم يستقرّ)، ومع ذلك
    // يبقى هذا الفحص لازمًا لعلّةٍ أخرى: `pending` لا يُمحى إلا بعد
    // نجاح الكتابة، فيبقى مملوءًا طوال كتابةٍ **جارية**؛ وبين حلّ
    // `flush` عند المُستدعي وبلوغ هذا السطر دوراتٌ مجهرية والمحرر
    // فيها حيّ. فمن يحذفه ظنًّا أنه صار زائدًا يفتح البابَ نفسه:
    // محوٌ وكتابةُ حمولةٍ غير فارغة لذلك المعرّف ما زالت في الطريق،
    // فتهبط بعده وتبعث المستند. والفحص يفشل **آمنًا**: يبقى صفٌّ
    // فارغ، ولا يُمحى ما لم يستقرّ.
    if (this.autosave.hasPending) return false;

    // **المعرّف يُصفَّر قبل الرحلة لا بعدها.** بين طلب المحو وعودته
    // نافذةُ IPC كاملة، والمحرر فيها يقبل الكتابة: حرفٌ واحد يقع
    // فيها كان يُدفع تحت المعرّف القديم فيبعث المستند بعد محوه. وبعد
    // التصفير يصير ذلك الحرف مستندًا جديدًا كما ينبغي.
    this.documentId = null;
    this.createdAt = null;
    this.explicitTitle = null;

    await this.bridge.remove(id);
    return true;
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
    // يُقرأ الآن بدل أن يُفترض، ويُقال سببُه كما هو لا كما يُظنّ.
    const wrote = await this.flush();
    if (!wrote.settled) throw new NotSettledError(wrote.because, "يُفتح غيره");

    // ⚠️ **مغادرةٌ لا تكنس بعد** — `discardIfEmpty` مبنيّ وغير موصول.
    // الوصل معلَّق على ثوابت تصطدم بالقرار ولم تُحسم ([ADR ٠٠١٨]):
    // التالف الذي يُكتب فوقه، ولقطة الأمان الفارغة، والمعاينة التي لا
    // يراها الفراغ. (وعقدُ `flush` كان رابعها ورُفع.) الوصل هنا سطرٌ
    // واحد يوم تُحسم الثلاثة — ولا يُوصل قبلها: المحو نهائي ولا سلّة.
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
    const wrote = await this.flush();
    if (!wrote.settled) throw new NotSettledError(wrote.because, "يُبدأ غيره");
    // ⚠️ مغادرةٌ لا تكنس بعد — الشرح عند `open()` أعلاه.
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
   * **يُبلّغ**: `settled` إن وصل كل شيء القرص، ولماذا لم يستقرّ إن لم
   * يصل. من ينوي استبدال المحتوى بعده مُلزَمٌ بقراءة الجواب — §٥
   * **ثابت** — ومن يعرض رسالةً مُلزَمٌ بقراءة سببه.
   */
  flush(): Promise<FlushOutcome> {
    return this.autosave.flush();
  }

  dispose(): void {
    this.autosave.dispose();
  }
}
