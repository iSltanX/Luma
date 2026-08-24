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

describe("ميزانيات الأداء", () => {
  it("لكل ميزانية معرّف فريد وسقف موجب ووصف عربي", () => {
    const ids = new Set<string>();
    for (const b of Object.values(BUDGETS)) {
      expect(ids.has(b.id), `معرّف مكرّر: ${b.id}`).toBe(false);
      ids.add(b.id);
      expect(b.max, `${b.id} بسقف غير موجب`).toBeGreaterThan(0);
      expect(b.what, `${b.id} بلا وصف`).toMatch(/[؀-ۿ]/);
      // ميزانية بلا قياس ادّعاءٌ لا رقم — ADR ٠٠١١
      expect(b.measured, `${b.id} بلا قياس مسجَّل`).not.toBe("—");
    }
  });

  it("كل سقف في الكود مذكور بحرفه في §١٤", () => {
    const missing: string[] = [];
    // الجدول وحده لا الوثيقة كلها: رقمٌ عابر في نصّ آخر ليس إعلانًا
    const table = IMPL.slice(
      IMPL.indexOf("### الميزانيات **مثبَّتة ومحقَّقة**"),
      IMPL.indexOf("## 15. الاختبارات"),
    );
    expect(table.length, "جدول §١٤ غير موجود").toBeGreaterThan(200);

    const numbers = new Set(
      [...table.matchAll(/\*\*([٠-٩,]+)\s*(?:ms|MB|كلمة|مستند)\*\*/g)].map((m) =>
        fromArabic(m[1]!),
      ),
    );
    for (const b of Object.values(BUDGETS)) {
      if (!numbers.has(b.max)) missing.push(`${b.id} = ${b.max}${b.unit}`);
    }
    expect(
      missing,
      "سقفٌ في الكود لا يقابله رقم في جدول §١٤ — الوثيقة والبوابة افترقتا",
    ).toEqual([]);
  });

  it("كل صفّ في جدول §١٤ يقابله سقف في الكود", () => {
    const table = IMPL.slice(
      IMPL.indexOf("### الميزانيات **مثبَّتة ومحقَّقة**"),
      IMPL.indexOf("## 15. الاختبارات"),
    );
    const declared = [...table.matchAll(/\*\*([٠-٩,]+)\s*(?:ms|MB|كلمة|مستند)\*\*/g)]
      .map((m) => fromArabic(m[1]!));
    const inCode = new Set<number>(Object.values(BUDGETS).map((b) => b.max));
    const orphans = declared.filter((n) => !inCode.has(n));
    expect(
      orphans,
      "رقم مُعلَن في §١٤ لا تفرضه بوابة — إعلانٌ بلا حارس",
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
