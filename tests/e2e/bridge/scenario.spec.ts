import { test, expect } from "@playwright/test";
import {
  DELETE,
  EDITOR,
  HISTORY,
  HISTORY_ROWS,
  LIBRARY,
  NEWDOC,
  currentDocId,
  dump,
  editorText,
  historyButtons,
  longParagraph,
  menuDelete,
  open,
  openTrashSection,
  typeParagraph,
  waitRevisions,
} from "./helpers";

/**
 * السيناريو المتسلسل — جلسةٌ واحدة متصلة كما يعيشها كاتب.
 *
 * **لا إعادة تحميل بين الخطوات ولا تصفير للمكتبة**: كل خطوة ترث حالة
 * ما قبلها، فتُكشف الأعطال التي لا تظهر إلا في التتابع — نصٌّ معلَّق
 * لحظة المغادرة، ومكدّسٌ يعبر معاينة، ومستندٌ يعود من السلّة.
 *
 * ويتحقق من الشاشة و«القرص» معًا: تطابقُهما هو الدعوى، لا أحدهما.
 */

const S1 = "الكتابة في الصباح تصفو، والجملة الأولى هي أثقل ما في النهار كله.";
const S2 = "ثم تأتي الجملة الثانية أخفّ من أختها، وقد فُتح الطريق أمامها فعلًا.";
const S3 = "والثالثة تجري بلا مقاومة، إذ صار للنص إيقاعٌ يسحب ما بعده إليه.";
const S4 = "وأضفتُ سطرًا رابعًا بعد أن عدتُ إلى المستند من جديد، فاتصل الكلام.";
const RACE = " وهذه جملةٌ كُتبت قبل الانتقال بلحظة.";

const OTHER = "مسودةٌ قديمة كانت تنتظر في المكتبة منذ أمس، ولها سطرٌ واحد فقط.";

