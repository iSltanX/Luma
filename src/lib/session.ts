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
  private autosave: Autosave<{
    id: string;
    blocks: Block[];
    title: string | null;
    createdAt: number | null;
  }>;
  private onSaveState: (s: SaveState) => void;
  private onTitleChange: ((t: string) => void) | undefined;

  private documentId: string | null = null;
  private createdAt: number | null = null;
  private explicitTitle: string | null = null;
  /** آخر حالة أُبلغ عنها — تبقى في الذاكرة ولو فشل القرص. */
  private buffer: Block[] = [];

  /**
   * طابور المغادرات — **مغادرة واحدة تعمل في كل لحظة**.
   *
   * الجذر السادس: «نصّ جديد» و«فتح مسودة» كانا بلا حارس إعادة دخول،
   * فنقرتان متتاليتان تتشابكان على الحالة نفسها. الطلبات هنا تُنفَّذ
   * بالترتيب لا تُسقَط — كأن كل نقرة انتظرت اكتمال التي قبلها فعلًا.
   */
  private transition: Promise<void> = Promise.resolve();
  /** أُغلقت الجلسة — مغادرةٌ جديدة بعدها تفشل بصراحة لا بنجاحٍ كاذب. */
  private disposed = false;

  constructor(opts: SessionOptions) {
    this.editor = opts.editor;
    this.bridge = opts.bridge;
    this.onSaveState = opts.onSaveState;
    this.onTitleChange = opts.onTitleChange;

    this.autosave = new Autosave({
      // **العنوان و`createdAt` يصلان في الحمولة — لا يُقرآن حيّين هنا.**
      //
      // كانا يُقرآن من `this` وقت التنفيذ لا وقت الدفع، فكتابةٌ مؤجَّلة
      // من مستند غادره الكاتب تهبط بعد أن يفتح غيره حاملةً **عنوانه
      // وتاريخ إنشائه هو** — إعادة تسمية صامتة لمستند لم يمسّه أحد
      // (الجذر ٥). كل دفعة تحمل هويّة صاحبها منذ لحظتها لا لحظة كتابتها.
      write: async ({ id, blocks, title, createdAt }) => {
        await this.bridge.save({ id, title, blocks, createdAt });
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
   * طابورٌ خالص — لا يلمس `editable`. الأساس الذي يبنى عليه
   * `runTransition` (لـ`open`/`startNew`) و`runExclusive` العامة
   * (لمستهلكين خارج الجلسة يحتاجون القفل نفسه — المعاينة والاستعادة).
   *
   * **جلسةٌ أُغلقت لا تنجح بصمت.** بلا فحص `disposed`، `flush()` على
   * `autosave` مُتصرَّفٍ عنه يعيد `settled` فورًا (لا `pending` بعد
   * التصرّف)، فيمرّ العمل كاملًا — يستبدل المحتوى فعلًا — وكل كتابة
   * تالية تصل `push()` الذي يتجاهلها صامتًا: جلسة تبدو حيّة تمامًا
   * ولا تحفظ حرفًا واحدًا بعد الآن.
   *
   * **`release()` يصل مهما رمى `fn()`.** هي وحدها ما يحلّ وعد
   * `this.transition`، وكل نداء تالٍ لأي عمل حصريّ ينتظره — فلو تعطّل
   * وصولها لتجمّد كل تنقّل بين المستندات إلى نهاية الجلسة.
   */
  private async withQueue<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.transition;
    let release!: () => void;
    this.transition = new Promise((r) => (release = r));
    await prev;
    try {
      if (this.disposed) throw new Error("الجلسة أُغلقت، فلم يُنفَّذ العمل");
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * يُشغّل مغادرةً واحدة، ولا يبدأ التالية إلا بعد اكتمالها. يُغلق
   * الإدخال طوال العمل ويعيده بعده — **للحظة العملية وحدها**، بخلاف
   * `runExclusive` التي لا تلمس `editable` (المعاينة تريده مغلقًا
   * حتى `exitPreview()` لا حتى عودة رحلتها).
   *
   * **الجذر الرابع** — بين `flush()` وإتمام المغادرة نافذةٌ كان المحرر
   * فيها حيًّا يقبل الكتابة (والنقر على زرّ الشريط لا يعصمه: WebKit
   * يُبقي التحديد داخل `contenteditable`). حرفٌ يقع فيها كان يُدفع تحت
   * المعرّف المغادَر، ثم يمحوه `setBlocks` من الشاشة بلا حدث ولا رسالة،
   * ويهبط بعد حين في مستندٍ لم يعد مفتوحًا. الإدخال يُغلق طوال المغادرة
   * فلا تُفتح تلك النافذة من أصلها — والالتقاط في `handleChange` (أعلاه)
   * دفاعٌ ثانٍ: لو أفلت حرفٌ رغم هذا (كتراجعٍ عبر ⌘Z يتجاوز `editable`
   * مباشرة — ثغرةٌ أُغلقت في `EditorCore.undo`/`redo`)، حمل هويّة
   * صاحبه الصحيحة في حمولة `autosave.push`، **ووصولها مضمون**: خانة
   * `Autosave.pending` واحدة غير مفهرَسة كان أول حرف شرعي في المستند
   * الجديد يستبدلها فتُهمَل حمولة اليتيم صامتًا — سُدّ هذا بتفريغٍ
   * أخير قبل إعادة فتح الإدخال (أسفله في `runTransition`)، فتصل قبل
   * أن تُزاحمها كتابةٌ جديدة. مكشوفٌ ومسجَّل في
   * [ADR ٠٠١٨](../../docs/decisions/0018-latent-data-loss-roots.md).
   *
   * **والجذر السادس** — لا حارس إعادة دخول على «نصّ جديد» و«فتح
   * مسودة»: نقرتان متتاليتان (فتح مسودة معلَّق، ثم نصّ جديد) كانتا
   * تتشابكان على الحالة نفسها. الطابور هنا لا يُسقط طلبًا: كل نقرة
   * تنتظر دورها كأنها وقعت بعد اكتمال التي قبلها تمامًا.
   */
  private async runTransition<T>(fn: () => Promise<T>): Promise<T> {
    return this.withQueue(async () => {
      // **`setEditable(true)` مفصولة عن `release()`.** كانتا نداءين
      // متتاليين في كتلة `finally` واحدة؛ لو رمت الأولى استثناءً داخليًّا
      // من ProseMirror، كانت الثانية (`release()`، في `withQueue`) لا
      // تصل — والطابور يتجمّد إلى الأبد. الفصل هنا يضمن وصولها مهما رمى.
      try {
        this.editor.setEditable(false);
        return await fn();
      } finally {
        // **تفريغٌ أخير قبل إعادة فتح الإدخال — الاكتشاف الثاني بعد
        // إصلاح الجذور ٤/٥/٦.**
        //
        // لو أفلت حرفٌ من إغلاق `editable` رغم كل شيء (لا مسار معروف
        // اليوم بعد إغلاق ثغرة `undo`/`redo`، لكنه دفاعٌ في العمق لا
        // يفترض معرفة كل المسارات)، فإنه يدخل `handleChange` قبل أن
        // يتغيّر `documentId` — لا بعده: لا `await` يقع بين تصفير/تبديل
        // `documentId` وعودة `fn()`، فما يُدفع أثناء المغادرة يحمل
        // هويّة المستند **المغادَر** حتمًا، والجذر ٥ يضمن صحّتها في
        // حمولة `push`.
        //
        // لكن الهويّة الصحيحة لا تعني **الوصول**: `Autosave.pending`
        // خانة واحدة غير مفهرَسة، وأول حرف شرعي يكتبه الكاتب في
        // المستند الجديد بعد إعادة فتح الإدخال يستبدلها فورًا —
        // فتُهمَل حمولة اليتيم صامتًا، ولو حملت هويّة صحيحة لن تصل
        // أبدًا. هذا التفريغ يمنحها فرصتها الوحيدة: يقع والإدخال ما
        // زال مغلقًا، فلا كتابة جديدة تزاحمها بعد. لا يُنتظر نجاحه
        // ولا يُرفع فشله — `flush()` لا ترمي أصلًا، والمحاولات
        // المجدولة تتكفّل بالباقي إن رفض القرص.
        await this.autosave.flush();
        this.editor.setEditable(true);
      }
    });
  }

  /**
   * يُشغّل عملًا خارجيًا (معاينة أو استعادة) ضمن طابور المغادرات نفسه
   * — فلا يتشابك مع فتح مسودة أو بدء نصّ جديد.
   *
   * **اكتُشف بمراجعة خصومية بعد إصلاح الجذور ٤/٥/٦:** `preview()`
   * و`restore()` في `App.svelte` كانتا آليةَ قفلٍ مستقلة تمامًا —
   * `setEditable(false)` يدويًّا، بلا طابور — لا تعرف بوجود
   * `runTransition` ولا هو يعرف بوجودها. فمن يضغط «نصّ جديد» أثناء
   * انتظار معاينة رحلتها كان `startNew()` يكتمل بمعزل تام، ثم يعود
   * ردّ المعاينة متأخرًا فيستبدل محتوى المستند **الجديد** بنسخة قديمة
   * لا صلة لها — بلا حدث ولا رسالة، ولافتة «للقراءة فقط» تكذّب محررًا
   * صار قابلًا للكتابة فعلًا.
   *
   * **لا تلمس `editable`** بخلاف `runTransition`: صاحب العمل يتحكم فيه
   * بنفسه لأن مدّة قفله تتجاوز نداءً واحدًا — تبقى المعاينة للقراءة
   * حتى `exitPreview()`، لا حتى عودة رحلة التحميل وحدها.
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.withQueue(fn);
  }

  /**
   * يفتح مستندًا آخر — **بعد حفظ الحالي أولًا**.
   *
   * «فتح نص سابق يستبدل المحتوى الحالي بعد حفظه تلقائيًا» — `Luma.md`
   * §٦ **ثابت**. الحفظ أولًا لا بالتوازي: لو فشل، لا يُستبدل شيء
   * ويبقى المستند الحالي كما هو في المحرر وفي الذاكرة.
   */
  async open(id: string): Promise<void> {
    return this.runTransition(async () => {
      // يُفحص هنا لا قبل الطابور: الحالة وقت التنفيذ لا وقت الطلب.
      if (id === this.documentId) return;
      // «الحفظ أولًا لا بالتوازي: لو فشل، لا يُستبدل شيء» — والجواب
      // يُقرأ الآن بدل أن يُفترض، ويُقال سببُه كما هو لا كما يُظنّ.
      const wrote = await this.flush();
      if (!wrote.settled) throw new NotSettledError(wrote.because, "يُفتح غيره");

      // **يُقرأ المستند الجديد قبل أن يُكنس القديم — لا العكس.**
      //
      // «فشل الفتح يترك المستند الحالي كما هو» — §١٧ مبدأ ٤. لو كُنس
      // الفارغ قبل هذه القراءة، وفشلت هي (تالف، أو معرّف لا يوجد)،
      // بقي الكاتب بلا مستندَين معًا: لا القديم (كُنس) ولا الجديد
      // (فشل). المغادرة لا تصحّ تسميتها مغادرة إلا بعد أن يثبت أن
      // ثمّة موضعًا وصلت إليه فعلًا.
      const doc = await this.bridge.load(id);

      // **مغادرةٌ تكنس** — `discardIfEmpty` مُوصَل منذ بناء السلّة
      // (ADR ٠٠١٩). الثوابت الثلاثة التي أجّلت الوصل ([ADR ٠٠١٨]:
      // التالف الذي يُكتب فوقه، ولقطة الأمان الفارغة، والمعاينة التي
      // لا يراها الفراغ) كانت تجعل المحو **نهائيًا** خطرًا؛ والسلّة
      // تجعله تدارَكًا، فما كان خطرًا صار قابلًا للإصلاح بيد الكاتب.
      // **تُستدعى وdocumentId ما زال يشير إلى القديم** — قبل السطر
      // التالي الذي يستبدله بهويّة الجديد، وإلا كُنس الجديد بالخطأ.
      await this.discardIfEmpty();

      this.documentId = doc.id;
      this.createdAt = doc.createdAt;
      this.explicitTitle = doc.title;
      this.buffer = doc.blocks;
      this.editor.setBlocks(doc.blocks);
      this.onTitleChange?.(this.displayTitle());
    });
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
    return this.runTransition(async () => {
      const wrote = await this.flush();
      if (!wrote.settled) throw new NotSettledError(wrote.because, "يُبدأ غيره");
      // مغادرةٌ تكنس — الشرح عند `open()` أعلاه.
      await this.discardIfEmpty();
      this.documentId = null;
      this.createdAt = null;
      this.explicitTitle = null;
      this.buffer = [];
      this.editor.setBlocks([]);
      this.onTitleChange?.(this.displayTitle());
    });
  }

  /**
   * يحذف المستند المفتوح ثم يفتح مساحة نظيفة — زرّ «الحذف» في شريط
   * الأسطح، `Luma.md` §٥ **ثابت** ([ADR ٠٠١٧](../../docs/decisions/0017-clean-start-and-deletion.md)).
   *
   * **بلا حوار تأكيد بقرار:** «لا يُزيل إلا ما يقرؤه الكاتب الآن،
   * والسلّة هي التدارك». ولذلك لم يكن يجوز شحن هذا الزرّ قبل أن تُبنى
   * السلّة — وقد بُنيت ([ADR ٠٠١٩](../../docs/decisions/0019-trash.md))،
   * فما يمحوه هذا الزرّ يذهب إليها بسجله لا إلى العدم.
   *
   * **يمرّ بالطابور كغيره** (`runTransition`): حذفٌ يتشابك مع فتح مسودة
   * أو معاينة يستبدل أحدهما أثر الآخر بلا حدث ولا رسالة — صنف الأعطال
   * نفسه الذي كشفته مراجعة الجذور ٤ و٥ و٦.
   *
   * **والكتابة تستقرّ قبل المحو.** كتابةٌ معلَّقة تهبط بعد أن ينتقل
   * مجلد المستند إلى السلّة تكتب `Documents/<id>` من جديد: شبحٌ في
   * المكتبة ونسخةٌ في السلّة لمستندٍ واحد. وفشل الاستقرار يمنع الحذف
   * كما يمنع الفتح والبدء — الشرط نفسه لا استثناء له.
   *
   * **يُبلّغ:** `true` إن حُذف شيء، و`false` إن لم يكن ثمّة مستند.
   */
  async deleteCurrent(): Promise<boolean> {
    // **الهدف يُلتقط عند الطلب لا عند الدور** — وهذا وحده ما يجعل
    // «لا يُزيل إلا ما يقرؤه الكاتب الآن» صادقًا.
    //
    // كشفته مراجعة خصومية على القرار ٣ (٢٦ أغسطس ٢٠٢٦) وأعادت إنتاجه:
    // كان `documentId` يُقرأ **داخل** الطابور، فمن نقر صفَّ مسودة «ب»
    // في المكتبة ثم نقر «حذف» قاصدًا «أ» المعروض أمامه، انتظر حذفُه
    // اكتمالَ الفتح — وعندها صار `documentId` هو «ب»، فذهب إلى السلّة
    // مستندٌ لم يُعرض على الشاشة قط، ونجا الذي قصده. والحذف وحده يقع
    // فيه هذا: `open(id)` تأخذ هدفها وسيطًا، و`startNew()` بلا هدف.
    const intended = this.documentId;
    if (!intended) return false;

    return this.runTransition(async () => {
      // تبدّل المستند بين الطلب والدور: لا يُحذف شيء، ويُبلَّغ بذلك.
      if (this.documentId !== intended) return false;
      const id = intended;

      const wrote = await this.flush();
      if (!wrote.settled) throw new NotSettledError(wrote.because, "يُحذف");

      // **المحو أولًا وتصفير الهويّة بعد نجاحه** — عكس ترتيب
      // `discardIfEmpty` عمدًا. ذاك يُصفّر قبل الرحلة لأنه حارسٌ يفترض
      // أن حرفًا قد يقع أثناءها؛ وهنا الإدخال مغلق طوال العملية
      // (`runTransition`) فلا نافذة كتابة أصلًا. والترتيب هنا يشتري ما
      // لا يشتريه ذاك: **فشل المحو يترك المستند على القرص والجلسةَ
      // تعرفه**، فيعيد الكاتب المحاولة. ولو صُفِّرت الهويّة أولًا لبقي
      // نصٌّ على الشاشة لا تعرف الجلسة له مالكًا، وأول حرف بعده يُنشئ
      // مستندًا ثانيًا بمحتوى الأول.
      await this.bridge.remove(id);

      this.documentId = null;
      this.createdAt = null;
      this.explicitTitle = null;
      this.buffer = [];
      this.editor.setBlocks([]);
      this.onTitleChange?.(this.displayTitle());
      return true;
    });
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
      this.autosave.push({
        id: this.documentId,
        blocks,
        title: this.explicitTitle,
        createdAt: this.createdAt,
      });
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
    this.autosave.push({
      id: this.documentId,
      blocks,
      title: this.explicitTitle,
      createdAt: this.createdAt,
    });
  }

  /** عنوان صريح كتبه المستخدم. `null` يعيده إلى الاشتقاق من أول سطر. */
  setTitle(title: string | null): void {
    this.explicitTitle = title && title.trim() ? title.trim() : null;
    this.onTitleChange?.(this.displayTitle());
    if (this.documentId) {
      this.autosave.push({
        id: this.documentId,
        blocks: this.buffer,
        title: this.explicitTitle,
        createdAt: this.createdAt,
      });
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
    this.disposed = true;
    this.autosave.dispose();
  }
}
