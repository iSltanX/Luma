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

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "failed"; message: string; attempt: number };

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
  private inFlight = false;
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
   * ينتظر انتهاء أي كتابة جارية ثم يكتب ما تبقّى، حتى لا يُغلق التطبيق
   * على تغيير لم يصل القرص.
   */
  async flush(): Promise<void> {
    if (this.disposed) return;
    this.clearTimers();

    if (this.inFlight) {
      // كتابة جارية: ستلتقط `pending` بعد انتهائها
      return;
    }
    if (this.pending === null) return;

    const payload = this.pending;
    this.inFlight = true;
    this.opts.onState({ kind: "saving" });

    try {
      await this.opts.write(payload);

      // لا يُمحى البُفر إلا بعد نجاح الكتابة — §٥ **ثابت**
      if (this.pending === payload) this.pending = null;
      this.attempt = 0;
      this.opts.onState({ kind: "saved", at: Date.now() });
    } catch (e) {
      // البُفر يبقى كما هو: المحتوى لا يضيع لأن القرص رفض
      this.attempt += 1;
      const message = e instanceof Error ? e.message : String(e);
      this.opts.onState({ kind: "failed", message, attempt: this.attempt });
      this.scheduleRetry();
    } finally {
      this.inFlight = false;
      // تغييرات وصلت أثناء الكتابة
      if (this.pending !== null && this.attempt === 0) {
        this.debounceTimer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
      }
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
