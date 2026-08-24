/**
 * سلاسل الواجهة تحت الاتجاه الثنائي — `IMPLEMENTATION.md` §٧ **ثابت**.
 *
 * هذا للواجهة لا لنص المستخدم. نص المستخدم تُنزع منه محارف التحكم
 * عند اللصق (`src/editor/paste.ts`).
 */

/** U+2066 LEFT-TO-RIGHT ISOLATE */
const LRI = "⁦";
/** U+2069 POP DIRECTIONAL ISOLATE */
const PDI = "⁩";

/**
 * يعزل مقطعًا لاتينيًا داخل سلسلة عربية.
 *
 * بدون العزل يقذف الاتجاه الثنائي المقطعَ إلى الطرف الخطأ، أو يفصل
 * علامات الترقيم المحيطة عنه.
 */
export function isolate(latin: string): string {
  return `${LRI}${latin}${PDI}`;
}

const ARABIC_INDIC = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

/** أرقام عربية هندية لنصوص الواجهة. اللاتينية للسلاسل التقنية فقط. */
export function arabicDigits(n: number): string {
  return String(Math.trunc(Math.abs(n)))
    .split("")
    .map((d) => ARABIC_INDIC[Number(d)] ?? d)
    .join("");
}

/**
 * مدة تُصاغ نصًّا لا برموز محايدة.
 *
 * «١٢ ثانية» لا «12s»: الرموز المحايدة تُرسم ملتبسة تحت الاتجاه الثنائي.
 */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${arabicDigits(s)} ثانية`;
  const m = Math.round(s / 60);
  if (m < 60) return `${arabicDigits(m)} دقيقة`;
  return `${arabicDigits(Math.round(m / 60))} ساعة`;
}

/**
 * عدد الكلمات كنص واجهة.
 *
 * **لا يُستخدم فيه الفاصل «·»**: شكله شكل «٠»، فـ«١٦ · كلمة» تُقرأ
 * «١٦٠ كلمة».
 */
export function words(n: number): string {
  if (n === 0) return "لا كلمات";
  if (n === 1) return "كلمة واحدة";
  if (n === 2) return "كلمتان";
  if (n <= 10) return `${arabicDigits(n)} كلمات`;
  return `${arabicDigits(n)} كلمة`;
}
