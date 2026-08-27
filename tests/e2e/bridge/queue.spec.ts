import { test, expect } from "@playwright/test";
import {
  EDITOR,
  HISTORY,
  HISTORY_ROWS,
  currentDocId,
  dump,
  editorText,
  longParagraph,
  open,
  typeParagraph,
  waitRevisions,
} from "./helpers";

/**
 * تشابك المغادرات — البند أ/٩ في `docs/audit/AUDIT-2026-08-27.md`.
 *
 * «**ضمن طابور المغادرات نفسه**… فيستبدل أحدهما ما فعله الآخر بلا
 * حدث ولا رسالة» — `App.svelte` و`session.ts`.
 *
 * **حاجزان مستقلان يحرسان هذه القاعدة، وهذا الملف يقيس أثرهما لا
 * أحدهما:**
 * ١. `busy` في `App.svelte` — يُرفع من أول لحظة في `preview()` و
 *    `restore()`، فيُسقط ضغطةَ «نصّ جديد» أو «فتح مسودة» قبل أن تبدأ.
 * ٢. `runExclusive` في `EditorSession` — الطابور نفسه، ويحرس ما لا
 *    يمرّ بالواجهة.
 *
 * **وقيدٌ مُقِرٌّ به:** اختبارٌ من خارج الصندوق **لا يميّز الحاجزين**.
 * ما دام `busy` يُسقط الضغطة قبل الطابور، فإزالة `runExclusive` وحدها
 * لا تُحمِّر شيئًا — جُرِّب فعلًا فبقيت تسع اختبارات خضراء. فما يحرسه
 * هذا الملف هو **القاعدة** لا آليّتها: أُثبت سقوطه بإزالة الحاجزين
 * معًا. وحراسةُ الطابور بمفرده تحتاج اختبار وحدة على `EditorSession`،
 * وهو قائمٌ فعلًا (`tests/session.test.ts`) — لكنه يقيس أن الطابور
 * يسلسل ما يُوضع فيه، لا أنّ `preview()` توضع فيه.
 */

test("«نصّ جديد» أثناء رحلة استعادة لا يخلط المستندين", async ({ page }) => {
  await open(page);
  await page.locator(EDITOR).click();
  await typeParagraph(page, longParagraph(1));
  const id = await currentDocId(page);
  await waitRevisions(page, id, 1);
  await page.keyboard.press("Enter");
  await typeParagraph(page, longParagraph(2), { newGroup: false });
  await waitRevisions(page, id, 2);

  await page.click(HISTORY);
  const rows = page.locator(HISTORY_ROWS);
  await expect(rows.nth(1)).toBeVisible();
  const n = await rows.count();
  await rows.nth(n - 1).click(); // معاينة أقدم لقطة
  await expect
    .poll(() => page.$eval(EDITOR, (el) => el.getAttribute("contenteditable")))
    .toBe("false");

  // رحلة الاستعادة تستغرق ثانية وربعًا، ونضغط «نصّ جديد» في وسطها
  await page.evaluate(() => window.__luma.delay("restore_revision", 1200));
  await page.click("[data-restore]", { noWaitAfter: true });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const b = document.querySelector<HTMLButtonElement>("[data-new-document] button")!;
    b.disabled = false; // نتجاوز الإخفات المرسوم لنبلغ الحارس الحقيقي
    b.click();
  });

  // ننتظر **اكتمال** الرحلة لا بدأها: مع تأخيرٍ صناعي يفترق العدّادان
  await expect
    .poll(() => page.evaluate(() => window.__luma.done("restore_revision")), {
      timeout: 15_000,
    })
    .toBe(1);
  await expect
    .poll(() => page.$eval(EDITOR, (el) => el.getAttribute("contenteditable")), {
      message: "لم يخرج المحرر من وضع القراءة بعد الاستعادة",
    })
    .toBe("true");
  await page.waitForTimeout(400);

  const shown = await editorText(page);
  const st = await dump(page);
  const doc = st.docs.find((d) => d.id === id)!;

  // **الدعوى:** الشاشة والقرص متفقان، ولا مستند ثالث وُلد من الخلط.
  expect(st.docs.length, "لا مستند ثالث من كتلٍ تسرّبت").toBe(1);
  expect(doc.text.replace(/\n/g, " "), "القرص على النسخة المستعادة").toContain(
    "فقرةٌ رقم 1",
  );
  expect(doc.text, "ولا أثر لما استُبدل").not.toContain("فقرةٌ رقم 2");

  // المقارنة على نصٍّ مطبَّع: `editorText` يقلّم أطراف كل فقرة،
  // والقرص يحفظها كما كُتبت — والفرق مسافةٌ لا معنى لها هنا.
  const flat = (s: string) => s.replace(/\s+/g, " ").trim();
  expect(
    flat(shown),
    "والشاشة توافق القرص — لا نصّ معروضٌ لا مالك له",
  ).toBe(flat(doc.text));

  // ولا لافتة معاينة معلّقة على محررٍ صار قابلًا للكتابة
  expect(await page.$eval(EDITOR, (el) => el.getAttribute("contenteditable"))).toBe(
    "true",
  );
});

