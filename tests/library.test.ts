/**
 * منطق المكتبة والسجل الخالص — التصفية وصياغة الزمن والفروق.
 *
 * ما يُختبر هنا لا يحتاج متصفحًا: قواعد `Luma.md` §٦ و§٩ و§١٦.
 */

import { describe, it, expect } from "vitest";
import { filterDocuments, normalize, type DocumentCard } from "../src/lib/library";
import { sinceLabel, wordDelta, words, arabicDigits } from "../src/lib/bidi";

function card(id: string, title: string, excerpt = ""): DocumentCard {
  return {
    id,
    title,
    excerpt,
    wordCount: 10,
    updatedAt: 0,
    lastOpenedAt: 0,
  };
}

// ── التطبيع والبحث ───────────────────────────────────────────

describe("تطبيع البحث العربي", () => {
  it("يوحّد صور الألف", () => {
    expect(normalize("أحمد")).toBe(normalize("احمد"));
    expect(normalize("إسراء")).toBe(normalize("اسراء"));
    expect(normalize("آمال")).toBe(normalize("امال"));
  });

  it("يوحّد الياء والألف المقصورة والتاء المربوطة", () => {
    expect(normalize("مصطفى")).toBe(normalize("مصطفي"));
    expect(normalize("قصيدة")).toBe(normalize("قصيده"));
  });

  it("يتجاهل التشكيل والتطويل", () => {
    expect(normalize("بِسْمِ")).toBe(normalize("بسم"));
    expect(normalize("كــتـب")).toBe(normalize("كتب"));
  });
});

describe("تصفية المكتبة", () => {
  const docs = [
    card("a", "في مديح البطء", "نعيش في عالم يُمجّد السرعة"),
    card("b", "رسالة إلى صديق قديم", "كتبت هذه الرسالة لأعبّر لك"),
    card("c", "بدون عنوان", "استيقظت مبكرًا اليوم"),
  ];

  it("كلمة فارغة تعيد الكل", () => {
    expect(filterDocuments(docs, "")).toHaveLength(3);
    expect(filterDocuments(docs, "   ")).toHaveLength(3);
  });

  it("تطابق العنوان", () => {
    expect(filterDocuments(docs, "مديح").map((d) => d.id)).toEqual(["a"]);
  });

  it("تطابق المقتطف كذلك", () => {
    expect(filterDocuments(docs, "استيقظت").map((d) => d.id)).toEqual(["c"]);
  });

  it("تطابق رغم اختلاف صورة الهمزة", () => {
    expect(filterDocuments(docs, "الي صديق").map((d) => d.id)).toEqual(["b"]);
  });

  it("كلمة لا توجد تعطي حالة «لا نتائج»", () => {
    expect(filterDocuments(docs, "قطار")).toEqual([]);
  });

  it("لا تمسّ المصفوفة الأصلية", () => {
    const out = filterDocuments(docs, "");
    out.pop();
    expect(docs).toHaveLength(3);
  });
});

// ── الزمن بالكلمات ───────────────────────────────────────────

describe("صياغة الزمن — بالكلمات لا بالرموز", () => {
  const NOW = 1_700_000_000_000;
  const M = 60_000;
  const H = 60 * M;
  const D = 24 * H;

  it.each([
    [0, "الآن"],
    [30_000, "الآن"],
    [M, "منذ دقيقة"],
    [2 * M, "منذ دقيقتين"],
    [5 * M, "منذ ٥ دقائق"],
    [45 * M, "منذ ٤٥ دقيقة"],
    [H, "منذ ساعة"],
    [2 * H, "منذ ساعتين"],
    [5 * H, "منذ ٥ ساعات"],
    [D, "أمس"],
    [3 * D, "منذ ٣ أيام"],
    [7 * D, "منذ أسبوع"],
    [21 * D, "منذ ٣ أسابيع"],
    [60 * D, "منذ شهرين"],
    [400 * D, "منذ سنة"],
  ])("قبل %ims → %s", (ago, expected) => {
    expect(sinceLabel(NOW - ago, NOW)).toBe(expected);
  });

  it("لا رمز محايد في أي صيغة — `Luma.md` §١٦ **ثابت**", () => {
    // «١١:٤٥ م» و«+٤٠» تُرسم ملتبسة تحت الاتجاه الثنائي
    const offenders = /[:+\-/·]/;
    for (const ago of [0, M, H, D, 3 * D, 30 * D, 400 * D]) {
      expect(sinceLabel(NOW - ago, NOW)).not.toMatch(offenders);
    }
    expect(wordDelta(60, 20)).not.toMatch(offenders);
    expect(wordDelta(20, 60)).not.toMatch(offenders);
  });

  it("المستقبل لا يعطي زمنًا سالبًا", () => {
    expect(sinceLabel(NOW + 10 * H, NOW)).toBe("الآن");
  });
});

describe("فرق عدد الكلمات", () => {
  it("زيادة ونقص وثبات", () => {
    expect(wordDelta(60, 20)).toBe("زادت ٤٠ كلمة");
    expect(wordDelta(20, 60)).toBe("نقصت ٤٠ كلمة");
    expect(wordDelta(20, 20)).toBe("بلا تغيّر في عدد الكلمات");
  });

  it("يصوغ التمييز صياغة عربية سليمة", () => {
    expect(wordDelta(21, 20)).toBe("زادت كلمة واحدة");
    expect(wordDelta(22, 20)).toBe("زادت كلمتان");
    expect(wordDelta(25, 20)).toBe("زادت ٥ كلمات");
  });
});

describe("الأرقام العربية الهندية في نصوص الواجهة", () => {
  it("لا رقم لاتيني في عدّاد الكلمات", () => {
    expect(words(1234)).toBe("١٢٣٤ كلمة");
    expect(arabicDigits(2026)).toBe("٢٠٢٦");
  });
});
