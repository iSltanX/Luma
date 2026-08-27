import { describe, expect, it } from "vitest";
import { installPrintThemeGuard, suspendThemeForPrint } from "../src/lib/print";

/**
 * جذرٌ زائف بأقلّ ما تلمسه هذه الدوالّ — نفس الفكرة في
 * `tests/preferences.test.ts` (`fakeRoot`): لا حاجة إلى DOM كامل
 * لاختبار منطق خالص.
 */
function fakeRoot(initial: string | null = null) {
  let attr = initial;
  return {
    getAttribute: (name: string) => (name === "data-theme" ? attr : null),
    setAttribute: (name: string, value: string) => {
      if (name === "data-theme") attr = value;
    },
    removeAttribute: (name: string) => {
      if (name === "data-theme") attr = null;
    },
    get current() {
      return attr;
    },
  };
}

/**
 * هدفٌ زائف بأقلّ ما تلمسه `installPrintThemeGuard`: تسجيل معالجين
 * واستدعاؤهما يدويًا. التحويل الصريح كما في `fakeRoot` أعلى
 * `preferences.test.ts`: توقيعات `Window` الحقيقية محمَّلة زيادةً لا
 * تفيد اختبار منطقٍ خالص.
 */
function fakeTarget() {
  const handlers = new Map<string, () => void>();
  const target = {
    addEventListener: (type: string, handler: () => void) => void handlers.set(type, handler),
    removeEventListener: (type: string) => void handlers.delete(type),
    fire: (type: string) => handlers.get(type)?.(),
    has: (type: string) => handlers.has(type),
  };
  return { ...target, target: target as unknown as Window };
}

describe("suspendThemeForPrint", () => {
  it("يزيل الثيم النشط، والاستعادة تعيده كما كان", () => {
    const root = fakeRoot("midnight");
    const restore = suspendThemeForPrint(root);
    expect(root.current).toBeNull();

    restore();
    expect(root.current).toBe("midnight");
  });

  it("لا سمة أصلًا: الاستعادة لا تضيف واحدة", () => {
    const root = fakeRoot(null);
    const restore = suspendThemeForPrint(root);
    expect(root.current).toBeNull();

    restore();
    expect(root.current).toBeNull();
  });
});

describe("installPrintThemeGuard", () => {
  it("beforeprint يعلّق الثيم، وafterprint يستعيده", () => {
    const root = fakeRoot("sage");
    const target = fakeTarget();
    installPrintThemeGuard(root, target.target);

    target.fire("beforeprint");
    expect(root.current).toBeNull();

    target.fire("afterprint");
    expect(root.current).toBe("sage");
  });

  it("لا ثيم نشطًا وقت الطباعة: afterprint لا يخترع سمة", () => {
    const root = fakeRoot(null);
    const target = fakeTarget();
    installPrintThemeGuard(root, target.target);

    target.fire("beforeprint");
    target.fire("afterprint");
    expect(root.current).toBeNull();
  });

  it("طباعتان متتاليتان: كل واحدة تستعيد الثيم الصحيح", () => {
    const root = fakeRoot("lavender");
    const target = fakeTarget();
    installPrintThemeGuard(root, target.target);

    target.fire("beforeprint");
    target.fire("afterprint");
    target.fire("beforeprint");
    expect(root.current).toBeNull();
    target.fire("afterprint");
    expect(root.current).toBe("lavender");
  });

  it("دالّة الفكّ تُزيل كلا المستمعين", () => {
    const root = fakeRoot("mist");
    const target = fakeTarget();
    const dispose = installPrintThemeGuard(root, target.target);

    expect(target.has("beforeprint")).toBe(true);
    expect(target.has("afterprint")).toBe(true);

    dispose();
    expect(target.has("beforeprint")).toBe(false);
    expect(target.has("afterprint")).toBe(false);
  });
});
