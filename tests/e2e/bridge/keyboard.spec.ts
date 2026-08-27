import { test, expect, type Page } from "@playwright/test";
import {
  EDITOR,
  currentDocId,
  historyButtons,
  open,
  typeParagraph,
} from "./helpers";

/** يعدّ العناصر المركَّزة خلال `steps` ضغطاتِ `key` التي تصل داخل `[data-settings]`. */
async function tabsReachingSettings(
  page: Page,
  key: "Tab" | "Shift+Tab",
  steps: number,
): Promise<string[]> {
  const reached: string[] = [];
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press(key);
    const inSettings = await page.evaluate(
      () => !!document.activeElement?.closest("[data-settings]"),
    );
    if (inSettings) reached.push((await focused(page)).label);
  }
  return reached;
}

/**
 * ترتيب التبويب في شريط الأسطح — **والأزرار الثلاثة مضاءة**.
 *
 * البند ب/١٥ في `docs/audit/AUDIT-2026-08-27.md`: حارس `access.spec.ts`
 * يؤكّد الدورة `toEqual` حرفيًّا، لكن «تراجع» و«إعادة» و«حذف» معطَّلةٌ
 * فيه أبدًا — `candelete` يشترط `currentId !== null` والجسر غائب —
 * والمعطَّل ليس محطة تركيز. فالدورة المؤكَّدة هناك **خمسة أسماء لا
 * ثمانية**، وترتيب عنقود أفعال المستند لا يُقاس أصلًا.
 *
 * وعلى Chromium عمدًا — الشرح في `playwright.config.ts`.
 */

interface Stop {
  key: string;
  label: string;
  x: number;
}

/** يصف العنصر المركَّز وصفًا يُقرأ، ومعه موضعه الأفقي. */
function focused(page: Page): Promise<Stop> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { key: "BODY", label: "—", x: -1 };
    const holder = el.closest(
      "[data-surface],[data-new-document],[data-comfort-entry],[data-undo],[data-redo],[data-delete-document]",
    ) as HTMLElement | null;
    const key = holder
      ? holder.dataset["surface"]
        ? "surface:" + holder.dataset["surface"]
        : (Object.keys(holder.dataset)[0] ?? "?")
      : el.tagName.toLowerCase();
    return {
      key,
      label: el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().slice(0, 30),
      x: Math.round(el.getBoundingClientRect().left),
    };
  });
}

/** يمشي بـ`Tab` حتى يبلغ الشريط، ثم يجمع محطاته. */
async function barCycle(page: Page, steps: number): Promise<Stop[]> {
  const out: Stop[] = [];
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press("Tab");
    out.push(await focused(page));
  }
  return out;
}

/** مستندٌ فيه محتوى وخطوةُ تراجعٍ وإعادة — فتضيء الأزرار الثلاثة. */
async function litDocument(page: Page): Promise<void> {
  await page.locator(EDITOR).click();
  await typeParagraph(page, "الفقرة الأولى — نصٌّ فيه كلماتٌ كافية ليصير مستندًا.");
  await currentDocId(page);
  await page.keyboard.press("Enter");
  await typeParagraph(page, "والفقرة الثانية تصنع خطوةً ثانية في المكدّس.", {
    newGroup: false,
  });
  // تراجعٌ واحد يُضيء «إعادة» ويُبقي «تراجع» مضيئًا
  await page.keyboard.press("Meta+z");
  await expect
    .poll(() => historyButtons(page), { message: "لم يضئ الزرّان معًا" })
    .toEqual({ undo: true, redo: true });
}

test("الترتيب المرسوم كاملًا: مداخل ثم أفعال ثم أفعال المستند", async ({ page }) => {
  await open(page);
  await litDocument(page);

  await page.locator(EDITOR).click();
  const stops = await barCycle(page, 9);
  const keys = stops.map((s) => s.key).filter((k) => k !== "BODY");

  const expected = [
    "surface:library",
    "surface:history",
    "newDocument",
    "comfortEntry",
    "undo",
    "redo",
    "deleteDocument",
  ];
  const start = keys.indexOf("surface:library");
  expect(start, "الشريط يُطرق بـTab من النص").toBeGreaterThanOrEqual(0);
  expect(
    keys.slice(start, start + expected.length),
    "الترتيب كما هو مرسوم — بالأزرار الثلاثة",
  ).toEqual(expected);

  // **وترتيب التبويب يوافق العين في RTL**: كل محطة إلى يسار ما قبلها،
  // فالمداخل عند بداية القراءة وأفعال المستند عند نهايتها.
  const xs = stops.filter((s) => expected.includes(s.key)).map((s) => s.x);
  for (let i = 1; i < xs.length; i++) {
    expect(xs[i]!, `المحطة ${i + 1} إلى يسار ما قبلها`).toBeLessThan(xs[i - 1]!);
  }

  // والحذف في **أقصى الطرف** — `Luma.md` §٥ **ثابت**
  expect(Math.min(...xs), "الحذف أبعد ما في الشريط").toBe(xs[xs.length - 1]);
});

