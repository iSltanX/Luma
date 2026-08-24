import { describe, it, expect } from "vitest";
import { buildDocument, emptyDocument, wordCount } from "../src/probe/corpus";

describe("نموذج الكتل", () => {
  it("المستند الفارغ كتلة نصية واحدة، لا Empty State", () => {
    const doc = emptyDocument();
    expect(doc).toHaveLength(1);
    expect(doc[0]?.role).toBe("body");
    expect(doc[0]?.text).toBe("");
  });

  it("لا يستخدم إلا الأدوار المعتمدة: body و h1 و h2", () => {
    const roles = new Set(buildDocument(3000).map((b) => b.role));
    expect([...roles].every((r) => ["body", "h1", "h2"].includes(r))).toBe(true);
  });

  it("marks فارغة دائمًا حتى تُعتمد مجموعة التنسيق", () => {
    expect(buildDocument(2000).every((b) => b.marks.length === 0)).toBe(true);
  });

  it("معرّفات الكتل فريدة", () => {
    const doc = buildDocument(5000);
    expect(new Set(doc.map((b) => b.id)).size).toBe(doc.length);
  });

  it("يبلغ عدد الكلمات المطلوب تقريبًا", () => {
    expect(wordCount(buildDocument(5000))).toBeGreaterThanOrEqual(5000);
  });
});

describe("قواعد الطباعة العربية", () => {
  it("لا يدرج امتداد ملف لاتيني داخل نص عربي", () => {
    // الامتدادات تُقذف إلى الطرف الخطأ تحت الاتجاه الثنائي — Luma.md §١٦
    const text = buildDocument(4000).map((b) => b.text).join(" ");
    expect(text).not.toMatch(/\.(md|json|txt|ttf|png)\b/);
  });

  it("لا يضع «·» ملاصقًا لرقم عربي هندي", () => {
    // «·» شبيهة بـ«٠»، فـ«١٦ · بكسل» تُقرأ «١٦٠ بكسل»
    const text = buildDocument(4000).map((b) => b.text).join(" ");
    expect(text).not.toMatch(/[٠-٩]\s*·|·\s*[٠-٩]/);
  });
});
