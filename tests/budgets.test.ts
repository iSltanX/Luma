/**
 * حارس الميزانيات — [ADR ٠٠١١](../docs/decisions/0011-performance-budgets.md).
 *
 * الأرقام تعيش في مكانين بالضرورة: `src/dev/budgets.ts` تقيس بها،
 * و`IMPLEMENTATION.md` §١٤ يُعلنها. ومكانان يفترقان: رقمٌ يُشدّ في
 * الكود ويبقى في الوثيقة، فتقرأ الوثيقةُ شيئًا والبوابةُ تفرض غيره.
 *
 * هذا الحارس يمنع ذلك: يقرأ الجدول من الوثيقة ويقارنه بالكود.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUDGETS } from "../src/dev/budgets";

const ROOT = process.cwd();
const IMPL = readFileSync(join(ROOT, "IMPLEMENTATION.md"), "utf8");
const CONF = JSON.parse(
  readFileSync(join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"),
) as { bundle?: { macOS?: { minimumSystemVersion?: string } } };

/** «٢٠٠٠٠» ← 20000. الوثائق بالأرقام العربية الهندية. */
function fromArabic(s: string): number {
  const digits = "٠١٢٣٤٥٦٧٨٩";
  return Number(
    s.replace(/[٠-٩]/g, (d) => String(digits.indexOf(d))).replace(/[^\d.]/g, ""),
  );
}

/**
 * كل معالج قياس فعليّ في `src/dev/selftest.ts` لكل مفتاح في `BUDGETS`.
 *
 * أغلبها `budget(BUDGETS.<key>, …)` — نداء الدالّة الحارسة نفسها.
 * واثنان يُحسمان بمقارنة يدوية داخل `add(...)` بدل الدالّة الحارسة
 * (لأن شرطهما يخلط سقفين معًا)، فيُقاسان بمقارنة `.max` مباشرة، أو
 * عبر لقبٍ يُصدِّره `budgets.ts` نفسه لهذا السقف بعينه.
 */
const ALIASES: Partial<Record<string, string[]>> = {
  libraryDocuments: ["LARGE_LIBRARY"],
  documentWords: ["LARGE_DOCUMENT"],
};

function isGated(key: string, src: string): boolean {
  const helperCall = new RegExp(`budget\\(\\s*BUDGETS\\.${key}\\b`);
  const names = [key, ...(ALIASES[key] ?? [])];
  const maxCompare = names.some((n) => {
    const direct = n === key ? `BUDGETS\\.${n}\\.max` : n;
    return new RegExp(
      `${direct}\\s*(?:<=|>=|<|>)|(?:<=|>=|<|>)\\s*${direct}`,
    ).test(src);
  });
  return helperCall.test(src) || maxCompare;
}

