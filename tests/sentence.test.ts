/**
 * حدود الجملة — حبيبة طبقة التركيز.
 *
 * ما يُختبر هنا ليس التقسيم الصحيح بل **ألّا يبقى النص بلا جملة
 * نشطة**: مدًى فارغ يعني تخفيتًا كاملًا، أي شاشةً خافتة كلها ولا شيء
 * «في التركيز» — وهو ما كان يحدث بعد كل نقطةٍ تُنهي فقرة.
 */

import { describe, it, expect } from "vitest";
import { sentenceAt } from "../src/editor/sentence";

const P = "الأفكار تحتاج وقتا. والوقت يحتاج صمتا. وهذا كل شيء.";

describe("لا فقرة بلا جملة نشطة", () => {
  it("المؤشر بعد النقطة الأخيرة يُبقي جملتها نشطة", () => {
    const s = sentenceAt(P, P.length);
    expect(s.end - s.start).toBeGreaterThan(0);
    expect(P.slice(s.start, s.end)).toBe("وهذا كل شيء.");
  });

  it("فقرة من جملة واحدة تنتهي بنقطة — الجملة كلها نشطة", () => {
    const t = "جملة واحدة.";
    expect(sentenceAt(t, t.length)).toEqual({ start: 0, end: t.length });
  });

  it("المؤشر داخل الجملة الأولى", () => {
    expect(P.slice(...Object.values(sentenceAt(P, 5)) as [number, number])).toBe(
      "الأفكار تحتاج وقتا. ",
    );
  });

  it("المؤشر عند بداية جملة تالية ينتمي إليها لا إلى ما قبلها", () => {
    const t = "أ. ب.";
    expect(sentenceAt(t, 3)).toEqual({ start: 3, end: 5 });
  });

  it("فقرة بلا ترقيم كتلةٌ واحدة", () => {
    const t = "نصّ بلا علامات ترقيم";
    expect(sentenceAt(t, 4)).toEqual({ start: 0, end: t.length });
  });

  it("الفاصلة لا تُنهي جملة — تفصل عبارات داخلها", () => {
    const t = "أولًا، ثانيًا، ثالثًا.";
    expect(sentenceAt(t, 3)).toEqual({ start: 0, end: t.length });
  });

  it("أيّ موضع في أيّ نص يعطي مدًى غير فارغ", () => {
    for (const t of [P, "س.", "س", "أ! ب؟ ج…", ".", "أ.  ب"]) {
      for (let i = 0; i <= t.length; i++) {
        const s = sentenceAt(t, i);
        expect(s.end - s.start, `«${t}» عند ${i}`).toBeGreaterThan(0);
      }
    }
  });
});
