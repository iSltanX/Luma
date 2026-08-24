import { test, expect } from "@playwright/test";

/**
 * لقطات مرجعية للمعرض في الثيمات الخمسة — كشف انحدار على طبقة الويب.
 * **ليست شهادة اجتياز**: التحقق داخل `Luma.app` في الفحص الذاتي.
 */

const THEMES = ["paper", "mist", "sage", "lavender", "midnight"] as const;

test.beforeEach(async ({ page }) => {
  await page.goto("/?gallery=1");
  await page.waitForSelector("[data-gallery]");
});

for (const id of THEMES) {
  test(`ثيم ${id} — لقطة مرجعية`, async ({ page }) => {
    await page.click(`[data-theme-switch="${id}"]`);
    await page.waitForTimeout(250);
    await expect(page.locator("[data-gallery]")).toHaveScreenshot(
      `gallery-${id}.png`,
      { maxDiffPixelRatio: 0.01, animations: "disabled" },
    );
  });
}

test("كل ثيم يعطي خلفية متمايزة", async ({ page }) => {
  const seen = new Set<string>();
  for (const id of THEMES) {
    await page.click(`[data-theme-switch="${id}"]`);
    seen.add(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--surface-canvas")
          .trim(),
      ),
    );
  }
  expect(seen.size).toBe(5);
});

test("حلقة التركيز ظاهرة على كل عنصر تفاعلي", async ({ page }) => {
  const missing = await page.evaluate(() => {
    const bad: string[] = [];
    const nodes = document.querySelectorAll<HTMLElement>(
      "[data-gallery] button:not(:disabled), [data-gallery] input:not(:disabled)",
    );
    for (const el of Array.from(nodes).slice(0, 40)) {
      el.focus();
      const cs = getComputedStyle(el);
      const w = parseFloat(cs.outlineWidth || "0");
      // إمّا حلقة على العنصر نفسه أو على شقيقه المنمَّق (input مخفي)
      const sib = el.nextElementSibling
        ? parseFloat(getComputedStyle(el.nextElementSibling).outlineWidth || "0")
        : 0;
      if (w < 1 && sib < 1) bad.push(el.tagName + "." + el.className);
    }
    return bad;
  });
  expect(missing).toEqual([]);
});

test("لا نص عربي دون ١٢ نقطة في المعرض", async ({ page }) => {
  const small = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll("[data-gallery] *"))) {
      const t = el.textContent?.trim() ?? "";
      if (!/[؀-ۿ]/.test(t) || el.children.length > 0) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 12) bad.push(`${el.tagName}:${size}`);
    }
    return bad;
  });
  expect(small).toEqual([]);
});