describe("ميزانيات الأداء", () => {
  it("لكل ميزانية معرّف فريد وسقف موجب ووصف عربي وقياسًا حقيقيًا", () => {
    const ids = new Set<string>();
    for (const b of Object.values(BUDGETS)) {
      expect(ids.has(b.id), `معرّف مكرّر: ${b.id}`).toBe(false);
      ids.add(b.id);
      expect(b.max, `${b.id} بسقف غير موجب`).toBeGreaterThan(0);
      expect(b.what, `${b.id} بلا وصف`).toMatch(/[؀-ۿ]/);
      // ميزانية بلا قياس ادّعاءٌ لا رقم — ADR ٠٠١١. غير كافٍ أن يكون
      // النصّ غير الشرطة وحدها: سلسلة فارغة أو نصّ بلا رقم يمرّان
      // بذلك التأكيد أيضًا.
      expect(b.measured, `${b.id} بلا قياس مسجَّل`).not.toBe("—");
      expect(b.measured.trim(), `${b.id} قياسه سلسلة فارغة`).not.toBe("");
      expect(b.measured, `${b.id} قياسه بلا رقم فعلي`).toMatch(/[0-9٠-٩]/);
    }
  });

  it("كل ميزانية يفرضها نداءٌ فعليّ في selftest.ts — لا عضويةً في كائن وحدها", () => {
    // بندُ ب/٩ (ب): «لا شيء يربط BUDGETS[k].id بوجود نداء قياس». حذفُ
    // نداء `budget(BUDGETS.memoryGrowth, …)` كاملًا كان يمرّ خضراء
    // على الاختبارين أعلاه لأن `BUDGETS.memoryGrowth.id/.what` يبقيان
    // مذكورين في مسارَي `add()` الفاشلة — فالمفتاح «موجود» والقياس
    // «غائب»، وهذا يفرّق بينهما.
    const src = readFileSync(join(ROOT, "src/dev/selftest.ts"), "utf8");
    const ungated = Object.entries(BUDGETS)
      .filter(([key]) => !isGated(key, src))
      .map(([key, b]) => `${key} (${b.id})`);
    expect(
      ungated,
      "ميزانيةٌ مُعلَنة في budgets.ts ولا نداء قياس فعليّ لها في selftest.ts",
    ).toEqual([]);
  });

  /**
   * صفوف الجدول بترتيبها — لا أرقامًا مجموعةً بلا هوية.
   *
   * كانت المقارنة على `Set<number>`، فالسقف ١٦ms المكرَّر مرّتين في
   * الجدول (زمن الحرف العادي والمريح) يُبتلَع في مجموعةٍ واحدة —
   * حذفُ صفٍّ كاملٍ من الجدول أو من الكود لا يُغيّر عضوية المجموعة
   * إن بقي ١٦ الآخر. المقارنة هنا على **تسلسل** صفوف مرتَّبةٍ يدويًا
   * بترتيب `BUDGETS`، فكل صفٍّ يقابل مفتاحًا بعينه لا رقمًا عائمًا.
   */
  it("جدول §١٤ يطابق ترتيب BUDGETS صفًّا بصفّ — لا كمجموعة أرقام", () => {
    const table = IMPL.slice(
      IMPL.indexOf("### الميزانيات **مثبَّتة ومحقَّقة**"),
      IMPL.indexOf("## 15. الاختبارات"),
    );
    expect(table.length, "جدول §١٤ غير موجود").toBeGreaterThan(200);

    const rows = [...table.matchAll(/\*\*([٠-٩,]+)\s*(?:ms|MB|كلمة|مستند)\*\*/g)].map(
      (m) => fromArabic(m[1]!),
    );
    const keys = Object.keys(BUDGETS) as (keyof typeof BUDGETS)[];

    expect(
      rows.length,
      `عدد صفوف الجدول (${rows.length}) لا يطابق عدد الميزانيات (${keys.length}) — صفٌّ حُذف أو أُضيف بلا نظيره`,
    ).toBe(keys.length);

    const mismatched: string[] = [];
    keys.forEach((key, i) => {
      const b = BUDGETS[key];
      if (rows[i] !== b.max) {
        mismatched.push(`الصفّ ${i + 1}: الجدول=${rows[i]} الكود[${b.id}]=${b.max}`);
      }
    });
    expect(
      mismatched,
      "ترتيب §١٤ لا يطابق ترتيب BUDGETS، أو رقمٌ في أحدهما تغيّر دون الآخر",
    ).toEqual([]);
  });
});

describe("أدنى إصدار macOS", () => {
  // [ADR ٠٠١٢](../docs/decisions/0012-minimum-macos.md): 13.0 محسوبًا من
  // جرد خصائص المنصة، لا موروثًا. تغييره يحتاج جردًا جديدًا وADR.
  it("مثبَّت على 13.0 كما في ADR ٠٠١٢", () => {
    expect(
      CONF.bundle?.macOS?.minimumSystemVersion,
      "أدنى إصدار macOS تغيّر — يحتاج جردًا جديدًا لخصائص المنصة وADR",
    ).toBe("13.0");
  });

  it("القرار موثَّق ومغلق في §١٨", () => {
    expect(IMPL).toContain("0012-minimum-macos.md");
    expect(IMPL).toContain("0011-performance-budgets.md");
  });
});
