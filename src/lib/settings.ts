/**
 * أقسام الإعدادات — `Luma.md` §١٥.
 *
 * الوثيقة تعدّ ستة أقسام؛ المبني منها خمسة. **الصوت لا يُعرض** لأن
 * الأصوات الثلاثة نفسها خارج نطاق MVP (§١٨): قسمُ إعدادات لميزة غير
 * موجودة مفاتيحُ لا تشغّل شيئًا — وهو ما مُنع في شريط الأسطح للسبب
 * نفسه. يعود القسم مع الخدمة.
 */

import type { IconName } from "../components/icons";
import { isolate } from "./bidi";

export type SettingsSectionId =
  | "appearance"
  | "writing"
  | "comfort"
  | "language"
  | "trash"
  | "about";

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  icon: IconName;
  /** سطر تحت العنوان يشرح القسم — كما في `ترويسة القسم` بالصفحة ١٦. */
  summary: string;
}

export const SECTIONS: readonly SettingsSection[] = [
  {
    id: "appearance",
    label: "المظهر",
    icon: "appearance",
    summary: "خمس بيئات كتابة — يُطبَّق الاختيار فورًا ويُحفظ للجلسات التالية",
  },
  {
    id: "writing",
    label: "الكتابة",
    icon: "document",
    summary: "خط الكتابة وحجمه وتباعده — تفضيلات عرض عامة لا تغيّر بنية النص",
  },
  {
    id: "comfort",
    label: "المحرر المريح",
    icon: "expand",
    summary: `غلاف واحد تعمل داخله ثلاث طبقات: الآلة الكاتبة والتركيز و${isolate("Zen")}`,
  },
  {
    id: "language",
    label: "اللغة",
    icon: "info",
    summary: `العربية هي لغة ${isolate("Luma")} الأولى، والواجهة ${isolate("RTL")} أصيلة وليست ترجمة`,
  },
  {
    id: "trash",
    label: "السلة",
    // «سجل» مُستعارة — لا أيقونة سلّة في مجموعة الـ٢٢، والسلّة أقرب
    // مفهومًا إلى الذاكرة القابلة للاستعادة منها إلى أي أيقونة أخرى
    // في المجموعة. نمط الاستعارة نفسه في «حول» (`panel`) و«اللغة» (`info`).
    icon: "history",
    summary: "مستندات محذوفة قابلة للاستعادة بسجلها، تُفرَغ بعد ٣٠ يومًا",
  },
  {
    id: "about",
    label: `حول ${isolate("Luma")}`,
    icon: "panel",
    summary: isolate("Write Without Noise"),
  },
];
