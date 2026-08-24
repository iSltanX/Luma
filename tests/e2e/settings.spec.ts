import { test, expect, type Page } from "@playwright/test";

/**
 * الإعدادات — `Luma.md` §١٥.
 *
 * على خادم التطوير لا جسر Tauri، فلا تُقرأ التفضيلات ولا تُحفظ ولا
 * تُعدَّد الخطوط. ما يُفحص هنا هو ما لا يحتاج النواة: التخطيط، وأن
 * **الأثر يظهر فورًا** بلا زر حفظ، وأن `Esc` يخرج طبقةً واحدة.
 *
 * الحفظ والخطوط يُفحصان داخل `Luma.app`.
 */

const EDITOR = ".luma-editor";

/**
 * مدخل الإعدادات في التطبيق بند قائمة أصلي (⌘,) — §١. وعلى خادم
 * التطوير لا قائمة نظام، فتُفتح الشاشة بعَلَم كما يُفتح المعرض.
 */
async function openSettings(page: Page) {
  await page.goto("/?settings=1");
  await page.waitForSelector("[data-settings]");
}

test("لا مدخل مرسوم للإعدادات في المحرر — مدخلها من قائمة النظام", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);
  // شريط الأسطح للّوحات وحدها؛ لا زر إعدادات مخترَع فيه
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll("[data-surface]")].map(
      (e) => (e as HTMLElement).dataset["surface"],
    ),
  );
  expect(ids).toEqual(["library", "history"]);
  await expect(page.locator("[data-settings]")).toHaveCount(0);
});

test("زر المحرر المريح عاد ومعه سلوكه", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);
  // المدخل في شريط الأسطح لا عائمًا فوق الورقة — لئلا يعلو النص
  const btn = page.locator("[data-comfort-entry] button");
  await expect(btn).toBeVisible();
  await expect(btn).toBeEnabled();
  await btn.click();
  await expect(page.locator(".shell.comfort")).toBeVisible();
});

test("⌃⌘F يفتح المحرر المريح ويخرج منه", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);
  await page.locator(EDITOR).click();

  await page.keyboard.press("Control+Meta+f");
  await expect(page.locator(".shell.comfort")).toBeVisible();

  await page.keyboard.press("Control+Meta+f");
  await expect(page.locator(".shell.comfort")).toHaveCount(0);
});

test("تغيير الخط أو الحجم أو التباعد أو العرض يظهر فورًا", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);

  const measure = () =>
    page.evaluate(() => {
      const ed = document.querySelector(".luma-editor")!;
      const cs = getComputedStyle(ed);
      const sheet = document.querySelector(".sheet")!.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(document.querySelector(".sheet")!).paddingInlineStart);
      return {
        size: cs.fontSize,
        leading: cs.lineHeight,
        family: cs.fontFamily,
        column: Math.round(sheet.width - pad * 2),
        text: ed.textContent,
      };
    });

  await page.locator(EDITOR).click();
  await page.keyboard.type("نصٌّ لا يتغيّر بتغيّر العرض", { delay: 0 });
  const before = await measure();

  // ما تفعله الإعدادات فعلًا: ضبط متغيّرات على الجذر
  await page.evaluate(() => {
    const s = document.documentElement.style;
    s.setProperty("--luma-editor-size", "24px");
    s.setProperty("--luma-editor-leading", "2.1");
    s.setProperty("--luma-editor-family", '"Geeza Pro", "Almarai", sans-serif');
    s.setProperty("--editor-measure", "560px");
  });
  const after = await measure();

  expect(after.size).toBe("24px");
  expect(parseFloat(after.leading)).toBeCloseTo(24 * 2.1, 0);
  expect(after.family).toContain("Geeza Pro");
  expect(after.column).toBe(560);
  // **ولا يمسّ المحتوى** — §١٧ مبدأ ٣
  expect(after.text).toBe(before.text);
});

test("العناوين تتبع حجم النص فيبقى التسلسل البصري", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);
  await page.locator(EDITOR).click();
  await page.keyboard.type("عنوان", { delay: 0 });
  await page.keyboard.press("Meta+Alt+Digit1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("نص عادي", { delay: 0 });

  const ratio = () =>
    page.evaluate(() => {
      const h1 = document.querySelector(".luma-editor h1")!;
      const p = document.querySelector(".luma-editor p")!;
      return (
        parseFloat(getComputedStyle(h1).fontSize) /
        parseFloat(getComputedStyle(p).fontSize)
      );
    });

  const atDefault = await ratio();
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--luma-editor-size", "26px"),
  );
  const atLarge = await ratio();

  // ٣٢ ÷ ١٩ من `Editor/01` و`Editor/03`
  expect(atDefault).toBeCloseTo(32 / 19, 1);
  expect(atLarge).toBeCloseTo(atDefault, 2);
});

