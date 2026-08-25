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
  MARK_TYPES,
  type Block,
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

  /**
   * الأدوار مجموعة **مغلقة تُوسَّع بقرار**، لا مفتوحة.
   *
   * كانت ثلاثة، فاعتُمد معها عنوانٌ ثالث واقتباسُ كتلة (FEEL-PLAN M11)
   * — وكلاهما موسومٌ «مرشَّح» في التصميم. والاختبار يبقى ليمنع الزيادة
   * الصامتة: كل دور جديد يمرّ من هنا ومن الوثيقة معًا.
   */
  it("الأدوار المعتمدة خمسة", () => {
    expect([...BLOCK_ROLES]).toEqual(["body", "h1", "h2", "h3", "quote"]);
  });

  /** والعلامات واحدة: الوزن — §٥ يسمّيه بديل التمييز للعربية. */
  it("العلامات المعتمدة: الوزن وحده", () => {
    expect([...MARK_TYPES]).toEqual(["strong"]);
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

describe("اللصق يحفظ بنية الأسطر", () => {
  /**
   * نصٌّ كتبه صاحبه سطرًا سطرًا — جملة في سطر، أو بيت شعر، أو بند —
   * كان يصل Luma كتلةً واحدة متكدّسة: الفصل كان بسطرٍ فارغ وحده، وكلّ
   * سطر مفرد يُستبدل بمسافة. والسطر قرارُ تأليف لا التفاف نافذة.
   */
  it("كل سطر يصير كتلة", () => {
    const slice = textToSlice("السطر الأول.\nالسطر الثاني.\nالثالث.");
    expect(slice.content.childCount).toBe(3);
    expect(slice.content.child(0).textContent).toBe("السطر الأول.");
    expect(slice.content.child(2).textContent).toBe("الثالث.");
  });

  it("الأسطر الفارغة تُطوى ولا تصير كتلًا فارغة", () => {
    const slice = textToSlice("أول.\n\n\nثانٍ.\n \nثالث.");
    expect(slice.content.childCount).toBe(3);
  });

  it("سطر واحد يُلصق داخل السطر الحالي فلا يشقّه", () => {
    const slice = textToSlice("عبارة واحدة");
    expect(slice.openStart).toBe(0);
    expect(slice.content.child(0).isText).toBe(true);
  });
});

describe("الأدوار الموسَّعة والوزن", () => {
  it("الأدوار الخمسة تعبر إلى المستند وتعود كما هي", () => {
    const blocks: Block[] = [
      { id: "a", role: "body", text: "فقرة", marks: [] },
      { id: "b", role: "h1", text: "عنوان", marks: [] },
      { id: "c", role: "h2", text: "فرعي", marks: [] },
      { id: "d", role: "h3", text: "ثالث", marks: [] },
      { id: "e", role: "quote", text: "اقتباس", marks: [] },
    ];
    expect(docToBlocks(blocksToDoc(blocks))).toEqual(blocks);
  });

  /**
   * الوزن بديل التمييز للعربية — `Luma.md` §٥. وما لا يعبر الجولة
   * كاملةً يضيع عند أول حفظ، فالاختبار على الاتجاهين معًا.
   */
  it("الوزن يعبر الجولة بإزاحاته", () => {
    const blocks: Block[] = [
      {
        id: "a",
        role: "body",
        text: "نصٌّ فيه وزنٌ في وسطه",
        marks: [{ type: "strong", from: 8, to: 13 }],
      },
    ];
    const back = docToBlocks(blocksToDoc(blocks));
    expect(back[0]!.text).toBe("نصٌّ فيه وزنٌ في وسطه");
    expect(back[0]!.marks).toEqual([{ type: "strong", from: 8, to: 13 }]);
  });

  it("وزنان متلاصقان يعودان مدًى واحدًا", () => {
    const blocks: Block[] = [
      {
        id: "a",
        role: "body",
        text: "أبجد هوز",
        marks: [
          { type: "strong", from: 0, to: 4 },
          { type: "strong", from: 4, to: 8 },
        ],
      },
    ];
    expect(docToBlocks(blocksToDoc(blocks))[0]!.marks).toEqual([
      { type: "strong", from: 0, to: 8 },
    ]);
  });

  it("مدًى خارج حدود النص لا يكسر البناء", () => {
    const blocks: Block[] = [
      { id: "a", role: "body", text: "قصير", marks: [{ type: "strong", from: 2, to: 99 }] },
    ];
    const back = docToBlocks(blocksToDoc(blocks));
    expect(back[0]!.text).toBe("قصير");
    expect(back[0]!.marks).toEqual([{ type: "strong", from: 2, to: 4 }]);
  });

  it("كتلة بلا علامات تعود بلا علامات", () => {
    const blocks: Block[] = [{ id: "a", role: "body", text: "بلا وزن", marks: [] }];
    expect(docToBlocks(blocksToDoc(blocks))[0]!.marks).toEqual([]);
  });
});
