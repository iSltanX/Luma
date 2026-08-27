import { test, expect, type Page } from "@playwright/test";
import { EDITOR, currentDocId, open, typeParagraph } from "./helpers";

/**
 * التصدير عبر مسار المنتج — `Luma.md` §٢٠ مسألة ٢٠،
 * [ADR ٠٠٢٠](../../../docs/decisions/0020-export.md).
 *
 * **يُطرق بند القائمة الحقيقي** (`luma://menu` بمعرّف `export:*`) لا
 * `exportAs` مباشرةً: الوصل بين النواة والواجهة هو ما يُختبر هنا —
 * الدوالّ الخالصة مغطّاة في `tests/export.test.ts`، والكتابة على القرص
 * في Rust.
 */

/** يطرق بند تصديرٍ من قائمة النظام كما تبثّه النواة. */
function menuExport(page: Page, format: string): Promise<number> {
  return page.evaluate(
    (f) => window.__luma.emit("luma://menu", `export:${f}`),
    format,
  );
}

const lastExport = (page: Page) => page.evaluate(() => window.__luma.lastExport());

test("Markdown: العنوان ترويسةً مرّة واحدة، والمحتوى كما على الشاشة", async ({
  page,
}) => {
  await open(page);
  await page.locator(EDITOR).click();
  await typeParagraph(page, "في الهدوء تكتب الجملة الأولى وهي أثقل ما في النهار.");
  await currentDocId(page);

  expect(await menuExport(page, "markdown"), "لا مستمع لبند التصدير").toBeGreaterThan(0);

  await expect
    .poll(() => lastExport(page), { message: "لم يصل التصدير إلى النواة" })
    .not.toBeNull();

  const got = (await lastExport(page))!;
  expect(got.extension).toBe("md");
  expect(got.fileName.endsWith(".md")).toBe(true);
  // العنوان مشتقّ من أول سطر — فيظهر ترويسةً ولا يتكرّر نصًّا
  expect(got.contents.startsWith("# في الهدوء")).toBe(true);
  expect(got.contents.match(/في الهدوء/g), "العنوان مرّة واحدة").toHaveLength(1);
});

test("نصّ عادٍ: بلا أي علامة Markdown", async ({ page }) => {
  await open(page);
  await page.locator(EDITOR).click();
  await typeParagraph(page, "سطرٌ أول فيه كلماتٌ كافية ليصير عنوانًا للمستند.");
  await currentDocId(page);

  await menuExport(page, "text");
  await expect.poll(() => lastExport(page)).not.toBeNull();

  const got = (await lastExport(page))!;
  expect(got.extension).toBe("txt");
  expect(got.contents).not.toContain("#");
  expect(got.contents).toContain("سطرٌ أول");
});

test("اسم الملف يحمل العنوان العربي كما هو", async ({ page }) => {
  await open(page);
  await page.locator(EDITOR).click();
  await typeParagraph(page, "رسالةٌ إلى صديق قديم لم أره منذ سنوات طويلة.");
  await currentDocId(page);

  await menuExport(page, "markdown");
  await expect.poll(() => lastExport(page)).not.toBeNull();

  const got = (await lastExport(page))!;
  expect(got.fileName).toContain("رسالةٌ إلى صديق");
  expect(got.fileName, "لا فاصل مسار في اسم ملف").not.toContain("/");
});

/**
 * **PDF لم تُعتمد بعد** — الطباعة تحتاج ورقة أنماط طباعة، وبدونها تخرج
 * صفحةٌ واحدة بأدوات الواجهة فيها (قِيس في `Luma.app` — تجربةُ S9).
 * فالبند يقول ذلك للكاتب ولا يكتب ملفًا ناقصًا صامتًا.
 */
test("PDF تُبلّغ أنها غير مكتملة ولا تكتب ملفًا", async ({ page }) => {
  await open(page);
  await page.locator(EDITOR).click();
  await typeParagraph(page, "نصٌّ فيه ما يكفي من الكلمات ليصير مستندًا حقيقيًّا.");
  await currentDocId(page);

  await menuExport(page, "pdf");

  await expect(page.locator('[role="alert"], .alert').first()).toBeVisible();
  expect(await lastExport(page), "لا ملف يُكتب قبل اكتمال المسار").toBeNull();
});
