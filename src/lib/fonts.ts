/**
 * أنواع خدمة الخطوط كما تعرضها النواة — مرآة `src-tauri/src/fonts.rs`.
 *
 * لا منطق تغطية هنا: الحكم يقرأه النظام من جدول محارف الخط، والواجهة
 * تعرضه. «النتيجة **معلومة للمستخدم**، لا فلترة تلقائية» — §٨ **ثابت**.
 */

import { isolate } from "./bidi";

export type Coverage = "full" | "partial" | "none";
export type FontSource = "bundled" | "system" | "imported";

export interface FontReference {
  id: string;
  familyName: string;
  source: FontSource;
  arabicCoverage: Coverage;
  localReference: string | null;
}

/** نصّ الشارة بجانب اسم الخط. */
export function coverageLabel(c: Coverage): string {
  switch (c) {
    case "full":
      return "عربية كاملة";
    case "partial":
      return "عربية ناقصة";
    default:
      return "بلا عربية";
  }
}

/** نوع الشارة — والنص معها دائمًا، فلا يُنقل المعنى باللون وحده. */
export function coverageBadge(c: Coverage): "positive" | "caution" | "neutral" {
  switch (c) {
    case "full":
      return "positive";
    case "partial":
      return "caution";
    default:
      return "neutral";
  }
}

export function sourceLabel(s: FontSource): string {
  switch (s) {
    case "bundled":
      return `خطوط ${isolate("Luma")}`;
    case "system":
      return "خطوط النظام";
    default:
      return "خطوط مستوردة";
  }
}

/**
 * التحذير الذي يرافق خطًّا ناقص التغطية — §٨ **ثابت**.
 *
 * «خط بلا تغطية عربية يُقبل مع تحذير ورجوع للعربية.» الرجوع نفسه
 * تفعله سلسلة `font-family` بلا كود؛ هذه الجملة تُعلم المستخدم بما
 * سيراه حتى لا يظنّ اختياره لم يُطبَّق.
 */
export function coverageNotice(f: FontReference): string | null {
  if (f.arabicCoverage === "full") return null;
  if (f.arabicCoverage === "partial") {
    return `هذا الخط لا يغطي التشكيل أو الأرقام العربية الهندية كاملة، وما ينقصه يُرسم بـ${isolate("Almarai")}.`;
  }
  return `هذا الخط لا يكتب العربية، فالنص العربي يُرسم بـ${isolate("Almarai")} واللاتيني به.`;
}
