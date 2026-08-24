import { test, expect, type Page } from "@playwright/test";

const EDITOR = ".luma-editor";

async function typeInto(page: Page, text: string) {
  await page.locator(EDITOR).click();
  await page.keyboard.type(text, { delay: 8 });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);
});

test("مساحة الكتابة تُعلن نفسها منطقةَ تحرير بتسمية عربية", async ({ page }) => {
  const el = page.locator(EDITOR);
  await expect(el).toHaveAttribute("role", "textbox");
  await expect(el).toHaveAttribute("aria-multiline", "true");
  await expect(el).toHaveAttribute("aria-label", "مساحة الكتابة");
});

test("الاتجاه الأساسي مصرَّح به لا مستنتَج من المحتوى", async ({ page }) => {
  await expect(page.locator(EDITOR)).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  // حتى الفقرة الفارغة تحمل الاتجاه
  await expect(page.locator(`${EDITOR} p`).first()).toHaveAttribute("dir", "rtl");
});

test("التتبّع صفر على نص المحرر — التتبّع يفسد اتصال الحروف", async ({ page }) => {
  const spacing = await page
    .locator(EDITOR)
    .evaluate((el) => getComputedStyle(el).letterSpacing);
  expect(["normal", "0px"]).toContain(spacing);
});

test("ارتفاع السطر مصرَّح به لا تلقائي", async ({ page }) => {
  const lh = await page
    .locator(EDITOR)
    .evaluate((el) => getComputedStyle(el).lineHeight);
  expect(lh).not.toBe("normal");
  expect(parseFloat(lh)).toBeGreaterThan(20);
});

test("لا نص عربي دون ١٢ نقطة في أي عنصر ظاهر", async ({ page }) => {
  const tooSmall = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const t = el.textContent?.trim() ?? "";
      if (!/[؀-ۿ]/.test(t)) continue;
      if (el.children.length > 0) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 12) bad.push(`${el.tagName}:${size}px`);
    }
    return bad;
  });
  expect(tooSmall).toEqual([]);
});

test("الكتابة العربية تنتج كتلة نصية واحدة", async ({ page }) => {
  await typeInto(page, "الكتابة فعل هادئ");
  await expect(page.locator(`${EDITOR} p`)).toHaveCount(1);
  await expect(page.locator(`${EDITOR} p`).first()).toHaveText("الكتابة فعل هادئ");
});

test("Enter يشقّ فقرة جديدة", async ({ page }) => {
  await typeInto(page, "الأولى");
  await page.keyboard.press("Enter");
  await page.keyboard.type("الثانية", { delay: 8 });
  await expect(page.locator(`${EDITOR} p`)).toHaveCount(2);
});

test("الحرف الأول يقع يمين الحرف الأخير — تخطيط RTL", async ({ page }) => {
  // نطاق مطويّ يعطي مستطيلًا غير موثوق في WebKit، فيُقاس موضع
  // حرفين فعليين بدل موضع المؤشر: الأول منطقيًا يجب أن يقع
  // يمين الأخير في النص العربي.
  await typeInto(page, "الكتابة فعل هادئ لا يحتمل الضجيج");
  const [firstX, lastX] = await page.evaluate(() => {
    const node = document.querySelector(".luma-editor p")?.firstChild;
    if (!node || !node.textContent) return [-1, -1];
    const len = node.textContent.length;
    const mk = (a: number, b: number) => {
      const r = document.createRange();
      r.setStart(node, a);
      r.setEnd(node, b);
      return r.getBoundingClientRect().left;
    };
    return [mk(0, 1), mk(len - 1, len)];
  });
  expect(firstX).toBeGreaterThan(0);
  expect(lastX).toBeLessThan(firstX);
});

test("تراجع واحد يزيل دفقة كتابة لا حرفًا", async ({ page }) => {
  await typeInto(page, "الكتابة فعل هادئ");
  const before = await page.locator(`${EDITOR} p`).first().textContent();
  await page.keyboard.press("Meta+z");
  const after = (await page.locator(`${EDITOR} p`).first().textContent()) ?? "";
  expect((before ?? "").length - after.length).toBeGreaterThan(1);
});

test("النص المختلط يبقى قابلًا للتحرير بترتيبه المنطقي", async ({ page }) => {
  await typeInto(page, "كتبت hello للعالم");
  await expect(page.locator(`${EDITOR} p`).first()).toHaveText("كتبت hello للعالم");
});

test("المخطط بلا marks: لا غامق ولا مائل يدخلان", async ({ page }) => {
  await typeInto(page, "نص عربي");
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+b"); // لا أمر مرتبط به
  await expect(page.locator(`${EDITOR} strong, ${EDITOR} b, ${EDITOR} em, ${EDITOR} i`)).toHaveCount(0);
});

test("تغيير حجم الخط لا يغيّر بنية المحتوى", async ({ page }) => {
  await typeInto(page, "الكتابة فعل هادئ");
  const before = await page.locator(`${EDITOR}`).innerHTML();
  await page.locator(EDITOR).evaluate((el) => {
    (el as HTMLElement).style.fontSize = "26px";
  });
  const after = await page.locator(`${EDITOR}`).innerHTML();
  expect(after).toBe(before);
});