test("تقليل الحركة من تفضيل Luma يُضاف إلى تفضيل النظام", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);

  const duration = () =>
    page.evaluate(() => {
      const el = document.querySelector(".sheet")!;
      return getComputedStyle(el).transitionDuration;
    });

  await page.evaluate(() => {
    document.documentElement.dataset["reduceMotion"] = "on";
  });
  // القاعدة تُصفّر كل انتقال في الشجرة
  const all = await page.evaluate(() =>
    [...document.querySelectorAll("body *")].every((el) => {
      const d = getComputedStyle(el).transitionDuration;
      return d === "0s" || parseFloat(d) <= 0.0001;
    }),
  );
  expect(all, "تقليل الحركة يصفّر كل انتقال").toBe(true);
  expect(await duration()).toBeTruthy();
});

// ── الشاشة ───────────────────────────────────────────────────

test("الأقسام الخمسة، ولا قسم لميزة غير موجودة", async ({ page }) => {
  await openSettings(page);
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll("[data-section]")].map(
      (e) => (e as HTMLElement).dataset["section"],
    ),
  );
  // الصوت خارج النطاق حتى تصل خدمته: مفاتيح لا تشغّل شيئًا وعدٌ كاذب
  expect(ids).toEqual(["appearance", "writing", "comfort", "language", "about"]);
});

test("لا زر «حفظ الإعدادات» في أي قسم — §١٥ **ثابت**", async ({ page }) => {
  await openSettings(page);
  for (const id of ["appearance", "writing", "comfort", "language", "about"]) {
    await page.click(`[data-section="${id}"] button`);
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll("[data-settings] button")].map((b) =>
        (b.textContent ?? "").trim(),
      ),
    );
    expect(labels.join(" "), id).not.toMatch(/حفظ/);
  }
});

test("التنقل عند بداية القراءة والمحتوى بجانبه", async ({ page }) => {
  await openSettings(page);
  const m = await page.evaluate(() => {
    const nav = document.querySelector("[data-settings] nav")!.getBoundingClientRect();
    const content = document
      .querySelector("[data-settings] .content")!
      .getBoundingClientRect();
    return { navRight: Math.round(window.innerWidth - nav.right), navLeft: Math.round(nav.left), contentRight: Math.round(content.right) };
  });
  // بداية القراءة يمين: التنقل ملاصق للحافة اليمنى والمحتوى يساره
  expect(m.navRight).toBe(0);
  expect(m.contentRight).toBeLessThanOrEqual(m.navLeft + 1);
});

test("كل عنصر تحكم في الإعدادات له تسمية وحلقة تركيز", async ({ page }) => {
  await openSettings(page);
  for (const id of ["appearance", "writing", "comfort"]) {
    await page.click(`[data-section="${id}"] button`);
    const bad = await page.evaluate(() => {
      const out: string[] = [];
      const nodes = document.querySelectorAll<HTMLElement>(
        "[data-settings] button:not(:disabled), [data-settings] input:not(:disabled)",
      );
      for (const el of nodes) {
        const name =
          el.getAttribute("aria-label") ??
          el.textContent?.trim() ??
          (el as HTMLInputElement).labels?.[0]?.textContent?.trim() ??
          "";
        if (!name) out.push(el.outerHTML.slice(0, 60));
        el.focus();
        const cs = getComputedStyle(el);
        if (parseFloat(cs.outlineWidth || "0") < 1 && el === document.activeElement) {
          // بعض العناصر تُرسم حلقتها على غلافها — يُقبل إن وُجدت هناك
          const wrap = el.parentElement;
          const w = wrap ? parseFloat(getComputedStyle(wrap).outlineWidth || "0") : 0;
          if (w < 1) out.push("بلا حلقة تركيز: " + el.outerHTML.slice(0, 40));
        }
      }
      return out;
    });
    expect(bad, id).toEqual([]);
  }
});