test("«نصّ جديد» أثناء رحلة معاينة لا يملأ المساحة الجديدة بلقطة", async ({
  page,
}) => {
  await open(page);
  await page.locator(EDITOR).click();
  await typeParagraph(page, longParagraph(1));
  const id = await currentDocId(page);
  await waitRevisions(page, id, 1);
  await page.keyboard.press("Enter");
  await typeParagraph(page, longParagraph(2), { newGroup: false });
  await waitRevisions(page, id, 2);

  await page.click(HISTORY);
  const rows = page.locator(HISTORY_ROWS);
  await expect(rows.nth(1)).toBeVisible();
  const n = await rows.count();

  await page.evaluate(() => window.__luma.delay("load_revision", 1200));
  await rows.nth(n - 1).click({ noWaitAfter: true });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const b = document.querySelector<HTMLButtonElement>("[data-new-document] button")!;
    b.disabled = false;
    b.click();
  });

  await expect
    .poll(() => page.evaluate(() => window.__luma.done("load_revision")), {
      timeout: 15_000,
    })
    .toBe(1);
  await page.waitForTimeout(600);

  // أيًّا كان الفائز بالسباق، الحالة **متّسقة**: إمّا معاينةٌ قائمة
  // على مستندٍ موجود، وإمّا مساحةٌ نظيفة قابلة للكتابة — لا لقطةٌ
  // قديمة معروضة في مساحةٍ جديدة، ولا لافتةٌ تكذّب حالة المحرر.
  const editable = await page.$eval(EDITOR, (el) => el.getAttribute("contenteditable"));
  const shown = await editorText(page);
  const st = await dump(page);

  expect(st.docs.length, "لا مستند وُلد من الخلط").toBe(1);
  if (editable === "true") {
    expect(shown, "محررٌ قابل للكتابة ⇒ مساحةٌ نظيفة لا لقطة").toBe("");
  } else {
    expect(shown, "محررٌ للقراءة ⇒ معاينةٌ حقيقية").not.toBe("");
  }

  // وأول حرف بعدها لا يكتب فوق المستند القديم
  if (editable === "true") {
    await page.locator(EDITOR).click();
    await page.keyboard.type("سطرٌ في المساحة الجديدة.", { delay: 0 });
    await expect
      .poll(async () => (await dump(page)).docs.length, { message: "مستندٌ ثانٍ حقيقي" })
      .toBe(2);
    expect(
      (await dump(page)).docs.find((d) => d.id === id)!.text,
      "والقديم لم يُمسّ",
    ).toContain("فقرةٌ رقم 2");
  }
});

test("«نصّ جديد» أثناء فتح مسودة لا يُنتج مستندًا هجينًا", async ({ page }) => {
  await open(page, {
    seed: [{ id: "draft", text: "مسودةٌ في المكتبة فيها كلماتٌ كافية." }],
  });
  await page.locator(EDITOR).click();
  await typeParagraph(page, "نصٌّ حاضرٌ قبل الفتح.", { newGroup: false });
  const mine = await currentDocId(page, ["draft"]);

  await page.evaluate(() => window.__luma.delay("load_document", 900));
  await page.click('[data-surface="library"] button');
  await page.click('[data-document-row="draft"]', { noWaitAfter: true });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const b = document.querySelector<HTMLButtonElement>("[data-new-document] button")!;
    b.disabled = false;
    b.click();
  });

  await expect
    .poll(() => page.evaluate(() => window.__luma.done("load_document")), {
      timeout: 15_000,
    })
    .toBe(1);
  await page.waitForTimeout(600);

  const st = await dump(page);
  expect(st.docs.length, "لا مستند ثالث").toBe(2);
  expect(st.docs.find((d) => d.id === "draft")!.text, "المسودة كما هي").toBe(
    "مسودةٌ في المكتبة فيها كلماتٌ كافية.",
  );
  expect(st.docs.find((d) => d.id === mine)!.text, "ونصّي كما هو").toContain(
    "نصٌّ حاضرٌ قبل الفتح.",
  );
});
