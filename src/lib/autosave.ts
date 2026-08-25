/**
 * الحفظ التلقائي — `IMPLEMENTATION.md` §٥ **ثابت**.
 *
 * «لا يُسمح لأي خطوة منه بحجب الإدخال.»
 *
 * ```text
 * إدخال → تحديث الكتل في الذاكرة (رخيص)
 *       → تجميع + سقف زمني أقصى
 *       → كتابة ذرّية خارج مسار الإدخال
 *       → تحديث حالة الحفظ
 * ```
 *
 * **لا زر حفظ، ولا اختصار حفظ يدوي، ولا إعداد لتعطيله، ولا فاصل زمني
 * يظهر للمستخدم.**
 */

/** مهلة السكون قبل الكتابة. */
const DEBOUNCE_MS = 700;

/**
 * سقف أقصى أثناء كتابة متصلة.
 *
 * بدونه لا يُكتب شيء ما دام المستخدم يكتب بلا توقف، فيصير حجم ما
 * يمكن فقده بلا حدّ. هذا السقف هو ما يحدّ الخسارة عند الإغلاق القسري.
 */
const MAX_INTERVAL_MS = 5000;

/** إعادة المحاولة بتباعد متزايد — §٥. */
const RETRY_BACKOFF_MS = [1000, 3000, 8000, 20000] as const;

/**
 * حدّ دورات الاستنزاف في `flush` الواحدة.
 *
 * `flush` تكتب حتى يفرغ البُفر لا كتابةً واحدة (انظر عقدها). ولأن كل
 * دورة تنتظر قرصًا، فكاتبٌ لا يتوقف يمكن نظريًا أن يُطيلها بلا حدّ:
 * الحدّ يقطع ذلك، ويعود الجواب **صادقًا** — `false` وفي البُفر بقية —
 * بدل أن يدور إلى الأبد أو يكذب. وفي الاستعمال الواقعي تكفي دورتان:
 * الكتابة أسرع من الفاصل بين ضغطتين.
 */
const DRAIN_ROUNDS = 5;

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "failed"; message: string; attempt: number };

/**
 * نتيجة كتابة فورية.
 *
 * **`settled` وحدها تعني أن لا شيء بقي في البُفر.** وحين لا تستقرّ،
 * السببان مختلفان اختلافًا يراه المستخدم، فلا يُختزلان في بتٍّ واحد:
 *
 * | `because` | ما جرى | ما يقال له |
 * |---|---|---|
 * | `refused` | القرص رفض الكتابة | عطلٌ يحتاج تدخّله: مساحة أو أذونات |
 * | `busy` | كلّ الكتابات نجحت، وتغييرٌ وصل أثناء آخرها | لا عطل — يكفي أن يمهل لحظة |
 *
 * خلطُهما كان يعرض على من لم يتوقف عن الكتابة تشخيصَ عطلِ قرصٍ سليم،
 * وشريطُ الحالة يقول «محفوظ» في اللحظة نفسها.
 */
export type FlushOutcome =
  | { settled: true }
  | { settled: false; because: "refused" | "busy" };

const SETTLED: FlushOutcome = { settled: true };

export interface AutosaveOptions<T> {
  /** يكتب فعلًا. يرمي عند الفشل. */
  write: (payload: T) => Promise<void>;
  onState: (state: SaveState) => void;
}

export class Autosave<T> {
  private opts: AutosaveOptions<T>;
  private pending: T | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private capTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * طابور الكتابة — **كتابة واحدة في كل لحظة**.
   *
   * كل طلب يُعلَّق على سابقه، فلا كتابتان متزامنتان على المسار نفسه،
   * و`flush()` لا يُحلّ إلا بعد أن يفرغ ما قبله.
   */
  private queue: Promise<FlushOutcome> = Promise.resolve(SETTLED);
  private attempt = 0;
  private disposed = false;

  constructor(options: AutosaveOptions<T>) {
    this.opts = options;
  }

  /** هل هناك تغييرات لم تُكتب بعد؟ */
  get hasPending(): boolean {
    return this.pending !== null;
  }

  /**
   * يسجّل تغييرًا. رخيص ولا يحجب: يخزّن آخر حالة ويضبط المؤقتات فقط.
   *
   * آخر حالة تكفي — لا طابور: الحفظ يكتب المستند كاملًا، فالحالات
   * الوسيطة لا معنى لها.
   */
  push(payload: T): void {
    if (this.disposed) return;
    this.pending = payload;

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.flush(), DEBOUNCE_MS);

