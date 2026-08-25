/**
 * قرار الإغلاق حين لا يصل النص القرص.
 *
 * كان مدفونًا في ردّ نداء `listen` داخل `App.svelte`، فلم يكن في
 * `verify` سطرٌ يلمسه: أربعة أعطال تفقد نصًّا أو تحبس الكاتب مرّت
 * كلها والاختبارات خضراء. هذا أول حارس عليه، وكل حالة هنا عطلٌ وقع.
 */

import { describe, it, expect, vi } from "vitest";
import { createCloseRequest, type WarnReason } from "../src/lib/closing";
import type { FlushOutcome } from "../src/lib/autosave";

const settled: FlushOutcome = { settled: true };
const refused: FlushOutcome = { settled: false, because: "refused" };
const busy: FlushOutcome = { settled: false, because: "busy" };

/** يرصد التسلسل: الترتيب هو موضوع أكثر هذه الحالات. */
function harness(outcomes: FlushOutcome[]) {
  const calls: string[] = [];
  let i = 0;
  const req = createCloseRequest({
    flush: async () => {
      calls.push("flush");
      return outcomes[Math.min(i++, outcomes.length - 1)]!;
    },
    clearOverlays: () => calls.push("clearOverlays"),
    warn: (b: WarnReason) => calls.push(`warn:${b}`),
    decline: async () => void calls.push("decline"),
    destroy: async () => void calls.push("destroy"),
  });
  return { calls, req };
}

describe("الإغلاق حين لا يصل النص القرص", () => {
  it("وصل النص: يُهدَم بلا تحذير", async () => {
    const { calls, req } = harness([settled]);
    await req.request();
    expect(calls).toEqual(["flush", "destroy"]);
  });

  it("رفضٌ أول: يُحذَّر ويُخلى ما يحجب التحذير، ولا يُهدَم", async () => {
    const { calls, req } = harness([refused]);
    await req.request();
    expect(calls).toEqual(["flush", "clearOverlays", "warn:refused", "decline"]);
  });

  /** «فرصة استرجاع صريحة» فرصةٌ لا حبس: من أُبلغ ثم أصرّ اختار عن علم. */
  it("إصرارٌ بعد التحذير: يُهدَم ولا يُحبس الكاتب", async () => {
    const { calls, req } = harness([refused, refused]);
    await req.request();
    await req.request();
    expect(calls.filter((c) => c.startsWith("warn:"))).toEqual(["warn:refused"]);
    expect(calls.at(-1)).toBe("destroy");
  });

  /**
   * تحذير `busy` الحميد («لا عطل — أمهله لحظة») لا يصلح إذنًا للهدم
   * حين صار القرص يرفض: ثمنُ الإصرار اختلف، ورسالةُ العلاج لم تُعرض.
   */
  it("تبدُّل السبب من `busy` إلى `refused`: تحذيرٌ جديد لا هدم", async () => {
    const { calls, req } = harness([busy, refused]);
    await req.request();
    await req.request();
    expect(calls.filter((c) => c.startsWith("warn:"))).toEqual([
      "warn:busy",
      "warn:refused",
    ]);
    expect(calls).not.toContain("destroy");
  });

  /** حفظٌ نجح: تحذيرٌ عن نصّ وصل لا يُصرف على نصٍّ كُتب بعده. */
  it("حفظٌ ناجح بين المحاولتين يُعيد التحذير", async () => {
    const { calls, req } = harness([refused, refused]);
    await req.request();
    req.noteSaved();
    await req.request();
    expect(calls.filter((c) => c.startsWith("warn:"))).toEqual([
      "warn:refused",
      "warn:refused",
    ]);
    expect(calls).not.toContain("destroy");
  });

  /**
   * **الاستنزاف نفسه يبثّ «محفوظ».**
   *
   * فرع `busy` كلّ كتاباته ناجحة، وكل نجاح يُصفّر التحذير عبر
   * `noteSaved`. فلو قُرئت الحالة **بعد** الحفظ لرآها القرار مصفَّرة
   * دائمًا: يُحذَّر الكاتب في كل محاولة ولا يُغلق أبدًا — حبسٌ من باب
   * آخر. اللقطة قبل النداء هي ما يحسمه.
   */
  it("«محفوظ» أثناء الاستنزاف لا يمحو التحذير الذي يُقيَّم", async () => {
    const calls: string[] = [];
    let first = true;
    const req: ReturnType<typeof createCloseRequest> = createCloseRequest({
      flush: async () => {
        // كتابةٌ نجحت أثناء الاستنزاف ثم امتلأ البُفر من جديد
        if (!first) req.noteSaved();
        first = false;
        return busy;
      },
      clearOverlays: () => {},
      warn: (b) => calls.push(`warn:${b}`),
      decline: async () => void calls.push("decline"),
      destroy: async () => void calls.push("destroy"),
    });

    await req.request();
    await req.request();

    expect(calls.filter((c) => c.startsWith("warn:"))).toEqual(["warn:busy"]);
    expect(calls).toContain("destroy");
  });

  /**
   * طلبان متزامنان كانا يعدّان «إصرارًا» بلا تحذيرٍ مقروء: الضغطة
   * الثانية تسبق وجود التحذير، فيُهدَم على نصٍّ لم يُقرأ عنه شيء.
   */
  it("طلبان متزامنان: لا يُهدَم على تحذير لم يُعرض", async () => {
    const calls: string[] = [];
    let release: (() => void) | undefined;
    const req = createCloseRequest({
      flush: async () => {
        calls.push("flush");
        await new Promise<void>((r) => (release = r));
        return refused;
      },
      clearOverlays: () => calls.push("clearOverlays"),
      warn: (b) => calls.push(`warn:${b}`),
      decline: async () => void calls.push("decline"),
      destroy: async () => void calls.push("destroy"),
    });

    const first = req.request();
    await Promise.resolve();
    await req.request(); // الثاني يقع والأول معلَّق
    release?.();
    await first;

    expect(calls).not.toContain("destroy");
    expect(calls.filter((c) => c === "flush")).toHaveLength(1);
  });

  /**
   * والطلب المُسقَط لا يُبتلع صامتًا: النواة أخذت مزلاجها قبل أن تبثّ،
   * فتركُه مأخوذًا يجعل الزر الأحمر و⌘W بابًا ميتًا لا صوت له.
   */
  it("الطلب المُسقَط يفتح مزلاج النواة", async () => {
    const calls: string[] = [];
    let release: (() => void) | undefined;
    const req = createCloseRequest({
      flush: async () => {
        await new Promise<void>((r) => (release = r));
        return settled;
      },
      clearOverlays: () => {},
      warn: () => {},
      decline: async () => void calls.push("decline"),
      destroy: async () => void calls.push("destroy"),
    });

    const first = req.request();
    await Promise.resolve();
    await req.request();
    expect(calls).toContain("decline");
    release?.();
    await first;
  });

  it("الحارس يُحرَّر بعد كل طلب — ولو رمى الأثر", async () => {
    const req = createCloseRequest({
      flush: async () => {
        throw new Error("انهيار");
      },
      clearOverlays: () => {},
      warn: () => {},
      decline: async () => {},
      destroy: async () => {},
    });
    await expect(req.request()).rejects.toThrow();
    // لو بقي الحارس مأخوذًا لصار كل إغلاق تالٍ صامتًا
    const after = vi.fn();
    const req2 = createCloseRequest({
      flush: async () => settled,
      clearOverlays: () => {},
      warn: () => {},
      decline: async () => {},
      destroy: async () => void after(),
    });
    await req2.request();
    expect(after).toHaveBeenCalled();
  });
});
