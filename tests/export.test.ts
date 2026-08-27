import { describe, expect, it } from "vitest";
import {
  EXTENSION,
  safeFileName,
  toMarkdown,
  toPlainText,
  type ExportDocument,
} from "../src/lib/export";
import type { Block } from "../src/editor/blocks";

/**
 * تصدير المستند — `Luma.md` §٢٠ مسألة ٢٠، [ADR ٠٠٢٠](../docs/decisions/0020-export.md).
 *
 * الدوالّ خالصة، فتُختبر هنا بلا جسر ولا نافذة عرض. وما لا يُختبر هنا
 * (لوحة الحفظ، والكتابة على القرص) في Rust — لأنه هناك.
 */

const b = (
  role: Block["role"],
  text: string,
  marks: Block["marks"] = [],
): Block => ({ id: `b-${text.slice(0, 6)}`, role, text, marks });

const doc = (blocks: Block[], title?: string): ExportDocument => ({
  title: title ?? blocks.find((x) => x.text.trim() !== "")?.text.trim() ?? "بدون عنوان",
  blocks,
});

describe("Markdown", () => {
  it("يترجم الأدوار الخمسة إلى بادئاتها", () => {
    const d = doc([
      b("h1", "العنوان"),
      b("body", "فقرة."),
      b("h2", "عنوان ثانٍ"),
      b("h3", "عنوان ثالث"),
      b("quote", "اقتباس."),
    ]);
    expect(toMarkdown(d)).toBe(
      "# العنوان\n\nفقرة.\n\n## عنوان ثانٍ\n\n### عنوان ثالث\n\n> اقتباس.\n",
    );
  });

  it("لا يكرّر العنوان المشتقّ من أول كتلة", () => {
    // العنوان في المنتج **دائمًا** مشتقّ: لا إعادة تسمية في المكتبة (§٦)
    const d = doc([b("body", "في الهدوء"), b("body", "نصٌّ بعده.")]);
    const out = toMarkdown(d);
    expect(out).toBe("# في الهدوء\n\nنصٌّ بعده.\n");
    // الدعوى صراحةً: مرّة واحدة لا مرّتين
    expect(out.match(/في الهدوء/g)).toHaveLength(1);
  });

  it("لا يكرّر عنوانًا طويلًا قُصّ بـ«…» — عُرف displayTitle", () => {
    const long = "ط".repeat(80);
    const d = doc([b("body", long), b("body", "بعده.")], `${"ط".repeat(60)}…`);
    const out = toMarkdown(d);
    expect(out).toBe(`# ${"ط".repeat(60)}…\n\nبعده.\n`);
  });

  it("يُبقي أول كتلة حين يكون العنوان صريحًا مختلفًا عنها", () => {
    const d = doc([b("body", "أول سطر."), b("body", "ثانٍ.")], "عنوانٌ آخر");
    expect(toMarkdown(d)).toBe("# عنوانٌ آخر\n\nأول سطر.\n\nثانٍ.\n");
  });

  it("يلفّ الوزن بنجمتين — والإزاحات تُقرأ من آخرها فلا تفسد", () => {
    const d = doc(
      [b("body", "كلمة غامقة وأخرى غامقة هنا", [
        { type: "strong", from: 0, to: 4 },
        { type: "strong", from: 17, to: 22 },
      ])],
      "س",
    );
    // لو طُبِّقت من أولها لأزاح الإدراجُ الأولُ حدودَ الثانية
    expect(toMarkdown(d)).toContain("**كلمة** غامقة وأخرى **غامقة** هنا");
  });

  it("يتجاهل علامة مقلوبة أو خارج المدى بدل أن يشوّه النص", () => {
    const d = doc(
      [b("body", "نصّ قصير", [
        { type: "strong", from: 5, to: 2 },
        { type: "strong", from: 0, to: 999 },
      ])],
      "س",
    );
    expect(toMarkdown(d)).toContain("نصّ قصير");
    expect(toMarkdown(d)).not.toContain("**");
  });

  it("يُسقط الكتل الفارغة فلا تصير أسطرًا فارغة متتالية", () => {
    const d = doc([b("body", "أول"), b("body", "   "), b("body", "ثانٍ")], "س");
    expect(toMarkdown(d)).toBe("# س\n\nأول\n\nثانٍ\n");
  });

  it("ينتهي بسطر جديد واحد — عُرف ملفات النصّ", () => {
    expect(toMarkdown(doc([b("body", "نصّ")], "س")).endsWith("\n")).toBe(true);
    expect(toMarkdown(doc([b("body", "نصّ")], "س")).endsWith("\n\n")).toBe(false);
  });
});

describe("نصّ عادٍ", () => {
  it("بلا أي علامة — لا بادئة دور ولا نجمتَي وزن", () => {
    const d = doc([
      b("h1", "العنوان"),
      b("quote", "اقتباس."),
      b("body", "غامق", [{ type: "strong", from: 0, to: 4 }]),
    ]);
    const out = toPlainText(d);
    expect(out).not.toContain("#");
    expect(out).not.toContain(">");
    expect(out).not.toContain("**");
    expect(out).toContain("اقتباس.");
    expect(out).toContain("غامق");
  });

  it("العنوان يدخل الملف ولا يتكرّر — القاعدة نفسها", () => {
    const d = doc([b("body", "في الهدوء"), b("body", "بعده.")]);
    expect(toPlainText(d)).toBe("في الهدوء\n\nبعده.\n");
  });
});

describe("اسم الملف", () => {
  it("يُبقي العربية والمسافات كما هي", () => {
    expect(safeFileName("في الهدوء تكتب")).toBe("في الهدوء تكتب");
  });

  it("يزيل ما يكسر المسار وحده", () => {
    expect(safeFileName("أ/ب:ج")).toBe("أ ب ج");
  });

  it("لا يبدأ بنقطة — الملف يصير مخفيًّا في Finder", () => {
    expect(safeFileName("...مخفي").startsWith(".")).toBe(false);
  });

  it("يُعطي بديلًا حين لا يبقى شيء", () => {
    expect(safeFileName("   ")).toBe("بدون عنوان");
    expect(safeFileName("///")).toBe("بدون عنوان");
  });

  it("يقصّ الطويل — أسماء الملفات لها حدّ على كل نظام", () => {
    expect(safeFileName("ط".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe("الامتدادات", () => {
  it("لكل صيغة امتدادها", () => {
    expect(EXTENSION.markdown).toBe("md");
    expect(EXTENSION.text).toBe("txt");
    expect(EXTENSION.pdf).toBe("pdf");
  });
});
