/**
 * إتاحة الخطوط المستوردة لنافذة العرض — يحسم المسألة ٨ في §١٨.
 *
 * **لماذا لا يكفي تسجيلها في النواة.** النواة تسجّل الملف بـCoreText
 * في نطاق العملية، وذلك يكفي لعمليةِ التطبيق: بها تُقرأ تغطية الخط
 * ويُتحقَّق من سلامته. لكن WebKit يرسم في **عملية محتوى مستقلة** لا
 * ترث ذلك التسجيل.
 *
 * قيس الفرق داخل `Luma.app`: نصّ بخط مستورد مسجَّل رُسم بعرض ٣١٨px،
 * وبديله الاحتياطي بعرض ٣١٨px — أي أن الخط لم يصل أصلًا.
 *
 * فالإتاحة للعرض تمرّ بمسار الويب نفسه: `@font-face` يشير إلى الملف
 * على القرص عبر بروتوكول الأصول، بنطاق محصور في مجلد خطوط Luma وحده.
 * ولا شبكة في هذا كله — شرطُ المسألة ٨.
 */

import type { FontReference } from "./fonts";

const STYLE_ID = "luma-imported-fonts";

/** يحوّل مسارًا محليًّا إلى عنوان يقبله بروتوكول الأصول. */
type ToAssetUrl = (path: string) => string;

/**
 * يُعلن الخطوط المستوردة لنافذة العرض.
 *
 * يُعاد استدعاؤه عند كل تغيّر في القائمة؛ يستبدل الإعلان كاملًا بدل
 * أن يراكم عناصر `<style>`.
 */
export function declareImportedFonts(
  fonts: readonly FontReference[],
  toAssetUrl: ToAssetUrl,
  doc: Document = document,
): number {
  const imported = fonts.filter(
    (f) => f.source === "imported" && f.localReference,
  );

  let style = doc.getElementById(STYLE_ID);
  if (!style) {
    style = doc.createElement("style");
    style.id = STYLE_ID;
    doc.head.appendChild(style);
  }

  style.textContent = imported
    .map((f) => {
      const url = toAssetUrl(f.localReference!);
      // الاسم يُقتبس ويُنظَّف من علامات الاقتباس: اسم العائلة يأتي من
      // ملف اختاره المستخدم، ولا يجوز أن يكسر قاعدة CSS
      const family = f.familyName.replace(/["\\]/g, "");
      return `@font-face{font-family:"${family}";src:url("${url}");font-display:block}`;
    })
    .join("\n");

  return imported.length;
}
