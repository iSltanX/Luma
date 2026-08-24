/**
 * طبقة الآلة الكاتبة — `IMPLEMENTATION.md` §٧ **ثابت في السلوك**.
 *
 * «بعد كل تغيير في التحديد أو النص: يُحسب مستطيل المؤشر، ثم تُمرَّر
 * مساحة النص بحيث يستقر السطر النشط في نطاق مريح قرب الوسط.»
 *
 * الحساب هنا خالص — بلا DOM — ليُختبر بلا متصفح. الاستدعاء يمرّر
 * مستطيلات مقيسة ويتلقّى قرارًا.
 */

/**
 * النطاق المريح كنسبة من ارتفاع مساحة الكتابة.
 *
 * **نطاق لا نقطة**: تثبيت السطر على نقطة واحدة يعني تمريرًا مع كل
 * ضغطة مفتاح تقريبًا — اهتزازٌ لا هدوء. داخل النطاق لا يتحرّك شيء،
 * وخارجه يُعاد السطر إلى مرساته.
 *
 * المرساة ٤٥٫٥٪ من الارتفاع كما في `نطاق الآلة الكاتبة` (`123:80`):
 * ٤١٠ من ٩٠٠. والنطاق يمتدّ حولها بما يكفي لسطرين.
 */
export const BAND = { top: 0.36, anchor: 0.455, bottom: 0.56 } as const;

/**
 * فوق هذا الفارق يكون الانتقال قفزة لا انزلاقًا.
 *
 * الانزلاق **لا يُستعمل أثناء الكتابة أبدًا**: أنيميشن التمرير يستغرق
 * نحو ٣٠٠ms، والكتابة تُطلق تغييرًا كل ١٠٠ms — فيُلغى الانزلاق ويُعاد
 * بدؤه بلا توقف، ويتخلّف العرض عن المؤشر. جُرِّب فقيس: بقي السطر
 * النشط ٢٣٨px تحت النطاق ولم يبلغه.
 *
 * هدوء الكتابة يأتي من **النطاق** لا من الأنيميشن: معظم الضغطات لا
 * تحرّك شيئًا أصلًا، وما يتحرّك يتحرّك سطرًا واحدًا.
 *
 * يبقى الانزلاق لنقلة **ملاحية** بعيدة — نقرٌ في مكان آخر أو `Cmd+↑`
 * — حيث تحتاج العين أن تتبع الطريق.
 */
export const SMOOTH_ABOVE_PX = 160;

export interface Viewport {
  /** ارتفاع مساحة الكتابة المرئية. */
  height: number;
  /** موضع أعلى مساحة الكتابة في إحداثيات النافذة. */
  top: number;
}

export interface Decision {
  /** المقدار المضاف إلى `scrollTop`. صفر يعني لا تمرير. */
  delta: number;
  /** انزلاق أم قفزة فورية. */
  smooth: boolean;
}

export const STAY: Decision = { delta: 0, smooth: false };

/**
 * يقرّر تمرير الآلة الكاتبة.
 *
 * @param caretTop  أعلى مستطيل المؤشر في إحداثيات النافذة
 * @param caretHeight ارتفاع سطر المؤشر
 * @param view مساحة الكتابة المرئية
 * @param opts `typing` أثناء تغيّر النص، و`reduceMotion` من §١٣.
 *             كلاهما يفرض تمريرًا فوريًا.
 */
export function typewriterScroll(
  caretTop: number,
  caretHeight: number,
  view: Viewport,
  opts: { typing?: boolean; reduceMotion?: boolean } = {},
): Decision {
  if (view.height <= 0) return STAY;

  // موضع منتصف السطر داخل مساحة الكتابة
  const center = caretTop + caretHeight / 2 - view.top;
  const min = view.height * BAND.top;
  const max = view.height * BAND.bottom;

  if (center >= min && center <= max) return STAY;

  const anchor = view.height * BAND.anchor;
  const delta = Math.round(center - anchor);
  if (delta === 0) return STAY;

  return {
    delta,
    smooth:
      !opts.typing && !opts.reduceMotion && Math.abs(delta) > SMOOTH_ABOVE_PX,
  };
}

/**
 * الحشوة التي تسمح للسطر الأول والأخير ببلوغ النطاق.
 *
 * «بحشوة علوية وسفلية تكفي ليصل السطر الأول والأخير إلى ذلك النطاق»
 * — §٧. بدونها يقف السطر الأول عند أعلى الصفحة ولا ينزل إلى الوسط،
 * فتنكسر الطبقة عند بداية المستند ونهايته تحديدًا.
 */
export function comfortPadding(viewHeight: number): { top: number; bottom: number } {
  return {
    top: Math.round(viewHeight * BAND.anchor),
    bottom: Math.round(viewHeight * (1 - BAND.anchor)),
  };
}
