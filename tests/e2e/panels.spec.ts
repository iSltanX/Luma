import { test, expect, type Page } from "@playwright/test";

/**
 * الإطار واللوحات — مخرَج المرحلة ٥.
 *
 * **ليست شهادة اجتياز**: لا تقود Playwright نافذة `Luma.app` ولا
 * WKWebView. تكشف الانحدار على طبقة الويب، والحكم داخل التطبيق.
 *
 * ما تفحصه: فتح كل لوحة وإغلاقها من مدخلها ومن زرها ومن `Esc`، وبقاء
 * المؤشر والتحديد والتمرير، وألّا يُحبس التركيز داخل لوحة — §١٠.
 */

const EDITOR = ".luma-editor";
const LIBRARY = '[data-surface="library"] button';
const HISTORY = '[data-surface="history"] button';

async function longDoc(page: Page) {
  await page.goto("/");
  await page.waitForSelector(EDITOR);
  await page.locator(EDITOR).click();
  for (let i = 0; i < 14; i++) {
    await page.keyboard.type(
      "الكتابة فعل هادئ لا يحتمل الضجيج، وكل ما يزاحم النص يسرق منه شيئًا، " +
        "كتب المؤلف عن مفهوم flow ثم انتقل إلى الجانب العملي، بين ٥٢٠ و٨٠٠ بكسل.",
      { delay: 0 },
    );
    await page.keyboard.press("Enter");
  }
}

/**
 * تحديد كلمة عربية بالنقر المزدوج — فعلُ مستخدمٍ حقيقي.
 *
 * `Home` لا يُستعمل هنا: على macOS هو «أول المستند» لا «أول السطر»،
 * وسلوك بداية السطر لـ`Home` بند في بطارية العربية يُختبر داخل
 * التطبيق لا على محرك المتصفح.
 */
async function selectWord(page: Page) {
  await page.locator(`${EDITOR} p`).first().dblclick();
  await page.waitForTimeout(80);
}

/** حالة يجب ألّا تتغيّر بفتح لوحة: الورقة والتمرير والمؤشر والتحديد. */
function snapshot(page: Page) {
  return page.evaluate(() => {
    const sheet = document.querySelector(".sheet")!.getBoundingClientRect();
    const sc = document.querySelector(".scroller")!;
    const sel = getSelection();
    return {
      sheetWidth: Math.round(sheet.width),
      // ارتفاع المحتوى هو الدليل الحاسم: لو تغيّر عرض العمود لأُعيد
      // لفّ السطور وتغيّر الارتفاع — وعندها لا معنى لحفظ موضع التمرير
      contentHeight: sc.scrollHeight,
      scrollTop: Math.round(sc.scrollTop),
      anchor: sel?.anchorOffset ?? -1,
      focus: sel?.focusOffset ?? -1,
      selected: sel?.toString() ?? "",
    };
  });
}

test("مدخل المكتبة يفتح ويغلق، والورقة لا يتغيّر عرضها", async ({ page }) => {
  await longDoc(page);
  await page.locator(".scroller").evaluate((e) => (e.scrollTop = 400));

  const before = await snapshot(page);
  await page.click(LIBRARY);
  await expect(page.locator('[data-panel="library"]')).toBeVisible();

  const open = await snapshot(page);
  expect(open.sheetWidth, "عرض الورقة").toBe(before.sheetWidth);
  expect(open.contentHeight, "ارتفاع المحتوى").toBe(before.contentHeight);
  expect(open.scrollTop, "موضع التمرير").toBe(before.scrollTop);

  // المدخل نفسه يغلق — «تُغلق من زر ظاهر داخلها أو من المفتاح نفسه»
  await page.click(LIBRARY);
  await expect(page.locator('[data-panel="library"]')).toHaveCount(0);
});

test("عمود اللوحة ٣٢٠ ويعيد تمركز الورقة فيما بقي", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.waitForSelector(EDITOR);

  const closed = await page.evaluate(() =>
    Math.round(document.querySelector(".sheet")!.getBoundingClientRect().left),
  );
  await page.click(LIBRARY);
  const m = await page.evaluate(() => {
    const panel = document.querySelector('[data-panel="library"]')!;
    const p = panel.getBoundingClientRect();
    const sheet = document.querySelector(".sheet")!.getBoundingClientRect();
    return {
      panelWidth: Math.round(p.width),
      // بداية القراءة يمينًا: اللوحة ملاصقة للحافة اليمنى
      panelRight: Math.round(window.innerWidth - p.right),
      sheetLeft: Math.round(sheet.left),
    };
  });

  expect(m.panelWidth).toBe(320);
  expect(m.panelRight).toBe(0);
  // أُعيد تمركز الورقة: تحرّكت نحو بداية النافذة بنصف عرض اللوحة
  expect(closed - m.sheetLeft).toBe(160);
});

test("لا ترويسة داخل اللوحة — المفتاح الذي يفتح هو الذي يغلق", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);
  await page.click(LIBRARY);

  // لا عنوان مكرَّر ولا زر إغلاق ثانٍ داخل العمود
  await expect(
    page.locator('[data-panel="library"] button[aria-label^="إغلاق"]'),
  ).toHaveCount(0);
  await expect(page.locator('[data-panel="library"] h2')).toHaveCount(0);

  // والاسم يبقى لقارئ الشاشة على العمود نفسه
  await expect(page.locator('aside[aria-label="المكتبة"]')).toHaveCount(1);
});

test("Esc يغلق أي لوحة مفتوحة", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);

  for (const entry of [LIBRARY, HISTORY]) {
    await page.click(entry);
    await expect(page.locator("[data-panel]")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-panel]")).toHaveCount(0);
  }
});