test("السيناريو المتسلسل الكامل", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push("console: " + m.text());
  });

  await open(page, {
    seed: [
      { id: "doc-B", text: OTHER, updatedAt: Date.now() - 60_000 },
      // مستند فارغ تمامًا بلا لقطة — للخطوة التاسعة
      {
        id: "doc-EMPTY",
        blocks: [{ role: "body", text: "" }],
        updatedAt: Date.now() - 120_000,
      },
    ],
  });

  // ══ ١ · مستند جديد وعدة جمل ═════════════════════════════
  await page.locator(EDITOR).click();
  await typeParagraph(page, S1);
  await page.keyboard.press("Enter");
  await typeParagraph(page, S2);
  await page.keyboard.press("Enter");
  await typeParagraph(page, S3);

  expect(await editorText(page)).toBe([S1, S2, S3].join("\n"));
  const AID = await currentDocId(page, ["doc-B", "doc-EMPTY"]);
  expect(AID, "أُنشئ مستند على القرص عند أول محتوى").toBeTruthy();

  // ══ ٢ · تراجع خطوتين ثم إعادة خطوة ═══════════════════════
  expect((await historyButtons(page)).undo, "التراجع مضيء بعد الكتابة").toBe(true);
  expect((await historyButtons(page)).redo, "الإعادة خافتة قبل أي تراجع").toBe(false);

  await page.keyboard.press("Meta+z");
  await expect.poll(() => editorText(page)).toBe([S1, S2].join("\n"));

  await page.keyboard.press("Meta+z");
  await expect.poll(() => editorText(page)).toBe(S1);

  expect((await historyButtons(page)).redo, "الإعادة أضاءت بعد التراجع").toBe(true);

  await page.keyboard.press("Meta+Shift+z");
  await expect
    .poll(() => editorText(page), { message: "الإعادة تعيد الجملة الثانية وحدها" })
    .toBe([S1, S2].join("\n"));

  // ══ ٣ · فتح مستند آخر ونصٌّ لم يصل القرص بعد ══════════════
  await page.click(LIBRARY);
  await expect(page.locator('[data-panel="library"]')).toBeVisible();
  await expect(page.locator('[data-document-row="doc-B"]')).toBeVisible();

  await page.locator(EDITOR).click();
  await page.keyboard.press("End");
  await page.keyboard.type(RACE, { delay: 0 });

  // **بلا انتظار**: النقر يقع داخل نافذة `DEBOUNCE_MS`، فالنصّ لم يصل
  const savedBefore = (await dump(page)).docs.find((d) => d.id === AID)!.text;
  expect(savedBefore, "النصّ فعلًا لم يكن قد وصل القرص لحظة النقر").not.toContain(
    RACE.trim(),
  );

  await page.click('[data-document-row="doc-B"]');
  await expect
    .poll(() => editorText(page), { message: "المحرر يعرض المستند الآخر" })
    .toContain("مسودةٌ قديمة");

  const afterSwitch = (await dump(page)).docs.find((d) => d.id === AID)!;
  expect(
    afterSwitch.text,
    "الانتقال حفظ ما لم يصل القرص قبل أن يستبدل — لا فقد",
  ).toContain(RACE.trim());
  expect(
    (await historyButtons(page)).undo,
    "مكدّس التراجع صفر بعد فتح مستند آخر",
  ).toBe(false);
  expect((await historyButtons(page)).redo).toBe(false);

  // ══ ٤ · العودة إلى الأول والكتابة فيه ════════════════════
  await page.click(`[data-document-row="${AID}"]`);
  await expect
    .poll(() => editorText(page), { message: "عاد المستند الأول بنصّه كاملًا" })
    .toContain(RACE.trim());

  await page.locator(EDITOR).click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.press("Enter");
  await typeParagraph(page, S4, { newGroup: false });
  const beforePreview = await editorText(page);
  expect(beforePreview).toContain(S4);

  // ══ ٥ · معاينة نسخة قديمة، الخروج، ثم ⌘Z ═════════════════
  await page.click(LIBRARY); // إغلاق المكتبة
  await waitRevisions(page, AID, 2);
  await page.click(HISTORY);
  await expect(page.locator('[data-panel="history"]')).toBeVisible();

  const rows = page.locator(HISTORY_ROWS);
  const rowCount = await rows.count();
  expect(rowCount, "صفّ «الآن» ولقطتان على الأقل").toBeGreaterThan(2);

  // أقدم لقطة — أحدثها تطابق النصّ الحالي لأنها حُفظت للتوّ
  await rows.nth(rowCount - 1).click();
  await expect
    .poll(() => page.$eval(EDITOR, (el) => el.getAttribute("contenteditable")), {
      message: "المعاينة قراءةٌ فقط",
    })
    .toBe("false");

  const previewText = await editorText(page);
  expect(previewText, "المعاينة تعرض نصًّا أقدم لا الحالي").not.toBe(beforePreview);
  expect((await historyButtons(page)).undo, "التراجع خافت أثناء المعاينة").toBe(false);

  await rows.nth(0).click(); // «الآن — النسخة الحالية» ⇒ خروج
  await expect
    .poll(() => editorText(page), { message: "الخروج يعيد النص الحالي" })
    .toBe(beforePreview);

  await page.locator(EDITOR).click();
  await page.keyboard.press("Meta+z");
  await expect
    .poll(() => editorText(page), {
      message: "⌘Z بعد المعاينة يتراجع عمّا قبلها — المكدّس نجا",
    })
    .not.toContain(S4);

  await page.keyboard.press("Meta+Shift+z"); // نعيدها كي يبقى النص كاملًا
  await expect.poll(() => editorText(page)).toBe(beforePreview);

  // ══ ٦ · ⌘⌫ ⇒ السلّة لا المحو ══════════════════════════════
  await page.click(HISTORY); // إغلاق السجل
  expect(await menuDelete(page), "بند «حذف النص» له مستمع").toBe(1);

  await expect
    .poll(async () => (await dump(page)).trash.map((d) => d.id), {
      message: "وصل السلّة لا العدم",
    })
    .toContain(AID);
  const after6 = await dump(page);
  expect(after6.docs.find((d) => d.id === AID), "خرج من المكتبة").toBeFalsy();
  expect(await editorText(page), "وبقيت مساحةٌ نظيفة").toBe("");

  // ══ ٧ · لوحة السلّة والاستعادة ════════════════════════════
  await openTrashSection(page);
  await expect(page.locator(`[data-trash-row="${AID}"]`)).toBeVisible();
  await page.click(`[data-trash-row="${AID}"] button`);

  await expect
    .poll(async () => (await dump(page)).docs.map((d) => d.id), {
      message: "عاد إلى المكتبة",
    })
    .toContain(AID);
  expect((await dump(page)).trash.find((d) => d.id === AID), "غادر السلّة").toBeFalsy();

  await page.keyboard.press("Escape"); // إغلاق الإعدادات
  await expect(page.locator("[data-section]")).toHaveCount(0);

  const afterRestore = await historyButtons(page);
  expect(afterRestore.undo, "التراجع صفر بعد الاستعادة").toBe(false);
  expect(afterRestore.redo, "والإعادة صفر كذلك").toBe(false);

  // ══ ٩ · مستند فارغ تمامًا: يُمحى ولا يذهب للسلّة ═══════════
  await page.click(LIBRARY);
  await page.click('[data-document-row="doc-EMPTY"]');
  await expect
    .poll(() => editorText(page), { message: "المستند الفارغ فُتح فارغًا" })
    .toBe("");

  await page.click(NEWDOC); // مغادرته بلا أن يُكتب فيه حرف
  await expect
    .poll(async () => (await dump(page)).docs.map((d) => d.id), {
      message: "خرج من المكتبة",
    })
    .not.toContain("doc-EMPTY");
  expect(
    (await dump(page)).trash.find((d) => d.id === "doc-EMPTY"),
    "ولم يذهب إلى السلّة — مُحي مباشرة",
  ).toBeFalsy();

  expect(consoleErrors, "لا أخطاء في وحدة التحكم طوال السيناريو").toEqual([]);
});

