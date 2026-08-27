import { test, expect } from "@playwright/test";
import {
  EDITOR,
  HISTORY,
  HISTORY_ROWS,
  LIBRARY,
  NEWDOC,
  currentDocId,
  dump,
  editorText,
  longParagraph,
  menuDelete,
  open,
  typeParagraph,
  waitRevisions,
} from "./helpers";

/**
 * ما يقع حين يرفض القرص — القواعد التي تحكم الفشل لا النجاح.
 *
 * «لا يُستبدل نصٌّ لم يصل القرص» يحكم المغادرات الثلاث كلها
 * (`open`/`startNew`/`deleteCurrent`)، و«فشل الفتح يترك المستند
 * الحالي كما هو» — §١٧ مبدأ ٤. ولا حزمةَ قبل الجسر تصل أيًّا منها:
 * المسارات كلها خلف `session` التي لا تُنشأ بلا جسر.
 */

test("قرصٌ يرفض الحفظ: لا يُستبدل نصٌّ لم يصل، وتُقال العلّة", async ({ page }) => {
  await open(page, { seed: [{ id: "other", text: "مسودةٌ أخرى في المكتبة." }] });

  const SAVED = "نصٌّ ثمينٌ وصل القرص.";
  const PENDING = " وزيادةٌ لا تصل.";

  await page.locator(EDITOR).click();
  await typeParagraph(page, SAVED, { newGroup: false });
  const id = await currentDocId(page, ["other"]);

  // من الآن كل كتابة تُرفض
  await page.evaluate(() => window.__luma.fail("save_document", "القرص ممتلئ"));
  await page.locator(EDITOR).click();
  await page.keyboard.press("End");
  await page.keyboard.type(PENDING, { delay: 0 });

  await page.click(LIBRARY);
  await page.click('[data-document-row="other"]');

  // «الحفظ أولًا لا بالتوازي: لو فشل، لا يُستبدل شيء»
  await expect(page.locator('[role="alert"]'), "وقيلت العلّة للكاتب").toBeVisible();
  await expect(page.locator('[role="alert"]')).toContainText("تعذّر فتح النص");

  const shown = await editorText(page);
  expect(shown, "المستند الحالي بقي كما هو").toContain(SAVED);
  expect(shown, "بما فيه ما لم يصل القرص").toContain(PENDING.trim());
  expect(shown, "ولم تُفتح المسودة الأخرى").not.toContain("مسودةٌ أخرى");

  // والقرص ما زال على آخر ما نجح — لا كتابةٌ جزئية
  expect((await dump(page)).docs.find((d) => d.id === id)!.text).not.toContain(
    PENDING.trim(),
  );
});

test("حذفٌ ونصّه لم يستقرّ: يُرفض الحذف ويبقى المستند", async ({ page }) => {
  await open(page);
  await page.locator(EDITOR).click();
  await typeParagraph(page, "نصٌّ سيُحذف — أو لا يُحذف.", { newGroup: false });
  const id = await currentDocId(page);

  await page.evaluate(() => window.__luma.fail("save_document", "القرص ممتلئ"));
  await page.locator(EDITOR).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" وزيادة.", { delay: 0 });

  // «والكتابة تستقرّ قبل المحو… وفشل الاستقرار يمنع الحذف كما يمنع
  // الفتح والبدء — الشرط نفسه لا استثناء له»
  await menuDelete(page);
  await expect(page.locator('[role="alert"]')).toBeVisible();

  expect(
    await page.evaluate(() => window.__luma.calls("delete_document")),
    "لم يصل النواةَ نداءُ حذف واحد",
  ).toBe(0);
  expect((await dump(page)).docs.map((d) => d.id), "المستند باقٍ").toContain(id);
  expect((await dump(page)).trash, "ولم يصل السلّة").toEqual([]);
  expect(await editorText(page), "والنصّ باقٍ على الشاشة").toContain("وزيادة");
});

test("«نصّ جديد» ونصٌّ لم يستقرّ: يُرفض ولا تُفرَّغ المساحة", async ({ page }) => {
  await open(page);
  await page.locator(EDITOR).click();
  await typeParagraph(page, "نصٌّ لا يُستبدل.", { newGroup: false });
  await currentDocId(page);

  await page.evaluate(() => window.__luma.fail("save_document", "القرص ممتلئ"));
  await page.locator(EDITOR).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" ومعه ذيل.", { delay: 0 });

  await page.click(NEWDOC);
  await expect(page.locator('[role="alert"]')).toContainText("تعذّر بدء نصّ جديد");
  expect(await editorText(page), "النصّ باقٍ — لم تُفرَّغ المساحة").toContain(
    "ومعه ذيل",
  );
});

test("تعذُّر الاستعادة لا يترك المحرر محبوسًا في وضع القراءة", async ({ page }) => {
  await open(page);
  await page.locator(EDITOR).click();
  await typeParagraph(page, longParagraph(1));
  const id = await currentDocId(page);
  await waitRevisions(page, id, 1);
  await page.keyboard.press("Enter");
  await typeParagraph(page, longParagraph(2), { newGroup: false });
  await waitRevisions(page, id, 2);
  const live = await editorText(page);

  await page.click(HISTORY);
  const rows = page.locator(HISTORY_ROWS);
  await expect(rows.nth(1)).toBeVisible();
  const n = await rows.count();
  await rows.nth(n - 1).click();
  await expect
    .poll(() => page.$eval(EDITOR, (el) => el.getAttribute("contenteditable")))
    .toBe("false");

  // الاستعادة تفشل في النواة — والمحرر يجب أن يخرج من القراءة فقط
  await page.evaluate(() =>
    window.__luma.fail("restore_revision", "تعذّرت الكتابة على القرص"),
  );
  await page.click("[data-restore]");

  await expect(page.locator('[role="alert"]')).toContainText("تعذّرت استعادة هذه النسخة");

  // ولا المستند تغيّر على القرص
  expect((await dump(page)).docs.find((d) => d.id === id)!.text).toContain(
    "فقرةٌ رقم 2",
  );

  // ومخرج المعاينة ما زال يعمل: العودة إلى النصّ الحيّ ممكنة
  await rows.nth(0).click();
  await expect.poll(() => editorText(page)).toBe(live);
  await expect
    .poll(() => page.$eval(EDITOR, (el) => el.getAttribute("contenteditable")))
    .toBe("true");
});

test("تعذُّر تعداد المكتبة لا يمنع الكتابة", async ({ page }) => {
  await open(page, { seed: [{ id: "a", text: "مسودة." }] });
  await page.evaluate(() => window.__luma.fail("list_documents", "تعذّر القراءة"));

  await page.click(LIBRARY);
  // «تعذّر التعداد لا يمنع الكتابة — §١٧ مبدأ ٤»
  await page.locator(EDITOR).click();
  await page.keyboard.type("والكتابة تعمل رغم ذلك.", { delay: 0 });
  await expect.poll(() => editorText(page)).toContain("والكتابة تعمل رغم ذلك.");

  await page.evaluate(() => window.__luma.clearFailures());
  await expect
    .poll(async () => (await dump(page)).docs.length, { message: "وتصل القرص" })
    .toBe(2);
});
