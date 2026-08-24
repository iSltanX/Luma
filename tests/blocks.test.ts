import { describe, it, expect } from "vitest";
import {
  createBlock,
  emptyDocument,
  isEmptyDocument,
  coerceBlocks,
  sameContent,
  wordCount,
  excerpt,
  BLOCK_ROLES,
} from "../src/editor/blocks";
import { blocksToDoc, docToBlocks } from "../src/editor/convert";
import { cleanPastedText, textToSlice } from "../src/editor/paste";
import { isolate, arabicDigits, duration, words } from "../src/lib/bidi";

describe("نموذج الكتل", () => {
  it("المستند الفارغ كتلة نصية واحدة، لا Empty State", () => {
    const doc = emptyDocument();
    expect(doc).toHaveLength(1);
    expect(doc[0]?.role).toBe("body");
    expect(isEmptyDocument(doc)).toBe(true);
  });

  it("الأدوار المعتمدة ثلاثة فقط", () => {
    expect([...BLOCK_ROLES]).toEqual(["body", "h1", "h2"]);
  });

  it("المعرّفات فريدة", () => {
    const ids = Array.from({ length: 200 }, () => createBlock().id);
    expect(new Set(ids).size).toBe(200);
  });

  it("عدّ الكلمات يتجاهل الفراغ", () => {
    expect(wordCount([createBlock("body", "  الكتابة   فعل هادئ  ")])).toBe(3);
    expect(wordCount([createBlock("body", "   ")])).toBe(0);
  });

  it("المقتطف لا يقطع في منتصف كلمة ولا يحمل محارف اتجاه", () => {
    const long = createBlock("body", "الكتابة فعل هادئ ".repeat(20));
    const e = excerpt([long], 40);
    expect(e.length).toBeLessThanOrEqual(41);
    expect(e).not.toMatch(/[‎‏⁦-⁩]/);
  });
});

describe("قراءة بنية غير موثوقة", () => {
  it("تعيد مستندًا فارغًا لا ترمي عند مدخل تالف", () => {
    for (const bad of [null, undefined, 42, "نص", {}, []]) {
      expect(coerceBlocks(bad)).toHaveLength(1);
    }
  });

  it("تُصلح الدور المجهول إلى body ولا تُسقط النص", () => {
    const out = coerceBlocks([{ id: "a", role: "h9", text: "نص" }]);
    expect(out[0]?.role).toBe("body");
    expect(out[0]?.text).toBe("نص");
  });

  it("تفكّ تكرار المعرّفات — التكرار يفسد المطابقة عند الحفظ", () => {
    const out = coerceBlocks([
      { id: "same", role: "body", text: "أ" },
      { id: "same", role: "body", text: "ب" },
    ]);
    expect(out[0]?.id).not.toBe(out[1]?.id);
    expect(out.map((b) => b.text)).toEqual(["أ", "ب"]);
  });

  it("تُسقط marks — لا تنسيق غني حتى يُعتمد", () => {
    const out = coerceBlocks([
      { id: "a", role: "body", text: "نص", marks: [{ type: "bold" }] },
    ]);
    expect(out[0]?.marks).toEqual([]);
  });
});

describe("التحويل ذهابًا وإيابًا", () => {
  const doc = [
    createBlock("h1", "في الهدوء"),
    createBlock("body", "الكتابة فعل هادئ لا يحتمل الضجيج"),
    createBlock("h2", "الفصل الأول"),
    createBlock("body", "كتبتُ hello ثم عدتُ إلى العربية"),
    createBlock("body", ""),
  ];

  it("لا يفقد نصًّا ولا يعيد ترتيبًا", () => {
    const round = docToBlocks(blocksToDoc(doc));
    expect(sameContent(round, doc)).toBe(true);
    expect(round.map((b) => b.role)).toEqual(doc.map((b) => b.role));
  });

  it("يحافظ على معرّفات الكتل", () => {
    expect(docToBlocks(blocksToDoc(doc)).map((b) => b.id)).toEqual(
      doc.map((b) => b.id),
    );
  });

  it("يصمد أمام النص المختلط والتشكيل", () => {
    const tricky = [
      createBlock("body", "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ"),
      createBlock("body", "الإصدار ٢٫٣ مقابل 2.3"),
      createBlock("body", "«اقتباس عربي»"),
    ];
    expect(sameContent(docToBlocks(blocksToDoc(tricky)), tricky)).toBe(true);
  });

  it("المستند الفارغ يبقى كتلة واحدة", () => {
    expect(docToBlocks(blocksToDoc([]))).toHaveLength(1);
  });
});

describe("تنظيف اللصق", () => {
  it("ينزع محارف تحكم الاتجاه من نص المستخدم", () => {
    // تراكمها يجعل المؤشر والتحديد يقفزان بلا سبب ظاهر
    expect(cleanPastedText("عربي‏‎⁦لاتيني⁩")).toBe(
      "عربيلاتيني",
    );
  });

  it("ينزع المسافات صفرية العرض", () => {
    expect(cleanPastedText("نص​آخر﻿")).toBe("نصآخر");
  });

  it("يحوّل المسافة غير الفاصلة إلى مسافة عادية", () => {
    expect(cleanPastedText("كلمة أخرى")).toBe("كلمة أخرى");
  });

  it("يوحّد نهايات الأسطر", () => {
    expect(cleanPastedText("سطر\r\nآخر")).toBe("سطر\nآخر");
  });

  it("الفقرة الواحدة تُلصق داخل السطر ولا تشقّه", () => {
    expect(textToSlice("جملة واحدة").openStart).toBe(0);
  });

  it("الأسطر الفارغة تفصل فقرات، ولا تنشأ فقرة فارغة", () => {
    const slice = textToSlice("الأولى\n\n\n الثانية \n\n");
    expect(slice.content.childCount).toBe(2);
    expect(slice.content.child(0).textContent).toBe("الأولى");
    expect(slice.content.child(1).textContent).toBe("الثانية");
  });
});

describe("سلاسل الواجهة تحت الاتجاه الثنائي", () => {
  it("العزل يحيط المقطع اللاتيني بمحدِّدَي الاتجاه", () => {
    expect(isolate("Luma")).toBe("⁦Luma⁩");
  });

  it("الأرقام العربية الهندية في نصوص الواجهة", () => {
    expect(arabicDigits(2026)).toBe("٢٠٢٦");
    expect(arabicDigits(0)).toBe("٠");
  });

  it("المدة تُصاغ نصًّا لا برموز محايدة", () => {
    expect(duration(12)).toBe("١٢ ثانية");
    expect(duration(120)).toBe("٢ دقيقة");
  });

  it("عدّ الكلمات بلا «·» ملاصقة لرقم عربي هندي", () => {
    // «·» شكلها شكل «٠»: «١٦ · كلمة» تُقرأ «١٦٠ كلمة»
    for (const n of [0, 1, 2, 5, 16, 1200]) {
      expect(words(n)).not.toMatch(/[٠-٩]\s*·|·\s*[٠-٩]/);
    }
    expect(words(1)).toBe("كلمة واحدة");
    expect(words(2)).toBe("كلمتان");
  });
});
