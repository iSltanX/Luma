import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Autosave, AUTOSAVE_TIMING, type SaveState } from "../src/lib/autosave";

const { DEBOUNCE_MS, MAX_INTERVAL_MS } = AUTOSAVE_TIMING;

function harness(write: (p: string) => Promise<void>) {
  const states: SaveState[] = [];
  const a = new Autosave<string>({ write, onState: (s) => states.push(s) });
  return { a, states, kinds: () => states.map((s) => s.kind) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("الحفظ التلقائي", () => {
  it("لا يكتب قبل انقضاء مهلة السكون", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const { a } = harness(write);
    a.push("أ");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 50);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60);
    expect(write).toHaveBeenCalledOnce();
    a.dispose();
  });

  it("الكتابة المتصلة لا تؤجّل الحفظ إلى ما لا نهاية — السقف يفرض كتابة", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const { a } = harness(write);
    // حرف كل ١٠٠ms: مهلة السكون لا تنقضي أبدًا
    for (let t = 0; t < MAX_INTERVAL_MS + 500; t += 100) {
      a.push(`نص${t}`);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(write).toHaveBeenCalled();
    a.dispose();
  });

  it("يكتب آخر حالة فقط لا كل حالة وسيطة", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const { a } = harness(write);
    a.push("أ");
    a.push("أب");
    a.push("أبج");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith("أبج");
    a.dispose();
  });

  it("يمرّ بحالتَي «جارٍ الحفظ» ثم «محفوظ»", async () => {
    const { a, kinds } = harness(() => Promise.resolve());
    a.push("أ");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(kinds()).toEqual(["saving", "saved"]);
    a.dispose();
  });

  it("عند الفشل: يبقى البُفر وتظهر «تعذّر الحفظ»", async () => {
    const write = vi.fn().mockRejectedValue(new Error("القرص ممتلئ"));
    const { a, states } = harness(write);
    a.push("نص ثمين");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    const last = states.at(-1);
    expect(last?.kind).toBe("failed");
    expect(last).toMatchObject({ message: "القرص ممتلئ" });
    // البُفر لم يُمحَ: المحتوى لا يضيع لأن القرص رفض
    expect(a.hasPending).toBe(true);
    a.dispose();
  });

  it("يعيد المحاولة بتباعد متزايد حتى ينجح", async () => {
    let calls = 0;
    const write = vi.fn().mockImplementation(() => {
      calls += 1;
      return calls < 3 ? Promise.reject(new Error("مؤقت")) : Promise.resolve();
    });
    const { a, kinds } = harness(write);
    a.push("نص");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(kinds().at(-1)).toBe("failed");

    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(3500);

    expect(kinds().at(-1)).toBe("saved");
    expect(a.hasPending).toBe(false);
    a.dispose();
  });

  it("الكتابة الفورية لا تنتظر مهلة السكون", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const { a } = harness(write);
    a.push("أ");
    await a.flush();
    expect(write).toHaveBeenCalledOnce();
    a.dispose();
  });

  it("الكتابة الفورية بلا تغييرات لا تكتب شيئًا", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const { a } = harness(write);
    await a.flush();
    expect(write).not.toHaveBeenCalled();
    a.dispose();
  });

  it("التغيير أثناء كتابة جارية لا يضيع", async () => {
    let release: (() => void) | undefined;
    const write = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((r) => (release = r)),
      )
      .mockResolvedValue(undefined);
    const { a } = harness(write);

    a.push("الأولى");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(write).toHaveBeenCalledTimes(1);

    a.push("الثانية"); // وصل أثناء الكتابة
    release?.();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50);

    expect(write).toHaveBeenLastCalledWith("الثانية");
    a.dispose();
  });

  /**
   * **عقد `flush`: `true` تعني لم يبقَ شيء، لا «كتبتُ مرة».**
   *
   * كان يكتب كتابةً واحدة ثم يُبلّغ بالنجاح ولو وصل تغييرٌ أثناءها،
   * فيمضي المُستدعي — يستبدل المحتوى أو يُغلق النافذة — على وعدٍ كاذب.
   * وهذا الحارس يرصد الوعد نفسه لا عدد الكتابات.
   */
  it("الوعد بالنجاح لا يصدر وفي البُفر بقية", async () => {
    let release: (() => void) | undefined;
    const write = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
      .mockResolvedValue(undefined);
    const { a } = harness(write);

    a.push("الأولى");
    const promised = a.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(1);

    // الحرف الذي يُضغط **أثناء** الكتابة
    a.push("الثانية");
    release?.();

    await expect(promised).resolves.toEqual({ settled: true });
    // ولا يكون ذلك صادقًا إلا وقد وصلت «الثانية» فعلًا
    expect(write).toHaveBeenLastCalledWith("الثانية");
    expect(a.hasPending).toBe(false);
    a.dispose();
  });

  it("الفشل بعد تغييرٍ أثناء الكتابة يُبلَّغ به لا يُبتلع", async () => {
    let release: (() => void) | undefined;
    const write = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
      .mockRejectedValue(new Error("القرص ممتلئ"));
    const { a } = harness(write);

    a.push("الأولى");
    const promised = a.flush();
    await vi.advanceTimersByTimeAsync(0);
    a.push("الثانية");
    release?.();

    await expect(promised).resolves.toEqual({
      settled: false,
      because: "refused",
    });
    expect(a.hasPending).toBe(true);
    a.dispose();
  });

  /**
   * **`busy` ليس عطلًا، و`refused` عطل — ولا يُخلطان.**
   *
   * كان الجواب بتًّا عاريًا، فيُعرض على من لم يتوقف عن الكتابة تشخيصُ
   * عطلِ قرصٍ سليم («أفرغ مساحة أو تحقّق من الأذونات») وشريطُ الحالة
   * يقول «محفوظ» في اللحظة نفسها. هذا الحارس يرصد التمييز لا النتيجة.
   */
  it("كاتبٌ يسبق القرص يُبلَّغ `busy` لا عطلَ قرص", async () => {
    // يدفع حرفًا داخل نافذة كل كتابة: البُفر لا يفرغ أبدًا
    const write = vi.fn().mockImplementation(async () => {
      a.push(`حرف-${write.mock.calls.length}`);
    });
    const { a, kinds } = harness(write);

    a.push("الأولى");
    const outcome = await a.flush();

    expect(outcome).toEqual({ settled: false, because: "busy" });
    // ولا فشلَ واحدًا: كل الكتابات نجحت — فليس عطلًا
    expect(kinds()).not.toContain("failed");
    expect(a.hasPending).toBe(true);
    a.dispose();
  });

  it("بعد التخلّص لا يكتب شيئًا", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const { a } = harness(write);
    a.push("أ");
    a.dispose();
    await vi.advanceTimersByTimeAsync(MAX_INTERVAL_MS * 2);
    expect(write).not.toHaveBeenCalled();
  });
});