test("لوحة واحدة في كل وقت", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);
  await page.click(LIBRARY);
  await page.click(HISTORY);
  await expect(page.locator("[data-panel]")).toHaveCount(1);
  await expect(page.locator('[data-panel="history"]')).toBeVisible();
});

test("الإغلاق لا يفقد موضع المؤشر ولا التحديد", async ({ page }) => {
  await longDoc(page);
  await selectWord(page);
  const before = await snapshot(page);
  expect(before.selected.length).toBeGreaterThan(0);

  await page.click(LIBRARY);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);

  const after = await snapshot(page);
  expect(after.selected).toBe(before.selected);
  expect(after.anchor).toBe(before.anchor);
  expect(after.focus).toBe(before.focus);
  // التركيز عاد إلى النص
  expect(await page.evaluate(() => document.activeElement?.className)).toContain(
    "luma-editor",
  );
});

test("لا لوحة تحبس التركيز", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);
  await page.click(LIBRARY);

  // من المدخل: Tab يدخل اللوحة، ثم يخرج منها إلى النص بعد عناصرها
  const path: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    path.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return "none";
        if (el.closest("[data-panel]")) return "panel";
        if (el.classList.contains("luma-editor")) return "editor";
        return "outside";
      }),
    );
  }
  expect(path, "التركيز دخل اللوحة").toContain("panel");
  expect(path, "التركيز خرج منها").toContain("editor");
});

test("شريط الأسطح يعرض المداخل المنفَّذة فقط", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll("[data-surface]")].map(
      (e) => (e as HTMLElement).dataset.surface,
    ),
  );
  // الأفكار والصوت والإملاء خارج نطاق MVP — مدخلٌ لا يفتح شيئًا وعدٌ كاذب
  expect(ids).toEqual(["library", "history"]);
});

test("المكتبة الفارغة تشرح نفسها بلا نافذة ترحيب", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);
  await page.click(LIBRARY);
  await expect(page.locator('[data-panel="library"]')).toContainText(
    "لا توجد نصوص بعد",
  );
});

test("شريط التحديد يظهر مع التحديد ويختفي عند استئناف الكتابة", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);
  await page.locator(EDITOR).click();
  await page.keyboard.type("الكتابة فعل هادئ لا يحتمل الضجيج", { delay: 0 });

  await expect(page.locator("[data-selection-toolbar]")).toHaveCount(0);

  await selectWord(page);
  await expect(page.locator("[data-selection-toolbar]")).toBeVisible();

  // الشريط فوق التحديد لا فوقه بالمعنى الحرفي: لا يغطّيه
  const gap = await page.evaluate(() => {
    const bar = document
      .querySelector("[data-selection-toolbar]")!
      .getBoundingClientRect();
    const sel = getSelection()!.getRangeAt(0).getBoundingClientRect();
    return Math.round(sel.top - bar.bottom);
  });
  expect(gap).toBeGreaterThanOrEqual(0);

  await page.keyboard.type("س", { delay: 0 });
  await expect(page.locator("[data-selection-toolbar]")).toHaveCount(0);
});

test("المجموعة المعتمدة ثلاثة أدوار وعلامة اقتباس — لا أكثر", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);
  await page.locator(EDITOR).click();
  await page.keyboard.type("الكتابة فعل هادئ", { delay: 0 });
  await selectWord(page);

  const labels = await page.evaluate(() =>
    [...document.querySelectorAll("[data-selection-toolbar] button")].map((b) =>
      b.textContent!.trim(),
    ),
  );
  // لا مائل ولا غامق ولا H3 ولا قائمة — `Luma.md` §٥
  expect(labels).toEqual(["عادي", "H1", "H2", "«»"]);
});

test("تحويل الدور بالفأرة وبلوحة المفاتيح", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);
  await page.locator(EDITOR).click();
  await page.keyboard.type("عنوان النص", { delay: 0 });
  await selectWord(page);

  await page.click("[data-selection-toolbar] [data-role='h1']");
  expect(
    await page.evaluate(
      () => document.querySelector(".luma-editor")!.firstElementChild!.tagName,
    ),
  ).toBe("H1");

  // الاختصار المعلن في التصميم: ⌘⌥٢ لـH2 و⌘⌥٠ للفقرة
  await page.locator(EDITOR).click();
  await page.keyboard.press("Meta+Alt+Digit2");
  expect(
    await page.evaluate(
      () => document.querySelector(".luma-editor")!.firstElementChild!.tagName,
    ),
  ).toBe("H2");

  await page.keyboard.press("Meta+Alt+Digit0");
  expect(
    await page.evaluate(
      () => document.querySelector(".luma-editor")!.firstElementChild!.tagName,
    ),
  ).toBe("P");
});

test("عدّاد الكلمات مخفي افتراضيًا", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);
  await page.locator(EDITOR).click();
  await page.keyboard.type("كلمات كثيرة تُكتب هنا", { delay: 0 });
  await expect(page.locator(".count")).toHaveCount(0);
});

test("شريط النافذة يحجز طرفًا لأزرار النظام", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);

  for (const side of ["left", "right"] as const) {
    await page.evaluate((s) => {
      document.documentElement.dataset.windowControls = s;
    }, side);
    await page.waitForTimeout(50);

    const m = await page.evaluate(() => {
      const bar = document.querySelector(".titlebar")!.getBoundingClientRect();
      const save = document.querySelector(".save")!.getBoundingClientRect();
      return {
        fromLeft: Math.round(save.left - bar.left),
        fromRight: Math.round(bar.right - save.right),
      };
    });

    // حالة الحفظ تقع في الطرف **المقابل** لأزرار النظام — ADR ٠٠٠٣
    if (side === "left") expect(m.fromRight).toBeLessThan(m.fromLeft);
    else expect(m.fromLeft).toBeLessThan(m.fromRight);
  }
});
