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
