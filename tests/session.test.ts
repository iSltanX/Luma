/**
 * `EditorSession` — الحدود التي تحمي نصّ المستخدم.
 *
 * ما يُختبر هنا ليس السعادة بل **اللحظات التي يُستبدل فيها المحتوى**:
 * فتح مستند آخر، وبدء نصّ جديد، وما كُتب قبل أن تجهز الجلسة. كلها
 * تكتب فوق ما في المحرر أو تتبنّاه، فكلها تحتاج شرطًا قبل أن تفعل.
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
    remove: (id: string) => Promise<void>;
  }>,
) {
  return new EditorSession({
    editor: editorLike.editor as never,
    bridge: {
      save: bridge.save ?? (async () => {}),
      load: bridge.load ?? (async () => ({ id: "d1", title: null, blocks: [], createdAt: 1 })),
      remove: bridge.remove ?? (async () => {}),
    } as never,
    onSaveState: () => {},
  });
}

describe("ما كُتب قبل وجود الجلسة لا يضيع", () => {
  /**
   * المحرر يُركَّب ويأخذ المؤشر قبل أن تُنشأ الجلسة. وما يُكتب في تلك
   * النافذة كان لا يبلغها أبدًا — `session?.handleChange` على `null` —
   * فلا يعرفه الحفظ التلقائي، و`flush()` يقول **صادقًا** إن كل شيء
   * وصل القرص لأن بُفره فارغ. ثم يُستبدل المحتوى عند فتح مستند آخر
   * فيختفي بلا أثر.
   */
  it("نصٌّ موجود في المحرر لحظة الإنشاء يصير معروفًا للحفظ", async () => {
    const e = fakeEditor([block("فقرة لُصقت قبل أن تجهز الجلسة")]);
    const saved: unknown[] = [];
    const s = session(e, { save: async (p) => void saved.push(p) });

    // المستند يُنشأ من المحتوى القائم لا من ضغطة تالية
    expect(s.currentId).not.toBeNull();
    expect(s.contents[0]!.text).toBe("فقرة لُصقت قبل أن تجهز الجلسة");

    expect(await s.flush()).toEqual({ settled: true });
    expect(saved).toHaveLength(1);
  });

  it("المحرر الفارغ لا يُنشئ مستندًا — لا ضجيج في المكتبة", () => {
    const s = session(fakeEditor([block("   ")]), {});
    expect(s.currentId).toBeNull();
  });

  /**
   * «كل تشغيل يفتح مساحة كتابة نظيفة» — `Luma.md` §٤ **ثابت**
   * (ADR ٠٠١٧).
   *
   * الضمانة بنيوية لا سلوكية: لا سبيل إلى تحميل مستند إلا بمعرّف
   * يُمرَّر صراحةً (`open`)، فلا يبقى في الجلسة بابٌ تدخل منه قراءةٌ
   * تلقائية. الحارس يرصد عودتها بأي اسم كان.
   */
  it("التشغيل نظيف: لا تحميل تلقائي ولا باب إليه", () => {
    const load = vi.fn();
    const s = session(fakeEditor(), { load: load as never });

    expect(load).not.toHaveBeenCalled();
    expect(s.currentId).toBeNull();
    // لا `resume` ولا نظير لها: التحميل يحتاج معرّفًا صريحًا
    expect((s as unknown as Record<string, unknown>).resume).toBeUndefined();
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

/**
 * «المستند الفارغ لا يبقى بعد مغادرته» — `Luma.md` §٤ **ثابت**
 * (ADR ٠٠١٧).
 *
 * والخطر المحسوم سلفًا هو **السباق**: البُفر يسبق القرص دائمًا، فقراءة
 * الفراغ قبل أن يستقرّ الحفظ تمحو ما لم يكن فارغًا. الحارس هنا يرصد
 * الترتيب نفسه لا نتيجته وحدها.
 */
describe("المستند الفارغ يُحذف عند مغادرته", () => {
  /** يسجّل تسلسل نداءات الجسر — الترتيب هو موضوع الاختبار. */
  function tracked(overrides: { saveFails?: boolean; loadFails?: boolean } = {}) {
    const calls: string[] = [];
    return {
      calls,
      bridge: {
        save: async () => {
          if (overrides.saveFails) {
            calls.push("save:fail");
            throw new Error("القرص ممتلئ");
          }
          calls.push("save");
        },
        load: async (id: string) => {
          if (overrides.loadFails) {
            calls.push("load:fail");
            throw new Error("تالف");
          }
          calls.push("load");
          return { id, title: null, blocks: [block("مستند آخر")], createdAt: 1 };
        },
        remove: async (id: string) => {
          calls.push(`remove:${id}`);
        },
      },
    };
  }

  /** يُنشئ مستندًا حقيقيًا ثم يُفرغه — «كُتب ثم أُفرغ». */
  function emptied(e: ReturnType<typeof fakeEditor>, s: EditorSession) {
    s.handleChange([block("نصٌّ سيُمحى")]);
    const id = s.currentId!;
    e.editor.setBlocks([block("")]);
    s.handleChange([block("")]);
    return id;
  }

  /**
   * ⚠️ **المغادرات لا تناديه بعد.** الوصل معلَّق على ثوابت تصطدم
   * بالقرار ولم تُحسم — [ADR ٠٠١٧](../docs/decisions/0017-clean-start-and-deletion.md).
   * هذا الحارس يوثّق التعليق: من يصل المغادرة بالكنس يُسقطه، فيقرأ
   * سببَ التعليق قبل أن يصل — لا بعد أن يمحو مستند أحدهم.
   */
  it("⚠️ معلَّق: المغادرة لا تكنس الفارغ حتى تُحسم ثوابت ADR ٠٠١٧", async () => {
    const e = fakeEditor();
    const { calls, bridge } = tracked();
    const s = session(e, bridge);
    emptied(e, s);
    await s.startNew();

    const e2 = fakeEditor();
    const t2 = tracked();
    const s2 = session(e2, t2.bridge);
    emptied(e2, s2);
    await s2.open("أخرى");

    expect(calls.some((c) => c.startsWith("remove:"))).toBe(false);
    expect(t2.calls.some((c) => c.startsWith("remove:"))).toBe(false);
  });

  it("كُتب ثم أُفرغ: الكنس يمحوه بمعرّفه", async () => {
    const e = fakeEditor();
    const { calls, bridge } = tracked();
    const s = session(e, bridge);
    const id = emptied(e, s);

    await s.flush();
    expect(await s.discardIfEmpty()).toBe(true);

    expect(calls).toContain(`remove:${id}`);
    expect(s.currentId).toBeNull();
  });

  it("مستند فيه نصّ لا يُمحى", async () => {
    const e = fakeEditor();
    const { calls, bridge } = tracked();
    const s = session(e, bridge);
    s.handleChange([block("نصٌّ باقٍ")]);

    await s.flush();
    expect(await s.discardIfEmpty()).toBe(false);
    expect(calls.some((c) => c.startsWith("remove:"))).toBe(false);
  });

  /**
   * عقد `flush` مخروق: يعيد `true` وفي `pending` تغييرٌ وصل أثناء
   * الكتابة السابقة. فلا يُتّكأ على وعده وحده — والفحص يفشل **آمنًا**.
   */
  it("كتابةٌ معلَّقة تمنع المحو — الفشل آمن لا مدمّر", async () => {
    const e = fakeEditor();
    const { calls, bridge } = tracked();
    const s = session(e, bridge);
    emptied(e, s);

    // بلا `flush`: في الطابور كتابةٌ لم تصل
    expect(await s.discardIfEmpty()).toBe(false);
    expect(calls.some((c) => c.startsWith("remove:"))).toBe(false);
  });

  /**
   * بين طلب المحو وعودته نافذةُ IPC كاملة، والمحرر فيها يقبل الكتابة.
   * لو بقي المعرّف حيًّا فيها، دُفع ما يُكتب تحته فبُعث المستند بعد
   * محوه — قِيس ذلك على WebKit الحقيقي، فصار المعرّف يُصفَّر قبلها.
   */
  it("لا يبقى المعرّف أثناء رحلة المحو — فلا بعث لمحذوف", async () => {
    const e = fakeEditor();
    let idDuringRemove: string | null = "لم يُقرأ";
    const s = session(e, {
      remove: async () => {
        // كتابةٌ تقع أثناء الرحلة: أي معرّف تراه؟
        idDuringRemove = s.currentId;
      },
    });
    emptied(e, s);
    await s.flush();

    await s.discardIfEmpty();

    expect(idDuringRemove).toBeNull();
  });

  /**
   * **الحارس الحاسم — والخطر أدقّ ممّا يبدو.**
   *
   * الفراغ يُقرأ من البُفر الحيّ، فقراره صحيح في كل لحظة. الذي يفسده
   * الترتيب هو **البعث**: كتابةٌ معلَّقة تهبط القرص **بعد** المحو
   * فتعيد المستند من العدم — صفٌّ فارغ في المكتبة لمستند حُذف، وملفٌّ
   * لا يعرف أحد أنه عاد. ولذلك يُفرَغ الطابور أولًا ثم يقع المحو، ولا
   * كتابة بعده.
   */
  it("الحذف لا يسبق استقرار الحفظ، ولا كتابة تهبط بعده", async () => {
    const e = fakeEditor();
    const { calls, bridge } = tracked();
    const s = session(e, bridge);
    const id = emptied(e, s);

    await s.flush();
    await s.discardIfEmpty();

    // الكتابة أولًا ثم المحو — لا العكس ولا بالتوازي
    const wrote = calls.indexOf("save");
    const erased = calls.indexOf(`remove:${id}`);
    expect(wrote).toBeGreaterThanOrEqual(0);
    expect(erased).toBeGreaterThan(wrote);
    // ولا شيء يُكتب بعد المحو — وإلا بُعث المستند المحذوف
    expect(calls.slice(erased + 1)).not.toContain("save");
  });

  it("نصٌّ لم يبلغ القرص بعد لا يُحذف بوصفه فارغًا", async () => {
    const e = fakeEditor();
    const { calls, bridge } = tracked();
    const s = session(e, bridge);
    s.handleChange([block("نصٌّ سيُمحى")]);
    e.editor.setBlocks([block("")]);
    s.handleChange([block("")]);
    // ثم عاد فكتب — والكتابة معلَّقة لم تُحفظ بعد
    e.editor.setBlocks([block("عاد فكتب")]);
    s.handleChange([block("عاد فكتب")]);

    await s.startNew();

    expect(calls.some((c) => c.startsWith("remove:"))).toBe(false);
  });

  it("فشل الحفظ يمنع الحذف من أصله", async () => {
    const e = fakeEditor();
    const { calls, bridge } = tracked({ saveFails: true });
    const s = session(e, bridge);
    emptied(e, s);

    await expect(s.startNew()).rejects.toThrow();
    expect(calls.some((c) => c.startsWith("remove:"))).toBe(false);
  });

  it("فشل فتح المسودة الأخرى لا يكلّف الحالي حذفًا", async () => {
    const e = fakeEditor();
    const { calls, bridge } = tracked({ loadFails: true });
    const s = session(e, bridge);
    const id = emptied(e, s);

    await expect(s.open("تالفة")).rejects.toThrow();
    // لا هذه فُتحت ولا ذاك مُحي — الكاتب حيث هو
    expect(calls.some((c) => c.startsWith("remove:"))).toBe(false);
    expect(s.currentId).toBe(id);
  });

  it("مساحة لم يُكتب فيها قط: لا معرّف فلا نداء حذف", async () => {
    const e = fakeEditor();
    const { calls, bridge } = tracked();
    const s = session(e, bridge);

    await s.startNew();

    expect(calls.some((c) => c.startsWith("remove:"))).toBe(false);
  });

  it("بعد الحذف لا يبقى المعرّف: كتابةٌ تالية تُنشئ مستندًا جديدًا", async () => {
    const e = fakeEditor();
    const { bridge } = tracked();
    const s = session(e, bridge);
    const id = emptied(e, s);

    await s.startNew();
    s.handleChange([block("نصّ بعده")]);

    expect(s.currentId).not.toBeNull();
    expect(s.currentId).not.toBe(id);
  });
});
