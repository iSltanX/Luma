/**
 * التفضيلات — `Luma.md` §١٥ و`IMPLEMENTATION.md` §٣.
 *
 * ما يُختبر هنا خالص: تصحيح القيم إلى مداها، وسلسلة الخطوط، وحساب
 * الآلة الكاتبة. أما التطبيق على الشجرة فيُختبر في Playwright.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULTS,
  LIMITS,
  coerce,
  fontStack,
  FALLBACK_FAMILY,
  applyToRoot,
  PreferencesStore,
  type Preferences,
} from "../src/lib/preferences.svelte";
import {
  BAND,
  SMOOTH_ABOVE_PX,
  comfortPadding,
  typewriterScroll,
} from "../src/lib/typewriter";
import { coverageBadge, coverageLabel, coverageNotice } from "../src/lib/fonts";

// ── الافتراضات ───────────────────────────────────────────────

describe("افتراضات التفضيلات", () => {
  it("الوضع الافتراضي يجمع الآلة الكاتبة والتركيز وZen مطفأ — §٧", () => {
    expect(DEFAULTS.typewriterEnabled).toBe(true);
    expect(DEFAULTS.focusEnabled).toBe(true);
    expect(DEFAULTS.zenEnabled).toBe(false);
  });

  it("عدّاد الكلمات مخفي افتراضيًا — §٥ **ثابت**", () => {
    expect(DEFAULTS.showWordCount).toBe(false);
  });

  it("خط الكتابة الافتراضي Almarai — §١١ **ثابت**", () => {
    expect(DEFAULTS.fontFamily).toBe("Almarai");
    expect(DEFAULTS.fontSource).toBe("bundled");
  });

  it("كل افتراض داخل مداه الموثَّق", () => {
    expect(DEFAULTS.fontSize).toBeGreaterThanOrEqual(LIMITS.fontSize.min);
    expect(DEFAULTS.fontSize).toBeLessThanOrEqual(LIMITS.fontSize.max);
    expect(DEFAULTS.lineHeight).toBeGreaterThanOrEqual(LIMITS.lineHeight.min);
    expect(DEFAULTS.lineHeight).toBeLessThanOrEqual(LIMITS.lineHeight.max);
    expect(DEFAULTS.columnWidth).toBeGreaterThanOrEqual(LIMITS.columnWidth.min);
    expect(DEFAULTS.columnWidth).toBeLessThanOrEqual(LIMITS.columnWidth.max);
  });
});

// ── التصحيح ──────────────────────────────────────────────────

describe("قراءة ملف تفضيلات غير موثوق", () => {
  it("الفارغ والتالف يعودان إلى الافتراضات", () => {
    expect(coerce(undefined)).toEqual(DEFAULTS);
    expect(coerce(null)).toEqual(DEFAULTS);
    expect(coerce({})).toEqual(DEFAULTS);
    expect(coerce("نص لا كائن")).toEqual(DEFAULTS);
  });

  it("القيم خارج المدى تُقصّ إلى حدّها لا تُرفض", () => {
    const p = coerce({ fontSize: 200, lineHeight: 0, columnWidth: 5000 });
    expect(p.fontSize).toBe(LIMITS.fontSize.max);
    expect(p.lineHeight).toBe(LIMITS.lineHeight.min);
    expect(p.columnWidth).toBe(LIMITS.columnWidth.max);
  });

  it("الأنواع الخطأ لا تمرّ", () => {
    const p = coerce({
      fontSize: "كبير",
      showWordCount: "نعم",
      themeId: "غير موجود",
      fontFamily: "   ",
      fontSource: "سحابة",
    });
    expect(p.fontSize).toBe(DEFAULTS.fontSize);
    expect(p.showWordCount).toBe(DEFAULTS.showWordCount);
    expect(p.themeId).toBe(DEFAULTS.themeId);
    expect(p.fontFamily).toBe(DEFAULTS.fontFamily);
    expect(p.fontSource).toBe(DEFAULTS.fontSource);
  });

  it("ما هو صالح يمرّ كما هو", () => {
    const p = coerce({
      themeId: "midnight",
      fontFamily: "Geeza Pro",
      fontSource: "system",
      fontSize: 22,
      lineHeight: 1.7,
      columnWidth: 640,
      showWordCount: true,
      zenEnabled: true,
    });
    expect(p.themeId).toBe("midnight");
    expect(p.fontFamily).toBe("Geeza Pro");
    expect(p.fontSize).toBe(22);
    expect(p.lineHeight).toBe(1.7);
    expect(p.columnWidth).toBe(640);
    expect(p.showWordCount).toBe(true);
    expect(p.zenEnabled).toBe(true);
  });
});

// ── سلسلة الرجوع الآمن ───────────────────────────────────────

describe("سلسلة الخطوط هي سلسلة الرجوع — §٨ **ثابت**", () => {
  it("الخط المختار أولًا وAlmarai بعده", () => {
    const stack = fontStack("Geeza Pro");
    expect(stack.indexOf("Geeza Pro")).toBeLessThan(stack.indexOf(FALLBACK_FAMILY));
  });

  it("Almarai لا يتكرّر حين يكون هو المختار", () => {
    expect(fontStack("Almarai").match(/Almarai/g)).toHaveLength(1);
  });

  it("خط بلا اسم يعود إلى المدمج وحده", () => {
    expect(fontStack("")).toContain(FALLBACK_FAMILY);
    expect(fontStack("   ")).toBe(fontStack(""));
  });

  it("السلسلة تنتهي دائمًا ببديل عام", () => {
    for (const f of ["Geeza Pro", "Almarai", "", "Menlo"]) {
      expect(fontStack(f)).toMatch(/sans-serif$/);
    }
  });
});

describe("عرض التغطية معلومة لا مرشِّح", () => {
  it("لكل تغطية نصّ يرافق لونها — §١٧ مبدأ ٩", () => {
    for (const c of ["full", "partial", "none"] as const) {
      expect(coverageLabel(c).length).toBeGreaterThan(0);
      expect(coverageBadge(c)).toBeTruthy();
    }
  });

  it("التغطية الكاملة بلا تحذير، والناقصة بتحذير يذكر البديل", () => {
    const font = (arabicCoverage: "full" | "partial" | "none") => ({
      id: "x",
      familyName: "x",
      source: "system" as const,
      arabicCoverage,
      localReference: null,
    });
    expect(coverageNotice(font("full"))).toBeNull();
    expect(coverageNotice(font("partial"))).toContain("Almarai");
    expect(coverageNotice(font("none"))).toContain("Almarai");
  });
});

// ── الآلة الكاتبة ────────────────────────────────────────────

const VIEW = { height: 800, top: 0 };

describe("حساب الآلة الكاتبة", () => {
  it("داخل النطاق لا يتحرّك شيء — هدوءٌ لا اهتزاز", () => {
    for (const ratio of [BAND.top + 0.01, BAND.anchor, BAND.bottom - 0.01]) {
      const top = VIEW.height * ratio - 18;
      expect(typewriterScroll(top, 36, VIEW).delta).toBe(0);
    }
  });

  it("تحت النطاق يُرفع السطر إلى المرساة", () => {
    const top = VIEW.height * 0.85;
    const d = typewriterScroll(top, 36, VIEW);
    expect(d.delta).toBeGreaterThan(0);
    // بعد التمرير يقع مركز السطر على المرساة
    expect(top + 18 - d.delta).toBeCloseTo(VIEW.height * BAND.anchor, 0);
  });

  it("فوق النطاق يُنزل السطر إلى المرساة", () => {
    const d = typewriterScroll(20, 36, VIEW);
    expect(d.delta).toBeLessThan(0);
  });

  it("**لا انزلاق أثناء الكتابة أبدًا**", () => {
    // نقلة كبيرة أثناء الكتابة تبقى فورية: الأنيميشن يُلغى ويُعاد بدؤه
    // مع كل حرف فيتخلّف العرض عن المؤشر
    const far = typewriterScroll(VIEW.height * 0.95, 36, VIEW, { typing: true });
    expect(Math.abs(far.delta)).toBeGreaterThan(SMOOTH_ABOVE_PX);
    expect(far.smooth).toBe(false);
  });

  it("النقلة الملاحية البعيدة تنزلق، والقريبة لا", () => {
    expect(typewriterScroll(VIEW.height * 0.95, 36, VIEW).smooth).toBe(true);
    const near = typewriterScroll(VIEW.height * (BAND.bottom + 0.02), 36, VIEW);
    expect(Math.abs(near.delta)).toBeLessThan(SMOOTH_ABOVE_PX);
    expect(near.smooth).toBe(false);
  });

  it("تقليل الحركة يجعل كل تمرير فوريًا — §١٣", () => {
    const d = typewriterScroll(VIEW.height * 0.95, 36, VIEW, { reduceMotion: true });
    expect(d.smooth).toBe(false);
    expect(d.delta).not.toBe(0);
  });

  it("مساحة بلا ارتفاع لا تُحسب", () => {
    expect(typewriterScroll(100, 36, { height: 0, top: 0 }).delta).toBe(0);
  });

  it("الحشوة تكفي ليبلغ السطر الأول والأخير النطاق", () => {
    const pad = comfortPadding(800);
    expect(pad.top).toBe(Math.round(800 * BAND.anchor));
    expect(pad.top + pad.bottom).toBe(800);
  });
});

// ── تطبيق التفضيل على الشجرة ─────────────────────────────────

/**
 * جذرٌ زائف بأقلّ ما تلمسه `applyToRoot`: `style.setProperty` و
 * `dataset`. لا حاجة إلى DOM كامل لاختبار منطق خالص.
 */
