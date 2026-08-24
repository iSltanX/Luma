/**
 * ميزانيات الأداء — `IMPLEMENTATION.md` §١٤ والمسألة ١٠ في §١٨.
 *
 * **مقيسة لا مخترعة.** كل رقم هنا مأخوذ من قياس داخل `Luma.app` مبنية
 * على جهاز macOS المستهدف، ومعه هامش يحتمل تفاوت الجهاز والحِمل — لا
 * هامشًا يُخفي انحدارًا. الأرقام المقيسة نفسها في
 * `docs/evidence/phase7-budgets.md`.
 *
 * **بوابة لا لوحة عرض.** يقارن `runSelfTest` كل قياس بميزانيته ويُسقط
 * الفحص عند التجاوز، و`npm run selftest` يخرج بحالة غير صفرية. ميزانية
 * لا تُسقط شيئًا ليست ميزانية بل ملاحظة.
 *
 * أداة قياس لا تُشحن: تُستورد من `src/dev/` خلف علم بيئة.
 */

export interface Budget {
  /** معرّف الفحص الذي يقيسها. */
  id: string;
  /** ما تقيسه، بالعربية. */
  what: string;
  /** السقف. */
  max: number;
  unit: "ms" | "MB" | "كلمة" | "مستند";
  /** آخر قياس رُصد، للمقارنة عند الانحدار. */
  measured: string;
}

/**
 * الميزانيات الست في `PLAN.md` المرحلة ٧.
 *
 * `openToCaret` مقيس من **بدء العملية** لا من تحميل نافذة العرض:
 * المستخدم ينتظر من النقر على الأيقونة، لا من لحظة تسليم WebKit.
 */
export const BUDGETS = {
  openToCaret: {
    id: "budget-open",
    what: "زمن الفتح حتى مؤشر قابل للكتابة",
    max: 1200,
    unit: "ms",
    measured: "٤٨٦–٦٨٤ms عبر ثلاث جولات — الخطوط تكلّف ١٣٧–١٧٢ms منها",
  },
  keystrokeP95: {
    id: "budget-keystroke",
    what: "زمن ظهور الحرف (p95) على مستند ٢٠ ألف كلمة",
    max: 16,
    unit: "ms",
    measured: "٧–٨ms (p50 ٣ms)",
  },
  keystrokeComfortP95: {
    id: "budget-keystroke-comfort",
    what: "زمن ظهور الحرف (p95) والآلة الكاتبة والتركيز مفعَّلان",
    max: 16,
    unit: "ms",
    measured: "٨ms (p50 ٣ms)",
  },
  documentBuild: {
    id: "budget-build",
    what: "زمن بناء مستند ٢٠ ألف كلمة في المحرر",
    max: 600,
    unit: "ms",
    measured: "٣٠٦–٣١٦ms",
  },
  saveTypicalEdit: {
    id: "budget-save",
    what: "زمن حفظ تعديل نموذجي",
    max: 100,
    unit: "ms",
    measured: "٨–٩ms (وسيط ٥ حفظات)",
  },
  memoryGrowth: {
    id: "budget-memory",
    what: "نمو الذاكرة المقيمة في جلسة ممتدة",
    max: 50,
    unit: "MB",
    measured: "−١٫١ إلى +٠٫٦٦MB بعد ١٢ دورة — لا نمو",
  },
  openFromLargeLibrary: {
    id: "budget-library-open",
    what: "زمن فتح مستند من مكتبة كبيرة",
    max: 200,
    unit: "ms",
    measured: "١٤–٣٢ms تعدادًا و١٠–١٢ms فتحًا من ٥٠٧ مستندات",
  },
  documentWords: {
    id: "budget-doc-size",
    what: "حدّ حجم المستند المدعوم",
    max: 20000,
    unit: "كلمة",
    measured: "٢٠١٤٣ كلمة — p95 ٧ms",
  },
  libraryDocuments: {
    id: "budget-library-size",
    what: "حدّ عدد المستندات المدعوم",
    max: 500,
    unit: "مستند",
    measured: "٥٠٠ مستند — تعداد ١٤–٣٢ms",
  },
} as const satisfies Record<string, Budget>;

export type BudgetKey = keyof typeof BUDGETS;

/** حجم المكتبة الاصطناعية التي تُقاس عليها الميزانيتان (هـ) و(و). */
export const LARGE_LIBRARY = BUDGETS.libraryDocuments.max;

/** طول مستند القياس بالكلمات. */
export const LARGE_DOCUMENT = BUDGETS.documentWords.max;