test("المدخل النشط آخر الشريط، وTab واحدة بعده تدخل اللوحة", async ({ page }) => {
  await open(page);
  await litDocument(page);

  // نفتح المكتبة **بلوحة المفاتيح** لا بالفأرة
  await page.locator(EDITOR).click();
  let f = await focused(page);
  for (let i = 0; i < 5 && f.key !== "surface:library"; i++) {
    await page.keyboard.press("Tab");
    f = await focused(page);
  }
  expect(f.key).toBe("surface:library");

  await page.keyboard.press("Enter");
  await expect(page.locator('[data-panel="library"]')).toBeVisible();

  // «الفتح لا ينقل التركيز» — يبقى على المدخل نفسه
  expect((await focused(page)).key, "التركيز بقي على المدخل").toBe("surface:library");

  // **ضغطةٌ واحدة** — هذا نصّ القاعدة: «اللوحة هي التالية لمدخلها».
  // ولولا أن المدخل النشط آخرُ الشريط في DOM لوقف الكاتب على «حذف
  // النص» بدلًا من اللوحة: فعلٌ هادم مكان ما قصده.
  await page.keyboard.press("Tab");
  const inPanel = await page.evaluate(
    () => !!document.activeElement?.closest('[data-panel="library"]'),
  );
  expect(inPanel, "Tab واحدة بعد المدخل النشط تدخل اللوحة").toBe(true);
  expect((await focused(page)).label).toContain("ابحث");
});

test("الأزرار المعطَّلة تخرج من مسار التبويب على مساحة فارغة", async ({ page }) => {
  await open(page);
  await page.locator(EDITOR).click();

  const keys = (await barCycle(page, 6)).map((s) => s.key);
  expect(keys, "لا حذف — لا مستند").not.toContain("deleteDocument");
  expect(keys, "ولا تراجع — المكدّس صفر").not.toContain("undo");
  expect(keys, "ولا إعادة").not.toContain("redo");
  expect(keys).toEqual(
    expect.arrayContaining([
      "surface:library",
      "surface:history",
      "newDocument",
      "comfortEntry",
    ]),
  );
});

test("شاشة الإعدادات تُخرج الشريط كلّه من مسار التبويب", async ({ page }) => {
  await open(page);
  await litDocument(page);
  await page.evaluate(() => window.__luma.emit("luma://menu", "settings"));
  await page.waitForSelector("[data-section]");

  const reached: string[] = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    const under = await page.evaluate(
      () => !!document.activeElement?.closest("[inert]"),
    );
    if (under) reached.push((await focused(page)).label);
  }
  expect(reached, "لا عنصر تحت الشاشة يصله Tab").toEqual([]);
});

/**
 * أ/١١: ورقة الخط تعلو شاشة الإعدادات، وتلك تصير `inert` تحتها —
 * `IMPLEMENTATION.md:508`. لا مدخل لها في وضع الويب إلا `demo_stage:
 * "fonts"` (الجسر)، وهو ما يمرّ **بشاشة الإعدادات فعلًا** قبل فتح
 * الورقة (`App.svelte`، فرع `stage === "fonts"`) — فالطبقتان قائمتان
 * معًا كما في الاستعمال الحقيقي.
 */
test("ورقة الخط تُخرج شاشة الإعدادات كلّها من مسار التبويب — أ/١١", async ({
  page,
}) => {
  await open(page, { stage: "fonts" });
  await expect(page.locator("[data-font-sheet]")).toBeVisible();

  const forward = await tabsReachingSettings(page, "Tab", 20);
  expect(forward, "عنصرٌ خلف ورقة الخط استقبل التركيز أمامًا").toEqual([]);

  const backward = await tabsReachingSettings(page, "Shift+Tab", 20);
  expect(backward, "عنصرٌ خلف ورقة الخط استقبل التركيز خلفًا").toEqual([]);
});
