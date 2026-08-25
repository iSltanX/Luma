/**
 * أفعال القائمة الأصلية — الحدّ الذي يمنعها من نصٍّ لا يراه صاحبه.
 *
 * لا حزمة فحص في المشروع تشغّل قائمة macOS: `tests/e2e` بلا نواة
 * أصلًا، و`selftest` لا يفتحها، و`cargo test` لا يشغّل حلقة التطبيق.
 * فالقاعدة تُختبر هنا حيث تُكتب.
 */

import { describe, it, expect } from "vitest";
import { editingReaches } from "../src/lib/menu";

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
