/* ملف مولَّد — لا يُحرَّر يدويًا.
 * المصدر: src/tokens/source.json (مستخرج من متغيّرات Figma 7CDWsUiMz0xae1CRwvpmPY)
 * التوليد: node src/tokens/generate.mjs
 */

/** مُدد الحركة بالمللي ثانية — «اللغة البصرية» §١١. */
export const MOTION = {
  quick: 150,
  surface: 300,
  structural: 500,
} as const;

export type MotionTier = keyof typeof MOTION;
