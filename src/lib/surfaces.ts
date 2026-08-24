/**
 * الأسطح الجانبية الخمسة كما في `IMPLEMENTATION.md` §١٠.
 *
 * القائمة كاملة هنا لأن **المكوّن يحتمل الخمسة بلا تعديل لاحق**، بينما
 * الإطار لا يعرض إلا `IMPLEMENTED`. مدخلٌ لا يفتح شيئًا وعدٌ كاذب.
 *
 * الأفكار والبيئة الصوتية والإملاء خارج نطاق MVP — `Luma.md` §١٨.
 */

import type { IconName } from "../components/icons";

export interface SurfaceEntry {
  id: SurfaceId;
  icon: IconName;
  label: string;
}

export type SurfaceId =
  | "library"
  | "ideas"
  | "history"
  | "ambience"
  | "dictation";

/** الترتيب من بداية القراءة: المكتبة أولًا كما في `شريط الأسطح`. */
export const SURFACES: readonly SurfaceEntry[] = [
  { id: "library", icon: "library", label: "المكتبة" },
  { id: "ideas", icon: "ideas", label: "مساحة الأفكار" },
  { id: "history", icon: "history", label: "السجل الزمني" },
  { id: "ambience", icon: "ambience", label: "البيئة الصوتية" },
  { id: "dictation", icon: "microphone", label: "الإملاء الصوتي" },
];

/** ما بُني فعلًا في المرحلة ٥. */
export const IMPLEMENTED: readonly SurfaceId[] = ["library", "history"];

export const OPEN_SURFACES: readonly SurfaceEntry[] = SURFACES.filter((s) =>
  IMPLEMENTED.includes(s.id),
);
