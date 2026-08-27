import { describe, expect, test } from "vitest";
import { deriveWindowControlsSide } from "../src/lib/windowChrome";

/**
 * جانب أزرار النافذة — بند ب/٢١ في `docs/audit/AUDIT-2026-08-27.md`.
 *
 * الاشتقاق كان مطويًا سطرًا واحدًا داخل `App.svelte` بلا اختبار، والفحص
 * الذاتي القائم يقرأ نفس السمة التي تشتقّها هذه الدالة فيقارن نفسه بها
 * — قلبُ المقارنة هناك ينقلب معه ويبقى أخضر. هذا الاختبار وحده يقارن
 * بثابتٍ خارجي: أرقامًا حرفية، لا الدالة بنفسها.
 */
describe("جانب أزرار النافذة — ب/٢١", () => {
  test("زرٌّ في النصف الأول من العرض ⇒ يسار", () => {
    expect(deriveWindowControlsSide(20, 1000)).toBe("left");
  });

  test("زرٌّ في النصف الثاني من العرض ⇒ يمين", () => {
    expect(deriveWindowControlsSide(950, 1000)).toBe("right");
  });

  test("عند نصف العرض بالضبط ⇒ يمين — الحدّ غير شامل من اليسار", () => {
    expect(deriveWindowControlsSide(500, 1000)).toBe("right");
  });

  test("بكسل واحد قبل النصف ⇒ يسار", () => {
    expect(deriveWindowControlsSide(499, 1000)).toBe("left");
  });

  test("الطرف الأيسر تمامًا ⇒ يسار", () => {
    expect(deriveWindowControlsSide(0, 1000)).toBe("left");
  });

  test("الطرف الأيمن تمامًا ⇒ يمين", () => {
    expect(deriveWindowControlsSide(1000, 1000)).toBe("right");
  });
});
