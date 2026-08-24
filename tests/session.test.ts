/**
 * `EditorSession` — الحدود التي تحمي نصّ المستخدم.
 *
 * ما يُختبر هنا ليس السعادة بل **اللحظات التي يُستبدل فيها المحتوى**:
 * الاستئناف، وفتح مستند آخر. وكلاهما يكتب فوق ما في المحرر، فكلاهما
 * يحتاج شرطًا قبل أن يفعل.
 */

import { describe, it, expect, vi } from "vitest";
import { EditorSession } from "../src/lib/session";
import type { Block } from "../src/editor";

const block = (text: string): Block => ({ id: "b0", role: "body", text, marks: [] });

/**
 * محرر زائف بما تلمسه الجلسة وحده.
 *
 * `EditorSession` لا تحتاج ProseMirror لتُختبر: تعاملها مع المحرر
 * ثلاث دوال. وهذا ما يجعل المنطق قابلًا للاختبار بلا متصفح — §٢.
 */
interface EditorLike {
  getBlocks(): Block[];
  setBlocks(b: Block[]): void;
  focus(): void;
  readonly wordCount: number;
}

function fakeEditor(initial: Block[] = []) {
  let blocks = [...initial];
  const editor: EditorLike = {
    getBlocks: () => blocks,
    setBlocks: (b: Block[]) => {
      blocks = [...b];
    },
    focus: () => {},
    get wordCount() {
      return blocks.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);
    },
  };
  return { blocks: () => blocks, editor };
}

function session(
  editorLike: ReturnType<typeof fakeEditor>,
  bridge: Partial<{
    save: (p: unknown) => Promise<void>;
    load: (id: string) => Promise<unknown>;
    mostRecent: () => Promise<string | null>;
  }>,
) {
  return new EditorSession({
    editor: editorLike.editor as never,
    bridge: {
      save: bridge.save ?? (async () => {}),
      load: bridge.load ?? (async () => ({ id: "d1", title: null, blocks: [], createdAt: 1 })),
      mostRecent: bridge.mostRecent ?? (async () => null),
    } as never,
    onSaveState: () => {},
  });
}

describe("الاستئناف لا يمحو ما كُتب قبله", () => {
  /**
   * المؤشر حيّ قبل أن تجهز الجلسة — عمدًا (§١٤).
   *
   * قِيست النافذة بين ظهور السطح ووصول المستند المستأنف: ٨٥ms على
   * جهاز سريع بمكتبة صغيرة، وتطول مع مكتبة كبيرة أو جهاز أبطأ. من كتب
   * فيها كان `setBlocks` يمحو نصّه صامتًا.
   */
  it("نصٌّ كُتب أثناء الإقلاع يبقى، ولا يُستبدل بالمستند المستأنف", async () => {
    const e = fakeEditor();
    const s = session(e, {
      mostRecent: async () => "سابق",
      load: async () => {
        // المستخدم يكتب **أثناء** قراءة المستند من القرص
        e.editor.setBlocks([block("ما كتبه المستخدم للتوّ")]);
        return { id: "سابق", title: null, blocks: [block("نصّ قديم")], createdAt: 1 };
      },
    });

    await s.resume();

    expect(e.blocks()[0]!.text).toBe("ما كتبه المستخدم للتوّ");
    // ولا تتبنّى الجلسة معرّف المستند القديم، فلا يُكتب فوقه
    expect(s.currentId).toBeNull();
  });

  it("المحرر الفارغ يُستأنف عادةً", async () => {
    const e = fakeEditor();
    const s = session(e, {
      mostRecent: async () => "سابق",
      load: async () => ({ id: "سابق", title: null, blocks: [block("نصّ قديم")], createdAt: 1 }),
    });
    await s.resume();
    expect(e.blocks()[0]!.text).toBe("نصّ قديم");
    expect(s.currentId).toBe("سابق");
  });

  it("فراغٌ فيه مسافات لا يُعدّ كتابةً", async () => {
    const e = fakeEditor([block("   ")]);
    const s = session(e, {
      mostRecent: async () => "سابق",
      load: async () => ({ id: "سابق", title: null, blocks: [block("نصّ قديم")], createdAt: 1 }),
    });
    await s.resume();
    expect(e.blocks()[0]!.text).toBe("نصّ قديم");
  });

  it("مكتبة فارغة: لا استئناف ولا خطأ", async () => {
    const e = fakeEditor();
    const s = session(e, { mostRecent: async () => null });
    await expect(s.resume()).resolves.toBeUndefined();
    expect(s.currentId).toBeNull();
  });

  it("مستند تالف لا يمنع الكتابة", async () => {
    const e = fakeEditor();
    const s = session(e, {
      mostRecent: async () => "تالف",
      load: async () => {
        throw new Error("Corrupt");
      },
    });
    await expect(s.resume()).resolves.toBeUndefined();
    expect(s.currentId).toBeNull();
  });
});

