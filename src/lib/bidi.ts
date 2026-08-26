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

/** صيغ العدد العربية: مفرد، مثنى، جمع قلّة (٣–١٠)، تمييز مفرد (١١+). */
type Forms = readonly [one: string, two: string, few: string, many: string];

/** يصوغ عددًا مع تمييزه بالصيغة الصحيحة. `٢ دقيقة` عربية مكسورة. */
function counted(n: number, [one, two, few, many]: Forms): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n <= 10) return `${arabicDigits(n)} ${few}`;
  return `${arabicDigits(n)} ${many}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * زمن ماضٍ **بالكلمات لا بالرموز**.
 *
 * `Luma.md` §١٦ **ثابت**: «لا صيغ وقت برموز محايدة، لأنها تُرسم ملتبسة
 * تحت الاتجاه الثنائي». ولذلك لا «١١:٤٥ م» هنا ولا في أي سطر واجهة،
 * ولو ظهرت في التصميم — الوثيقة أعلى.
 *
 * `now` وسيط لا `Date.now()` داخليًا: يجعل الدالة قابلة للاختبار.
 */
export function sinceLabel(at: number, now: number = Date.now()): string {
  const ago = Math.max(0, now - at);
  if (ago < MINUTE) return "الآن";
  if (ago < HOUR) {
    return `منذ ${counted(Math.floor(ago / MINUTE), ["دقيقة", "دقيقتين", "دقائق", "دقيقة"])}`;
  }
  if (ago < DAY) {
    return `منذ ${counted(Math.floor(ago / HOUR), ["ساعة", "ساعتين", "ساعات", "ساعة"])}`;
  }
  const days = Math.floor(ago / DAY);
  if (days === 1) return "أمس";
  if (days < 7) return `منذ ${counted(days, ["يوم", "يومين", "أيام", "يومًا"])}`;
  if (days < 30) {
    return `منذ ${counted(Math.floor(days / 7), ["أسبوع", "أسبوعين", "أسابيع", "أسبوعًا"])}`;
  }
  if (days < 365) {
    return `منذ ${counted(Math.floor(days / 30), ["شهر", "شهرين", "أشهر", "شهرًا"])}`;
  }
  return `منذ ${counted(Math.floor(days / 365), ["سنة", "سنتين", "سنوات", "سنة"])}`;
}

/**
 * الوقت المتبقي قبل إفراغ عنصر من السلّة تلقائيًا — **بالكلمات لا
 * بالرموز**، القاعدة نفسها في `sinceLabel`.
 *
 * `deletedAt + retentionMs` هو لحظة الإفراغ؛ وما تجاوزها فعلًا (كسحه
 * الإقلاع أو فتح اللوحة ولم يصل الفارغ إلى الواجهة بعد) يُعرض «تختفي
 * الآن» لا مدةً سالبة لا معنى لها.
 */
export function untilTrashEmptyLabel(
  deletedAt: number,
  retentionMs: number,
  now: number = Date.now(),
): string {
  const left = Math.max(0, deletedAt + retentionMs - now);
  if (left < HOUR) return "تختفي الآن";
  if (left < DAY) {
    return `تختفي خلال ${counted(Math.ceil(left / HOUR), ["ساعة", "ساعتين", "ساعات", "ساعة"])}`;
  }
  const days = Math.ceil(left / DAY);
  if (days === 1) return "تختفي غدًا";
  return `تختفي خلال ${counted(days, ["يوم", "يومين", "أيام", "يومًا"])}`;
}

/**
 * فرق عدد الكلمات بين لقطتين، نصًّا.
 *
 * «+٤٠» ممنوعة: الإشارة رمز محايد يُرسم ملتبسًا في سطر عربي — §١٦.
 */
export function wordDelta(current: number, previous: number): string {
  const d = current - previous;
  if (d === 0) return "بلا تغيّر في عدد الكلمات";
  return d > 0 ? `زادت ${words(d)}` : `نقصت ${words(-d)}`;
}