    // السقف يبدأ مع أول تغيير غير مكتوب ولا يُعاد ضبطه مع كل حرف
    if (this.capTimer === null) {
      this.capTimer = setTimeout(() => void this.flush(), MAX_INTERVAL_MS);
    }
  }

  /**
   * كتابة فورية — عند فقد التركيز أو الإغلاق أو تبديل المستند.
   *
   * **ينتظر أي كتابة جارية ثم يكتب ما تبقّى، ويُبلّغ بالنتيجة.**
   * `settled` تعني أن كل ما في البُفر وصل القرص.
   *
   * كان يعود فورًا إن وجد كتابةً جارية، ويبتلع الفشل ويُحلّ كأن شيئًا
   * لم يكن. فمن ينتظره — فتحُ مستند آخر، أو معاينةُ نسخة، أو إغلاقُ
   * النافذة — كان يمضي فيستبدل المحتوى وهو يظنّه محفوظًا. الاستبدال
   * على وعدٍ كاذب هو بالضبط الطريق إلى فقد نصّ (§٥ **ثابت**).
   *
   * **وكان يكذب مرةً أخرى، أدقّ:** كتابةٌ واحدة ثم `true` — ولو وصل
   * تغييرٌ **أثناءها**. الحرف الذي يُضغط في نافذة الكتابة يبقى في
   * البُفر، والجواب يقول إن كل شيء وصل. فيمضي المُستدعي: يستبدل
   * المحتوى فيُمحى الحرف من الشاشة ويهبط بعد حين في مستندٍ غادره
   * صاحبه، أو يُغلق التطبيق على تغييرٍ لم يصل. ولذلك تستنزف الآن:
   * تكتب حتى يفرغ البُفر، و`settled` تعني **لم يبقَ شيء** لا «كتبتُ
   * مرة». وحين لا تستقرّ، تقول **لماذا**: `refused` عطلُ قرصٍ يحتاج
   * تدخّل صاحبه، و`busy` كاتبٌ لم يتوقف — ولا يُقال للثاني ما يُقال
   * للأول.
   */
  flush(): Promise<FlushOutcome> {
    if (this.disposed) {
      return Promise.resolve(
        this.pending === null ? SETTLED : { settled: false, because: "busy" },
      );
    }
    this.clearTimers();
    this.queue = this.queue.then(
      () => this.drain(),
      () => this.drain(),
    );
    return this.queue;
  }

  /**
   * يكتب حتى يفرغ البُفر — هو ما يجعل عقد `flush` صادقًا.
   *
   * لا تُستدعى إلا من داخل الطابور، فلا دورتان متزامنتان.
   */
  private async drain(): Promise<FlushOutcome> {
    for (let round = 0; round < DRAIN_ROUNDS; round += 1) {
      if (this.pending === null) return SETTLED;
      if (this.disposed) break;
      if (!(await this.writePending())) {
        return { settled: false, because: "refused" };
      }
    }

    if (this.pending === null) return SETTLED;

    // بلغ الحدّ وكلّ كتابةٍ نجحت: لا عطل هنا، بل كاتبٌ يسبق القرص.
    // البقية تُترك لمؤقّت السكون، والجواب صادق ومتمايز.
    if (!this.disposed && this.debounceTimer === null) {
      this.debounceTimer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
    }
    return { settled: false, because: "busy" };
  }

  /** كتابة واحدة لما في البُفر. لا تُستدعى إلا من داخل `drain`. */
  private async writePending(): Promise<boolean> {
    if (this.disposed) return this.pending === null;

    const payload = this.pending;
    if (payload === null) return true;

    this.opts.onState({ kind: "saving" });
    try {
      await this.opts.write(payload);

      // لا يُمحى البُفر إلا بعد نجاح الكتابة — §٥ **ثابت**
      if (this.pending === payload) this.pending = null;
      this.attempt = 0;
      // **نجاحٌ يُبطل إعادة محاولة معلَّقة من فشلٍ سبقه.** بقاؤها يوقظ
      // كتابةً لما وصل القرص أصلًا، فتومض «جارٍ الحفظ» بلا سبب.
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      this.opts.onState({ kind: "saved", at: Date.now() });

      // ما وصل أثناء الكتابة يتولّاه `drain` في دورته التالية — ولا
      // يُجدوَل هنا مؤقّتٌ يَعِد بكتابةٍ ويترك الجواب كاذبًا.
      return true;
    } catch (e) {
      // البُفر يبقى كما هو: المحتوى لا يضيع لأن القرص رفض
      this.attempt += 1;
      const message = e instanceof Error ? e.message : String(e);
      this.opts.onState({ kind: "failed", message, attempt: this.attempt });
      this.scheduleRetry();
      return false;
    }
  }

  private scheduleRetry(): void {
    if (this.disposed) return;
    const idx = Math.min(this.attempt - 1, RETRY_BACKOFF_MS.length - 1);
    const delay = RETRY_BACKOFF_MS[idx] ?? 20000;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.flush(), delay);
  }

  private clearTimers(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.capTimer) {
      clearTimeout(this.capTimer);
      this.capTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
  }
}

export const AUTOSAVE_TIMING = {
  DEBOUNCE_MS,
  MAX_INTERVAL_MS,
  RETRY_BACKOFF_MS,
} as const;