test("مستند مُحي نصّه بالكامل يذهب إلى السلّة لا إلى العدم", async ({ page }) => {
  await open(page);
  await page.locator(EDITOR).click();
  await typeParagraph(page, longParagraph(1), { newGroup: false });

  const id = await currentDocId(page);
  await waitRevisions(page, id, 1);

  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await expect.poll(() => editorText(page)).toBe("");

  await page.click(NEWDOC); // مغادرة ⇒ `discardIfEmpty`
  await expect
    .poll(async () => (await dump(page)).trash.map((d) => d.id), {
      message: "له سجلٌّ فلا يُمحى — التدارك ممكن",
    })
    .toContain(id);
  expect((await dump(page)).docs.find((d) => d.id === id)).toBeFalsy();
});

test("زرّ الحذف معطَّل على مساحة فارغة، ومفعَّل على مستند", async ({ page }) => {
  await open(page);
  expect(await page.locator(DELETE).isDisabled(), "لا شيء يُحذف بعد").toBe(true);

  await page.locator(EDITOR).click();
  await typeParagraph(page, "نصٌّ فيه كلماتٌ كافية.", { newGroup: false });
  await currentDocId(page);

  await expect(page.locator(DELETE)).toBeEnabled();
  await page.click(DELETE);
  await expect.poll(() => editorText(page)).toBe("");
  await expect(page.locator(DELETE)).toBeDisabled();

  // زرّ الحذف والبند يسلكان المسار نفسه: كلاهما إلى السلّة
  await expect.poll(async () => (await dump(page)).trash.length).toBe(1);
});
