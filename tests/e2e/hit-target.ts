/**
 * هل صندوق ٣٢×٣٢ حول مركز عنصر يصيبه فعلًا — بند ب/٥ في
 * `docs/audit/AUDIT-2026-08-27.md`. كان الحارس القديم يدّعي ذلك بـ
 * `Math.max(r.height, 32)` — شرطٌ لا يمكن أن يتحقق أبدًا. هذا يسأل
 * المتصفح نفسه: هل أركان الصندوق تصل إلى العنصر فعلًا؟
 *
 * **مستقلّة عمدًا لا مضمَّنة**: نسختان شبه متطابقتين كانتا مكرَّرتين
 * حرفيًا بين `tests/e2e/access.spec.ts` و`tests/e2e/bridge/a11y.spec.ts`
 * — كشفته مراجعة كود قبل التزام S7. هذا الملف مصدرٌ واحد لمنطق
 * الأركان؛ الفلترة الخاصّة بكل موضع (متى يُستدعى، وعلى أي عناصر)
 * تبقى في ملفّ الاختبار نفسه.
 *
 * **تُستدعى بإعادة بناء الدالّة داخل `page.evaluate` من مصدرها
 * النصّي** — `page.addInitScript(fn)` **لا يُعرِّف اسمًا عامًّا** في
 * الصفحة (جُرِّب فعليًّا: الدالّة المحقونة لا تصل `window.<اسمها>`،
 * ولم يكشفه اختبارا ب/٥ إلا لأن صفحتَي `/` و`/?settings=1` لا يوجد
 * فيهما `.luma-hit` أصلًا — فمرّ الاختبار خضراء بلا أن يستدعي الدالّة
 * قط). استدعِ `hasRealHitBoxIn(page, el, rect)` من ملفّ الاختبار — هي
 * تمرّر مصدر الدالّة نصًّا وتُعيد بناءه داخل المتصفح.
 */
export function hasRealHitBox(
  el: Element,
  rect: { left: number; top: number; width: number; height: number },
): boolean {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  // ١٥ لا ١٦: الصندوق الحقيقي ٣٢×٣٢ حرفيًّا، فأركانه على حافته بالضبط
  // — نصف مفتوح عند بعض المحركات (طرفٌ يُحسب والمقابل لا)، فتسقط نقطةٌ
  // على الحافة نفسها لا داخل الهدف. بكسل واحد للداخل يثبت «٣٠×٣٠ فأكثر
  // فعليًّا» بلا هشاشة التقريب على الحافة.
  const half = 15;
  const corners: [number, number][] = [
    [-half, -half], [half, -half], [-half, half], [half, half],
  ];
  return corners.every(([dx, dy]) => {
    const x = cx + dx;
    const y = cy + dy;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    // `hit.contains(el)` عمدًا غائب: أيّ نقطةٍ في حشوة صفٍّ عاديّ تصيب
    // الصفّ نفسه، وهو **يحتوي** كل زرٍّ بداخله — فقبولها يُسقِط الحارس
    // على أول عنصرٍ محشوٍّ لا خاصّةً بصندوق الالتقاط. «الإصابة»
    // الصادقة: العنصر نفسه، أو نسلٌ منه (أيقونة داخله).
    return !!hit && (hit === el || el.contains(hit));
  });
}

/** المصدر النصّي لـ`hasRealHitBox` — يُمرَّر إلى `page.evaluate` كوسيط قابل للتسلسل. */
export const HAS_REAL_HIT_BOX_SRC: string = hasRealHitBox.toString();
