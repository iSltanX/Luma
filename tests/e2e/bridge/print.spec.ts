import { test, expect } from "@playwright/test";
import { open } from "./helpers";

/**
 * ورقة أنماط الطباعة (تصدير PDF) — `docs/decisions/0020-export.md`.
 *
 * الفحص الذي سبق هذا الملف داخل `Luma.app` مبنية (٢٧ أغسطس ٢٠٢٦) وجد
 * أن المسار (WKWebView ← لوحة الطباعة الأصلية عبر Tauri) يعمل ويرسم
 * العربية رسمًا صحيحًا، والعائق الوحيد كان غياب `@media print` كليًّا:
 * «صفحة ١ من ١» لمستند طويل (`.scroller` يقصّه)، وأدوات الواجهة تُطبع
 * مع النص، ولون الشاشة النشط — لا الورق الأبيض — يُطبع بصرف النظر عن
 * قرار المنتج.
 *
 * هذا الفحص لا يستطيع تشغيل محرك الطباعة الأصلي (لا WebDriver
 * لـWKWebView على macOS، والفحص هنا على WebKit المستقل). فيتحقق من
 * **الأثر المرصود بمحاكاة وسيط الطباعة** (`page.emulateMedia`) بدل
 * ذلك: هل تختفي عناصر الواجهة فعليًا، وهل يرتفع القصّ عن سلسلة
 * التمرير، وهل يُبطَل الثيم النشط. `beforeprint`/`afterprint` تُطلَق
 * يدويًا لا عبر `window.print()` الحقيقي — الأخير يُعلِّق التنفيذ في
 * متصفح بلا واجهة.
 */

test("عناصر الواجهة تختفي والقصّ يرتفع عن سلسلة التمرير عند الطباعة", async ({
  page,
}) => {
  await open(page, { seed: [{ id: "d1", text: "نصٌّ فيه كلماتٌ كافية." }] });

  await page.emulateMedia({ media: "print" });

  const geo = await page.evaluate(() => {
    const displayOf = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).display : null;
    };
    const scroller = getComputedStyle(document.querySelector(".scroller")!);
    return {
      titlebar: displayOf(".titlebar"),
      surfaces: displayOf(".surfaces"),
      bodyOverflow: getComputedStyle(document.body).overflow,
      lumaOverflow: getComputedStyle(document.getElementById("luma")!).overflow,
      scrollerOverflowX: scroller.overflowX,
      scrollerOverflowY: scroller.overflowY,
      sheetPaddingBottom: getComputedStyle(document.querySelector(".sheet")!).paddingBottom,
      space048: getComputedStyle(document.documentElement).getPropertyValue("--space-048").trim(),
    };
  });

  // شريط النافذة وشريط الأسطح يحملان `luma-chrome` — لا يُطبعان
  expect(geo.titlebar, "شريط النافذة لم يُخفَ عند الطباعة").toBe("none");
  expect(geo.surfaces, "شريط الأسطح لم يُخفَ عند الطباعة").toBe("none");

  // لا قصّ يبقي الطباعة عند «صفحة ١ من ١» — العطل الذي رصده سبق هذا الفحص
  expect(geo.bodyOverflow, "body ما زال يقصّ المستند الطويل").toBe("visible");
  expect(geo.lumaOverflow, "#luma ما زال يقصّ المستند الطويل").toBe("visible");
  expect(geo.scrollerOverflowX, ".scroller ما زال يقصّ أفقيًا").toBe("visible");
  expect(geo.scrollerOverflowY, ".scroller ما زال يقصّ رأسيًا — العطل الأصلي بعينه").toBe(
    "visible",
  );

  // حشوة الورقة السفلية الشاشية (٤٠vh) استُبدلت — لا صفحة أخيرة فارغة
  expect(geo.sheetPaddingBottom, "حشوة الورقة السفلية ما زالت قياسًا شاشيًا").toBe(
    geo.space048,
  );
});

test("الورق أبيض دائمًا عند الطباعة، بصرف النظر عن ثيم الشاشة", async ({ page }) => {
  await open(page, { seed: [{ id: "d1", text: "نصٌّ فيه كلماتٌ كافية." }] });

  // ثيمٌ داكن نشط — القيمة التي يجب أن تُبطَل وقت الطباعة
  await page.evaluate(() => {
    document.documentElement.dataset["theme"] = "midnight";
  });

  const paperOnScreen = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--surface-paper").trim(),
  );

  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));

  const themeDuringPrint = await page.evaluate(() =>
    document.documentElement.getAttribute("data-theme"),
  );
  const paperDuringPrint = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--surface-paper").trim(),
  );

  expect(themeDuringPrint, "الثيم لم يُبطَل عند الطباعة").toBeNull();
  expect(
    paperDuringPrint,
    "لون الورق أثناء الطباعة ما زال لون الثيم الداكن لا الافتراضي",
  ).not.toBe(paperOnScreen);

  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));

  const themeAfter = await page.evaluate(() =>
    document.documentElement.getAttribute("data-theme"),
  );
  expect(themeAfter, "الثيم لم يعد بعد انتهاء الطباعة — المستخدم يرى شاشته تغيّرت").toBe(
    "midnight",
  );
});
