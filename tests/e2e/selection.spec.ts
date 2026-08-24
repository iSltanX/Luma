import { test, expect, type Page } from "@playwright/test";

const EDITOR = ".luma-editor";

async function seed(page: Page, text: string) {
  await page.goto("/");
  await page.waitForSelector(EDITOR);
  await page.locator(EDITOR).click();
  await page.keyboard.type(text, { delay: 0 });
}

/** مستطيلات التحديد الحالية. */
function selRects(page: Page) {
  return page.evaluate(() => {
    const s = getSelection();
    if (!s || s.rangeCount === 0 || s.isCollapsed) return [];
    return Array.from(s.getRangeAt(0).getClientRects()).map((r) => ({
      t: Math.round(r.top),
      l: Math.round(r.left),
      w: Math.round(r.width),
      h: Math.round(r.height),
    }));
  });
}

test("النقر المزدوج يحدد كلمة عربية واحدة", async ({ page }) => {
  await seed(page, "الكتابة فعل هادئ لا يحتمل الضجيج");
  // النقر عند موضع محدَّد داخل كلمة، لا في منتصف الفقرة
  const p0 = page.locator(`${EDITOR} p`).first();
  const bb = (await p0.boundingBox())!;
  await page.mouse.dblclick(bb.x + bb.width - 40, bb.y + bb.height / 2);
  const sel = await page.evaluate(() => getSelection()!.toString());
  expect(sel.trim().length).toBeGreaterThan(1);
  // كلمة واحدة لا سطر كامل
  expect(sel.trim().split(/\s+/).length).toBe(1);
  const rects = await selRects(page);
  expect(rects.length).toBe(1);
  expect(rects[0]!.h).toBeLessThan(60);
});

test("التحديد بالسحب يتبع النص ولا يتجاوز عرض السطر", async ({ page }) => {
  await seed(page, "الكتابة فعل هادئ لا يحتمل الضجيج وكل ما يزاحم النص");
  const p = page.locator(`${EDITOR} p`).first();
  const box = (await p.boundingBox())!;
  await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 8, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();

  const rects = await selRects(page);
  expect(rects.length).toBeGreaterThan(0);
  for (const r of rects) {
    expect(r.h, "ارتفاع التحديد بحدود سطر").toBeLessThan(60);
    expect(r.w, "عرض التحديد لا يتجاوز الفقرة").toBeLessThanOrEqual(
      Math.ceil(box.width) + 2,
    );
  }
});

test("تحديد عدة فقرات يعطي مستطيلًا لكل سطر لا كتلة واحدة", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);
  await page.locator(EDITOR).click();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.type(
      "الكتابة فعل هادئ لا يحتمل الضجيج وكل ما يزاحم النص يسرق منه شيئًا",
      { delay: 0 },
    );
    await page.keyboard.press("Enter");
  }
  await page.keyboard.press("Meta+a");
  const rects = await selRects(page);
  expect(rects.length).toBeGreaterThan(3);
  for (const r of rects) expect(r.h).toBeLessThan(60);
});

test("التحديد بلوحة المفاتيح يمتد سطرًا سطرًا", async ({ page }) => {
  await seed(page, "الكتابة فعل هادئ لا يحتمل الضجيج");
  // على macOS ليست Home/End مفاتيح مؤشر — تُستخدم الأسهم.
  // وفي RTL ينتهي السطر يسارًا، فالتمديد إلى الخلف يكون **يمينًا**.
  for (let i = 0; i < 8; i++) await page.keyboard.press("Shift+ArrowRight");
  const rects = await selRects(page);
  expect(rects.length).toBeGreaterThan(0);
  for (const r of rects) expect(r.h).toBeLessThan(60);
});

test("تحديد نص مختلط عربي ولاتيني يبقى متصلًا", async ({ page }) => {
  await seed(page, "كتبت hello للعالم ثم عدت إلى العربية");
  await page.keyboard.press("Meta+a");
  const rects = await selRects(page);
  expect(rects.length).toBeGreaterThan(0);
  for (const r of rects) expect(r.h).toBeLessThan(60);
  const sel = await page.evaluate(() => getSelection()!.toString());
  expect(sel).toContain("hello");
  expect(sel).toContain("العربية");
});

test("لون التحديد من رمز الثيم لا من النظام", async ({ page }) => {
  await seed(page, "الكتابة فعل هادئ");
  const declared = await page.evaluate(() => {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const r of Array.from(rules)) {
        const t = r.cssText;
        if (t.includes("::selection") && t.includes("luma-editor")) return t;
      }
    }
    return "";
  });
  expect(declared).toContain("--accent-selection");
});
