/**
 * انتقالات الأسطح — جدول الحركة في «اللغة البصرية» §١١.
 *
 * «٣٠٠ ملي ثانية للتحولات المتوسطة (فتح النوافذ المنبثقة واللوحات
 * الجانبية)»، و«ease-out للظهور ودخول العناصر» و«ease-in للخروج».
 *
 * **الحركة للأسطح حول النص لا للنص.** الورقة ساكنة أثناء الكتابة
 * بقرار مقيس (`typewriter.ts`)، وما يتحرّك هنا هو ما يعلوها ويزول.
 *
 * ولمَ لا تكفي قاعدة CSS؟ لأن السطح يُركَّب ويُفكَّك شرطيًّا: بلا
 * انتقال خروج يختفي من الشجرة في الإطار نفسه، فلا شيء يبقى ليخفت.
 */

import { cubicIn, cubicOut } from "svelte/easing";
import type { TransitionConfig } from "svelte/transition";
import { MOTION } from "../tokens/motion";

/**
 * مصدران يجمعان ولا يلغي أحدهما الآخر: تفضيل النظام وتفضيل Luma —
 * القاعدة نفسها في `app.css`، والفحص هنا لأن انتقالات Svelte تُحسب
 * في جافاسكربت فلا تبلغها قاعدة `transition-duration` العالمية.
 */
export function reducedMotion(): boolean {
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset["reduceMotion"] === "on"
  );
}

/** مدّة فعلية: صفرٌ عند تقليل الحركة أو عند تخطٍّ يقرّره السياق. */
export function span(ms: number = MOTION.surface, skip = false): number {
  return skip || reducedMotion() ? 0 : ms;
}

export interface SurfaceOptions {
  /** صعود الدخول بالبكسل — صفر يعني ظهورًا بلا إزاحة. */
  rise?: number;
  /**
   * تحويل ثابت يسبق الإزاحة — تمركز الورقة في RTL مثلًا.
   *
   * الإزاحة تُكتب في `transform` نفسه، فلو أغفلنا تحويل التمركز
   * لألغاه الانتقال وقفز السطح إلى طرف النافذة ثم عاد.
   */
  base?: string;
  /** إلغاء الحركة بقرار السياق لا بتفضيل المستخدم. */
  skip?: boolean;
  duration?: number;
}

/**
 * السطح المنسحب لا يلتقط نقرًا — `leaving`.
 *
 * الخروج يُبقيه في الشجرة مدّته كاملة، فنقرةٌ تقع بعد إغلاقه مباشرةً
 * كانت تصيب صفًّا في لوحة يراها المستخدم ذاهبة: أُغلقت المكتبة ففُتح
 * مستند. أما الداخل فيلتقط فورًا — موضعه النهائي من أول إطار، وتأجيل
 * استجابته ثلث ثانية تأخيرٌ يُحَسّ.
 */
function config(
  easing: (t: number) => number,
  o: SurfaceOptions,
  leaving: boolean,
): TransitionConfig {
  const rise = o.rise ?? 0;
  const base = o.base ?? "";
  const dead = leaving ? " pointer-events: none;" : "";
  return {
    duration: span(o.duration ?? MOTION.surface, o.skip ?? false),
    easing,
    css: (t) => {
      const fade = `opacity: ${t};${dead}`;
      if (rise) return `${fade} transform: ${base}translateY(${(1 - t) * rise}px);`;
      return fade;
    },
  };
}

/** دخول سطح: تلاشٍ صاعد بـ`ease-out` — «الظهور ودخول العناصر». */
export function surfaceIn(_node: Element, o: SurfaceOptions = {}): TransitionConfig {
  return config(cubicOut, o, false);
}

/** خروج سطح: انسحاب هادئ بـ`ease-in`. */
export function surfaceOut(_node: Element, o: SurfaceOptions = {}): TransitionConfig {
  return config(cubicIn, o, true);
}