describe("بدء نصّ جديد", () => {
  it("يفرّغ المساحة ويترك المستند السابق كما هو", async () => {
    const e = fakeEditor([block("النص الأول")]);
    const save = vi.fn().mockResolvedValue(undefined);
    const s = session(e, { save });
    s.handleChange([block("النص الأول")]);
    expect(s.currentId).not.toBeNull();

    await s.startNew();

    expect(save).toHaveBeenCalled();
    expect(e.blocks()).toEqual([]);
    // مستندٌ جديد لا يُنشأ إلا عند أول محتوى — `Luma.md` §٤
    expect(s.currentId).toBeNull();
  });

  it("فشل حفظ الحالي يمنع البدء ويُبقي النص", async () => {
    const e = fakeEditor([block("نصّ حيّ")]);
    const s = session(e, {
      save: async () => {
        throw new Error("القرص ممتلئ");
      },
    });
    s.handleChange([block("نصّ حيّ")]);

    await expect(s.startNew()).rejects.toThrow();
    expect(e.blocks()[0]!.text).toBe("نصّ حيّ");
  });

  it("أول حرف بعد البدء يُنشئ مستندًا جديدًا لا يكتب فوق السابق", async () => {
    const e = fakeEditor([block("النص الأول")]);
    const s = session(e, {});
    s.handleChange([block("النص الأول")]);
    const first = s.currentId;

    await s.startNew();
    s.handleChange([block("النص الثاني")]);

    expect(s.currentId).not.toBeNull();
    expect(s.currentId).not.toBe(first);
  });
});

describe("فتح مستند آخر لا يستبدل نصًّا لم يصل القرص", () => {
  it("فشل الحفظ يمنع الفتح ويُبقي المحتوى", async () => {
    const e = fakeEditor([block("نصّ حيّ")]);
    const s = session(e, {
      save: async () => {
        throw new Error("القرص ممتلئ");
      },
      load: async () => ({ id: "آخر", title: null, blocks: [block("مستند آخر")], createdAt: 1 }),
    });
    // محتوى غير محفوظ في البُفر
    s.handleChange([block("نصّ حيّ")]);

    await expect(s.open("آخر")).rejects.toThrow();
    expect(e.blocks()[0]!.text).toBe("نصّ حيّ");
  });

  it("الحفظ الناجح يسمح بالفتح", async () => {
    const e = fakeEditor([block("نصّ حيّ")]);
    const save = vi.fn().mockResolvedValue(undefined);
    const s = session(e, {
      save,
      load: async () => ({ id: "آخر", title: null, blocks: [block("مستند آخر")], createdAt: 1 }),
    });
    s.handleChange([block("نصّ حيّ")]);

    await s.open("آخر");
    expect(save).toHaveBeenCalled();
    expect(e.blocks()[0]!.text).toBe("مستند آخر");
    expect(s.currentId).toBe("آخر");
  });
});
