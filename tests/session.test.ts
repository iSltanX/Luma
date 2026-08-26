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
  setEditable(enabled: boolean): void;
  focus(): void;
  readonly wordCount: number;
}

function fakeEditor(initial: Block[] = []) {
  let blocks = [...initial];
  let editable = true;
  const editor: EditorLike = {
    getBlocks: () => blocks,
    setBlocks: (b: Block[]) => {
      blocks = [...b];
    },
    setEditable: (enabled: boolean) => {
      editable = enabled;
    },
    focus: () => {},
    get wordCount() {
      return blocks.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);
    },
  };
  return { blocks: () => blocks, editable: () => editable, editor };
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
   * **المغادرات تكنس منذ بناء السلّة** — ADR ٠٠١٩. كانت هذه الحالة
   * موثَّقةً معلَّقةً (ADR ٠٠١٧) لأن المحو كان نهائيًا بلا تدارك؛
   * والسلّة تجعله قابلًا للاسترجاع، فالوصل هنا هو الأثر المباشر لبناء
   * السلّة لا تفصيلًا منفصلًا عنه — القرار نفسه المسجَّل في §٢٠ مسألة ١٩.
   */
  it("المغادرة (نصّ جديد أو فتح غيره) تكنس الفارغ من تلقاء نفسها", async () => {
    const e = fakeEditor();
    const { calls, bridge } = tracked();
    const s = session(e, bridge);
    const id = emptied(e, s);
    await s.startNew();

    expect(calls).toContain(`remove:${id}`);

    const e2 = fakeEditor();
    const t2 = tracked();
    const s2 = session(e2, t2.bridge);
    const id2 = emptied(e2, s2);
    await s2.open("أخرى");

    expect(t2.calls).toContain(`remove:${id2}`);
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

/**
 * ADR ٠٠١٨ الجذر ٤ — بين `flush()` وإتمام المغادرة نافذةٌ كان المحرر
 * فيها حيًّا يقبل الكتابة، وحرفٌ يقع فيها يُمحى من الشاشة صامتًا
 * ويهبط في مستندٍ لم يعد مفتوحًا. الإدخال يُغلق طوال المغادرة.
 */
describe("الإدخال يُغلق طوال رحلة المغادرة", () => {
  it("open(): مغلق من بداية الرحلة حتى اكتمالها، ويعود مفتوحًا بعدها", async () => {
    const e = fakeEditor([block("نصّ حيّ")]);
    let sawDuringLoad: boolean | null = null;
    const s = session(e, {
      load: async () => {
        sawDuringLoad = e.editable();
        return { id: "آخر", title: null, blocks: [block("مستند آخر")], createdAt: 1 };
      },
    });

    expect(e.editable()).toBe(true);
    await s.open("آخر");

    expect(sawDuringLoad).toBe(false);
    expect(e.editable()).toBe(true);
  });

  it("startNew(): مغلق أثناء الحفظ، ويعود مفتوحًا بعد اكتمال البدء", async () => {
    const e = fakeEditor([block("نصّ حيّ")]);
    let sawDuringSave: boolean | null = null;
    const s = session(e, {
      save: async () => {
        sawDuringSave = e.editable();
      },
    });

    await s.startNew();

    expect(sawDuringSave).toBe(false);
    expect(e.editable()).toBe(true);
  });

  it("فشل المغادرة لا يُبقي الإدخال مغلقًا", async () => {
    const e = fakeEditor([block("نصّ حيّ")]);
    const s = session(e, {
      save: async () => {
        throw new Error("القرص ممتلئ");
      },
    });

    await expect(s.startNew()).rejects.toThrow();
    expect(e.editable()).toBe(true);
  });
});

/**
 * ADR ٠٠١٨ الجذر ٥ — الكتابة المؤجَّلة كانت تقرأ `explicitTitle` و
 * `createdAt` **وقت التنفيذ** لا وقت الدفع. فحرفٌ يتيم يُدفع تحت
 * معرّف مستندٍ يُغادَر، ثم تُنفَّذ كتابتُه بعد أن فُتح مستندٌ آخر —
 * فيحمل عنوان الجديد وتاريخ إنشائه: إعادة تسمية صامتة لمستند لم
 * يمسّه أحد. الدفاع: كل دفعة تحمل هويّة صاحبها منذ لحظتها.
 */
describe("الكتابة المؤجَّلة تحمل هويّة صاحبها لا هويّة مَن بعده", () => {
  it("حرفٌ وقع أثناء فتح مسودة أخرى يُكتب بعنوان المغادَر لا عنوان الجديد", async () => {
    const writes: Array<{ id: string; title: string | null; createdAt: number | null }> = [];
    let releaseLoad: (() => void) | undefined;
    let loadStarted: (() => void) | undefined;
    const loadStartedPromise = new Promise<void>((r) => (loadStarted = r));
    const e = fakeEditor([block("نصّ المستند الأول")]);
    const s = session(e, {
      save: async (p: unknown) => {
        const w = p as { id: string; title: string | null; createdAt: number | null };
        writes.push({ id: w.id, title: w.title, createdAt: w.createdAt });
      },
      load: async () => {
        // إشارةٌ صريحة لدخول الرحلة — لا تخمينَ لعدد الدورات المجهرية
        loadStarted?.();
        await new Promise<void>((r) => (releaseLoad = r));
        return { id: "ب", title: "عنوان ب", blocks: [block("متن ب")], createdAt: 999 };
      },
    });

    s.setTitle("عنوان أ");
    const oldId = s.currentId!;
    await s.flush(); // يستقرّ المستند الأول قبل بدء الفتح
    // ما استقرّ للتوّ ليس موضوع الاختبار — الحرف اليتيم وحده الآن
    writes.length = 0;

    const opening = s.open("ب");
    await loadStartedPromise; // ننتظر دخول الرحلة فعلًا

    // حرفٌ يقع أثناء الرحلة — قبل أن تتغيّر هويّة الجلسة إلى «ب»
    s.handleChange([block("نصّ المستند الأول وحرفٌ إضافي")]);

    releaseLoad?.(); // تكتمل الرحلة: الهويّة تصير «ب» الآن
    await opening;

    // الحرف اليتيم يُستنزف الآن — بعد أن صار العنوان الحيّ «عنوان ب»
    await s.flush();

    expect(writes).toHaveLength(1); // كتابةٌ واحدة فقط: الحرف اليتيم
    const orphan = writes[0]!;
    expect(orphan.id).toBe(oldId); // على معرّف المغادَر — لا «ب»
    expect(orphan.title).toBe("عنوان أ"); // لا «عنوان ب»
    expect(orphan.createdAt).not.toBe(999);
  });

  /**
   * الاكتشاف الثاني — الهويّة الصحيحة لا تعني الوصول. `Autosave.pending`
   * خانة واحدة غير مفهرَسة، وأول حرف شرعي في المستند الجديد يستبدلها
   * فورًا. **لا استدعاء يدويّ لـ`flush()` هنا عمدًا** — هذا بالضبط ما
   * يُختبر: هل يصل اليتيم من تلقاء نفسه قبل أن يُتاح للكاتب الكتابة
   * من جديد؟ الحارس السابق كان يستدعي `flush()` يدويًّا بعد المغادرة،
   * فيُخفي هذا السؤال بدل أن يجيب عنه.
   */
  it("الحرف اليتيم يصل القرص من تلقاء نفسه — قبل أن يستبدله أول حرفٍ شرعي", async () => {
    const writes: Array<{ id: string; blocks: unknown }> = [];
    let releaseLoad: (() => void) | undefined;
    let loadStarted: (() => void) | undefined;
    const loadStartedPromise = new Promise<void>((r) => (loadStarted = r));
    const e = fakeEditor([block("نصّ المستند الأول")]);
    const s = session(e, {
      save: async (p: unknown) => {
        const w = p as { id: string; blocks: unknown };
        writes.push({ id: w.id, blocks: w.blocks });
      },
      load: async () => {
        loadStarted?.();
        await new Promise<void>((r) => (releaseLoad = r));
        return { id: "ب", title: null, blocks: [block("متن ب")], createdAt: 999 };
      },
    });

    const oldId = s.currentId!;
    await s.flush();
    writes.length = 0;

    const opening = s.open("ب");
    await loadStartedPromise;

    // حرفٌ يتيم يقع أثناء الرحلة — قبل أن تتغيّر الهويّة إلى «ب»
    s.handleChange([block("نصّ المستند الأول وحرفٌ إضافي")]);

    releaseLoad?.();
    await opening; // الإدخال يُفتح الآن — يُفترض أن اليتيم وصل بالفعل

    // أول حرفٍ شرعي في المستند الجديد — فورًا، كما يفعل كاتبٌ حقيقي
    s.handleChange([block("أول حرفٍ في ب")]);
    await s.flush(); // يستنزف كتابة «ب» الشرعية وحدها

    // اليتيم كان يجب أن يصل **قبل** هذه الكتابة — لا أن تُهمله
    const orphan = writes.find((w) => w.id === oldId);
    expect(orphan).toBeDefined();
    expect(orphan!.blocks).toEqual([block("نصّ المستند الأول وحرفٌ إضافي")]);

    const legit = writes.find((w) => w.id === "ب");
    expect(legit).toBeDefined();
  });
});

/**
 * ADR ٠٠١٨ الجذر ٦ — لا حارس إعادة دخول على «نصّ جديد» و«فتح مسودة»:
 * نقرتان متتاليتان كانتا تتشابكان على الحالة نفسها. المغادرات تُنفَّذ
 * بالترتيب — لا تُسقَط ولا تتشابك.
 */
describe("لا تتشابك مغادرتان على جلسة واحدة", () => {
  it("فتح مسودة ثم نصّ جديد قبل اكتمال الأول: يُنفَّذان بالترتيب لا متشابكين", async () => {
    const e = fakeEditor([block("نصّ أ")]);
    let releaseLoad: (() => void) | undefined;
    let loadStarted: (() => void) | undefined;
    const loadStartedPromise = new Promise<void>((r) => (loadStarted = r));
    const order: string[] = [];
    const s = session(e, {
      load: async (id: string) => {
        order.push(`load-start:${id}`);
        loadStarted?.();
        await new Promise<void>((r) => (releaseLoad = r));
        order.push(`load-end:${id}`);
        return { id, title: null, blocks: [block(`متن ${id}`)], createdAt: 1 };
      },
    });

    const opening = s.open("ب"); // يبدأ ثم يعلَّق داخل `load`
    await loadStartedPromise; // ننتظر دخول الرحلة فعلًا — لا نخمّن عدد الدورات
    expect(order).toEqual(["load-start:ب"]);

    const startingNew = s.startNew(); // يُطلب أثناء انتظار الأول

    // «فتح ب» لم يكتمل بعد، فـ«نصّ جديد» ينتظر دوره ولا يبدأ منطقه —
    // نمنح فرصًا متعددة كي يظهر الخطأ لو كان الحارس غائبًا
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(order).toEqual(["load-start:ب"]);

    releaseLoad?.();
    await opening;
    await startingNew;

    // اكتمل «فتح ب» أولًا تمامًا، ثم بدأ «نصّ جديد» بعده — لا تشابك
    expect(order).toEqual(["load-start:ب", "load-end:ب"]);
    expect(s.currentId).toBeNull(); // آخر طلب فاز: مساحة نظيفة
    expect(e.blocks()).toEqual([]); // لا محتوى «ب» تسرّب إلى الشاشة
  });
});

/**
 * مراجعة خصومية لإصلاح الجذور ٤/٥/٦ كشفت أن `runTransition` نفسها —
 * الآلية التي حملت الإصلاح — تحمل عطلين: رمية غير متوقّعة من
 * `setEditable` تُجمّد الطابور إلى الأبد (لا شيء آخر يحلّ وعده)،
 * و`dispose()` لا تمنع مغادرةً جديدة من «النجاح» صامتًا بلا حفظ.
 */
describe("طابور المغادرات لا يتجمّد ولا ينجح صامتًا بعد الإغلاق", () => {
  it("رمية من setEditable لا تمنع الإفراج عن الطابور — والمغادرة التالية تُنفَّذ", async () => {
    let blocks: Block[] = [block("نصّ")];
    let throwOnEnable = true;
    const editor = {
      getBlocks: () => blocks,
      setBlocks: (b: Block[]) => {
        blocks = [...b];
      },
      setEditable: (enabled: boolean) => {
        if (enabled && throwOnEnable) {
          throwOnEnable = false;
          throw new Error("عطل داخلي غير متوقّع من ProseMirror");
        }
      },
      focus: () => {},
      get wordCount() {
        return 0;
      },
    };
    const s = new EditorSession({
      editor: editor as never,
      bridge: {
        save: async () => {},
        load: async () => ({ id: "x", title: null, blocks: [], createdAt: 1 }),
        remove: async () => {},
      } as never,
      onSaveState: () => {},
    });

    // المغادرة الأولى تفشل عند إعادة التمكين — لكن الطابور لا يتجمّد
    await expect(s.startNew()).rejects.toThrow("عطل داخلي غير متوقّع");

    // ومغادرةٌ ثانية يجب أن تُنفَّذ فعلًا لا أن تعلق إلى الأبد
    await expect(s.startNew()).resolves.toBeUndefined();
  });

  it("بعد dispose(): مغادرة جديدة تفشل بصراحة لا بنجاح كاذب", async () => {
    const e = fakeEditor([block("نصّ")]);
    const save = vi.fn().mockResolvedValue(undefined);
    const s = session(e, { save });
    await s.flush(); // لا شيء معلَّق الآن — فلا يفشل flush() لعلّة أخرى
    s.dispose();

    await expect(s.startNew()).rejects.toThrow();
    // ولم يُستبدل شيء: البُفر كما كان قبل محاولة المغادرة
    expect(e.blocks()[0]!.text).toBe("نصّ");
  });
});

/**
 * ADR ٠٠١٨ — اكتشاف بعد إصلاح الجذور ٤/٥/٦: `preview()`/`restore()`
 * في `App.svelte` كانتا آليةَ قفلٍ منفصلة عن `runTransition`، لا تعرف
 * كل منهما بالأخرى. `runExclusive` تُشغّل عملًا خارجيًا ضمن الطابور
 * نفسه — والحارس هنا يثبّت ذلك من طرف الجلسة، حيث تعيش الضمانة فعلًا.
 */
describe("runExclusive تشارك الطابور مع open()/startNew() — لا تتشابك معاينة مع مغادرة", () => {
  it("مغادرة أثناء عمل خارجيّ معلَّق: تنتظر دورها ولا تتشابك", async () => {
    const e = fakeEditor([block("نصّ أ")]);
    let releaseExternal: (() => void) | undefined;
    let externalStarted: (() => void) | undefined;
    const externalStartedPromise = new Promise<void>((r) => (externalStarted = r));
    const order: string[] = [];
    // `load` نفسها تُسجَّل في `order` — فالإثبات أن `open()` لم يبدأ
    // منطقه إطلاقًا لا أنه «لم يكتمل بعد عدد كذا من الدورات»، وهو فرقٌ
    // جوهري: سلسلة `flush()` الداخلية (طابور `Autosave` الخاص بها)
    // تحتاج دوراتٍ مجهرية عدّة بذاتها، فعدُّها يخلط سبب الانتظار.
    const s = session(e, {
      load: async (id: string) => {
        order.push(`load-start:${id}`);
        return { id, title: null, blocks: [], createdAt: 1 };
      },
    });

    const external = s.runExclusive(async () => {
      order.push("external-start");
      externalStarted?.();
      await new Promise<void>((r) => (releaseExternal = r));
      order.push("external-end");
      return "نتيجة العمل الخارجي";
    });
    await externalStartedPromise;
    expect(order).toEqual(["external-start"]);

    const opening = s.open("ب"); // يُطلب أثناء انتظار العمل الخارجي

    // فرصٌ مجهرية وافرة — أكثر بكثير ممّا تحتاجه سلسلة `flush()`
    // الداخلية وحدها — كي لا يُخطئ الحارس فيظنّ التأخّر الطبيعي حظرًا
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
    // لم تُستدعَ `load` إطلاقًا: `open()` لم يبدأ منطقه، ينتظر دوره
    expect(order).toEqual(["external-start"]);
    expect(s.currentId).not.toBe("ب");

    releaseExternal?.();
    await expect(external).resolves.toBe("نتيجة العمل الخارجي");
    await opening;

    // اكتمل العمل الخارجي أولًا تمامًا، ثم بدأ الفتح بعده — لا تشابك
    expect(order).toEqual(["external-start", "external-end", "load-start:ب"]);
    expect(s.currentId).toBe("ب");
  });

  it("عملٌ خارجيّ لا يمسّ editable — يبقى كما تركه صاحبه بعد اكتماله", async () => {
    const e = fakeEditor([block("نصّ")]);
    const s = session(e, {});

    await s.runExclusive(async () => {
      e.editor.setEditable(false); // كما تفعل `preview()` قبل الرحلة
    });

    // `runExclusive` لا تُعيد `editable` إلى `true` من تلقاء نفسها —
    // بخلاف `runTransition`: صاحب العمل (المعاينة) يقرر متى تعود
    expect(e.editable()).toBe(false);
  });

  it("عملٌ خارجيّ يفشل لا يُبقي الطابور معلَّقًا لما بعده", async () => {
    const e = fakeEditor([block("نصّ")]);
    const s = session(e, {});

    await expect(
      s.runExclusive(async () => {
        throw new Error("تعذّرت قراءة النسخة");
      }),
    ).rejects.toThrow("تعذّرت قراءة النسخة");

    // مغادرةٌ تالية تُنفَّذ فعلًا — الطابور لم يتجمّد على الفشل
    await expect(s.startNew()).resolves.toBeUndefined();
  });
});
