import { test, expect } from "@playwright/test";
import { EDITOR, open } from "./helpers";

/**
 * هندسة الشاشة عبر تفضيلات العرض — `POSITIONS-AUDIT.md` بند ١.
 *
 * الفحص الأصلي (٢٥ أغسطس ٢٠٢٦) وجد عدّاد الكلمات ينفصل عن الورقة
 * ١٨٠px عند عرض النافذة الافتراضي، وأصلحه بربط إزاحته بعرض `.sheet`
 * الفعلي. لكن الإصلاح كتب **٨٨٠px حرفيًا** — عرض الورقة عند «عرض
 * منطقة الكتابة» الأقصى وحده — لا `var(--editor-measure)` رغم أن
 * التفضيل نفسه كان في الكود يوم كُتب الإصلاح (أُضيف في المرحلة ٦،
 * قبله بيوم). فأي عرضٍ أضيق من الأقصى (المدى ٥٢٠–٨٠٠، الإعدادات ←
 * الكتابة) يُبقي العدّاد عند موضع ٨٨٠px القديم بينما تضيق الورقة
 * الفعلية تحته — يطفو في القماش بعيدًا عنها مجددًا.
 *
 * **ليس عطلًا في المحرر المريح**: العدّاد لا يُرسم فيه أصلًا
 * (`{#if showWordCount && !comfort}`) — القيد نفسه يمنع الحالة هناك.
 */

test("عدّاد الكلمات يلاصق الورقة عند أي عرض عمود — لا ٨٠٠ فقط", async ({
  page,
}) => {
  await open(page, { seed: [{ id: "d1", text: "نصٌّ فيه كلماتٌ كافية للعدّاد." }] });

  await page.evaluate(() => window.__luma.emit("luma://menu", "settings"));
  await page.waitForSelector("[data-section]");
  await page.click('[data-section="writing"] button');

  const toggle = page.locator('label.wrap:has(input[aria-label="إظهار عدّاد الكلمات"])');
  await toggle.click();

  const widthSlider = page.locator('input[type="range"][aria-label="عرض منطقة الكتابة"]');
  await widthSlider.focus();
  await page.keyboard.press("Home"); // أضيق عرض ممكن — ٥٢٠px
  await expect(widthSlider).toHaveValue("520");

  await page.click('[aria-label="إغلاق الإعدادات"]');
  await expect(page.locator(EDITOR)).toBeVisible();

  const geo = await page.evaluate(() => {
    const sheet = document.querySelector(".sheet")!.getBoundingClientRect();
    const count = document.querySelector(".count")!.getBoundingClientRect();
    return { sheetWidth: sheet.width, sheetRight: sheet.right, countLeft: count.left };
  });

  // الورقة ضاقت فعلًا — والتحقّق نفسه يسقط لو لم تتأثر بالتفضيل أصلًا
  expect(geo.sheetWidth, "عرض الورقة لم يتبع التفضيل — الفحص بلا معنى").toBeLessThan(700);

  // العدّاد داخل حافة الورقة أو قريبٌ منها — لا طافيًا في القماش
  expect(
    geo.countLeft,
    `عدّاد الكلمات منفصل عن الورقة — الورقة تنتهي عند ${geo.sheetRight} والعدّاد يبدأ عند ${geo.countLeft}`,
  ).toBeLessThanOrEqual(geo.sheetRight + 5);
});
