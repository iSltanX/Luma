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
 * **PDF عبر لوحة الطباعة الأصلية لا `export_document`** — الشرح في
 * `commands.rs`: لا كتل تُقرأ ولا محتوى يُمرَّر، فـ`lastExport` (خاصّة
 * بمسار Markdown/نصّ) تبقى فارغة بعد PDF بالضرورة، لا لأن المسار غير
 * مكتمل. أنماط `@media print` (`app.css`، `EditorShell.svelte`) هي
 * ما يُخفي عناصر الواجهة ويفرض الورق الأبيض — مُختبرة بمعزل في
 * `tests/e2e/bridge/print.spec.ts`.
 */
test("PDF يطرق لوحة الطباعة الأصلية — لا export_document", async ({ page }) => {
  await open(page);
  await page.locator(EDITOR).click();
  await typeParagraph(page, "نصٌّ فيه ما يكفي من الكلمات ليصير مستندًا حقيقيًّا.");
  await currentDocId(page);

  expect(await menuExport(page, "pdf"), "لا مستمع لبند التصدير").toBeGreaterThan(0);

  await expect
    .poll(() => page.evaluate(() => window.__luma.calls("print_document")), {
      message: "لم يصل بند PDF إلى أمر الطباعة",
    })
    .toBeGreaterThan(0);
  expect(await lastExport(page), "PDF لا يمرّ بـexport_document").toBeNull();
});
