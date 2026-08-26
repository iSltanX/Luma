/**
 * أفعال القائمة الأصلية — الحدّ الذي يمنعها من نصٍّ لا يراه صاحبه.
 *
 * لا حزمة فحص في المشروع تشغّل قائمة macOS: `tests/e2e` بلا نواة
 * أصلًا، و`selftest` لا يفتحها، و`cargo test` لا يشغّل حلقة التطبيق.
 * فالقاعدة تُختبر هنا حيث تُكتب.
 */

import { describe, it, expect } from "vitest";
import { editingReaches, historyReaches } from "../src/lib/menu";

const clear = { settings: false, fontSheet: false, preview: false };

describe("التحرير لا يصل نصًّا محجوبًا", () => {
  it("المحرر ظاهر — يصل", () => {
    expect(editingReaches(clear)).toBe(true);
  });

  /**
   * العطل الذي وقع: ⌘Z أمام الإعدادات يتراجع في المستند المحجوب —
   * والمستخدم يظنّه يتراجع عن تغيير إعداد — ثم يثبّت الحفظُ التلقائي
   * المحوَ على القرص. و`inert` لا يحجب حدثًا لا يمرّ بشجرة الصفحة.
   */
  it("شاشة الإعدادات تغطّيه — لا يصل", () => {
    expect(editingReaches({ ...clear, settings: true })).toBe(false);
  });

  it("ورقة الخط فوقه — لا يصل", () => {
    expect(editingReaches({ ...clear, fontSheet: true })).toBe(false);
  });

  /** المعاينة قراءةٌ فقط — `Luma.md` §٩ **ثابت**. */
  it("معاينة نسخة — لا يصل", () => {
    expect(editingReaches({ ...clear, preview: true })).toBe(false);
  });
});

/**
 * زرّا التراجع والإعادة — `Luma.md` §٥، القرار ٤.
 *
 * «زرٌّ مضيء لا يفعل شيئًا أسوأ من زرٍّ خافت»: كل حالة هنا تُضيء الزرّ
 * على ضغطةٍ لا أثر لها لو سقط شرطها.
 */
describe("إضاءة زرّي التراجع والإعادة", () => {
  it("مكدّس فيه خطوة والمحرر ظاهر — يضيء", () => {
    expect(historyReaches(1, clear, false)).toBe(true);
  });

  /**
   * **العمق الفعليّ لا وجود الكتابة.** مستندٌ فُتح من المكتبة فيه ألف
   * كلمة مكدّسه صفر (`setBlocks` يمسح السجل)، ومستندٌ كُتب فيه ثم
   * تُرووجع عن كل خطوة مكدّسه صفر كذلك — وكلاهما كتابةٌ موجودة.
   */
  it("مكدّس فارغ — خافت مهما كان في المستند من نصّ", () => {
    expect(historyReaches(0, clear, false)).toBe(false);
  });

  it("المعاينة قراءةٌ فقط — خافت ولو امتلأ المكدّس", () => {
    expect(historyReaches(5, { ...clear, preview: true }, false)).toBe(false);
  });

  it("الإعدادات تغطّي المحرر — خافت", () => {
    expect(historyReaches(5, { ...clear, settings: true }, false)).toBe(false);
  });

  it("ورقة الخط فوقه — خافت", () => {
    expect(historyReaches(5, { ...clear, fontSheet: true }, false)).toBe(false);
  });

  /** المغادرة تغلق الإدخال، و`EditorCore.undo` يرفض حينها. */
  it("مغادرةٌ جارية — خافت", () => {
    expect(historyReaches(5, clear, true)).toBe(false);
  });
});