function fakeRoot() {
  const props = new Map<string, string>();
  const dataset: Record<string, string> = {};
  return {
    props,
    dataset,
    el: {
      style: {
        setProperty: (k: string, v: string) => void props.set(k, v),
      },
      dataset,
    } as unknown as HTMLElement,
  };
}

/**
 * السلسلة من عنصر التحكم إلى المتغيّر لم تكن مغطّاة في أي طبقة.
 *
 * اختبار الأسطح يضبط المتغيّرات بنفسه ويؤكّد أن المحرر يتبعها — أي
 * أنه يختبر **الأثر** لا **المتحكِّم**. فلو انقطع الوصل بين المنزلق
 * والمخزن لبقيت الاختبارات كلها خضراء وتوقّف الإعداد عن العمل عند
 * المستخدم.
 */
describe("تغيير التفضيل يصل جذر المستند فورًا", () => {
  it("`applyToRoot` يكتب المتغيّرات الأربعة", () => {
    const { props, el } = fakeRoot();
    applyToRoot(
      { ...DEFAULTS, fontSize: 24, lineHeight: 2.1, columnWidth: 560 },
      el,
    );
    expect(props.get("--luma-editor-size")).toBe("24px");
    expect(props.get("--luma-editor-leading")).toBe("2.1");
    expect(props.get("--editor-measure")).toBe("560px");
    expect(props.get("--luma-editor-family")).toContain("Almarai");
  });

  it("تقليل الحركة يُرفع ويُزال بالسمة", () => {
    const a = fakeRoot();
    applyToRoot({ ...DEFAULTS, reduceMotionOverride: true }, a.el);
    expect(a.dataset["reduceMotion"]).toBe("on");

    const b = fakeRoot();
    b.dataset["reduceMotion"] = "on";
    applyToRoot({ ...DEFAULTS, reduceMotionOverride: false }, b.el);
    expect(b.dataset["reduceMotion"]).toBeUndefined();
  });

  it("`set` يطبّق على الشجرة قبل أن يجدول الكتابة", () => {
    const { props, el } = fakeRoot();
    const store = new PreferencesStore();
    const written: Preferences[] = [];
    store.hydrate({}, el, (v) => written.push(v));

    store.set("fontSize", 26);
    // الأثر فوري — «يظهر أثر إعدادات العرض مباشرة» §١٥
    expect(props.get("--luma-editor-size")).toBe("26px");
    // والكتابة مؤجَّلة، فلا يكتب المنزلق ملفًّا مع كل بكسل
    expect(written).toHaveLength(0);

    store.set("columnWidth", 520);
    expect(props.get("--editor-measure")).toBe("520px");
  });

  it("`flush` يكتب ما جُدول، ومرة واحدة", () => {
    const { el } = fakeRoot();
    const store = new PreferencesStore();
    const written: Preferences[] = [];
    store.hydrate({}, el, (v) => written.push(v));

    store.set("fontSize", 22);
    store.set("lineHeight", 1.5);
    store.flush();
    expect(written).toHaveLength(1);
    expect(written[0]!.fontSize).toBe(22);
    expect(written[0]!.lineHeight).toBe(1.5);

    // لا شيء معلَّق بعدها
    store.flush();
    expect(written).toHaveLength(1);
  });

  it("قيمة لا تتغيّر لا تُطبَّق ولا تُجدوَل", () => {
    const { el } = fakeRoot();
    const store = new PreferencesStore();
    const written: Preferences[] = [];
    store.hydrate({}, el, (v) => written.push(v));

    store.set("fontSize", DEFAULTS.fontSize);
    store.flush();
    expect(written).toHaveLength(0);
  });
});
