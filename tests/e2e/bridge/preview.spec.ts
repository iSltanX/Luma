import { test, expect, type Page } from "@playwright/test";
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
  openSettings,
  typeParagraph,
  waitRevisions,
} from "./helpers";

/**
 * المعاينة — القواعد التي لم تكن تصلها حزمة قط.
 *
 * «المعاينة قراءةٌ فقط ولا تمسّ المستند الحالي» — `Luma.md` §٩
 * **ثابت**. البنود المغلَقة هنا: أ/٣ وأ/٤ وأ/٥ وأ/١٣ وب/٦ وب/١٧ في
 * `docs/audit/AUDIT-2026-08-27.md`.
 *
 * قبلها لم تُفتح معاينةٌ واحدة في أي حزمة: e2e بلا جسر فالسجل فارغ
 * أبدًا، والفحص الذاتي يفصل الجلسة ثم ينادي `beginPreview` مباشرةً
 * فلا يمرّ بـ`preview()` ولا `exitPreview()` — وهما موضع كل عطل
 * وموضع كل إصلاح.
 */

/** يكتب فقرتين فيصير في السجل لقطتان متمايزتان، ثم يفتح لوحة السجل. */
async function twoRevisions(page: Page): Promise<{ id: string; live: string }> {
  await page.locator(EDITOR).click();
  await typeParagraph(page, longParagraph(1));
  const id = await currentDocId(page);
  await waitRevisions(page, id, 1);

  await page.keyboard.press("Enter");
  await typeParagraph(page, longParagraph(2), { newGroup: false });
  await waitRevisions(page, id, 2);

  return { id, live: await editorText(page) };
}

/** يفتح السجل ويعاين **أقدم** لقطة — أحدثها تطابق النصّ الحيّ. */
async function previewOldest(page: Page): Promise<string> {
  await page.click(HISTORY);
  const rows = page.locator(HISTORY_ROWS);
  await expect(rows.nth(1)).toBeVisible();
  const n = await rows.count();
  await rows.nth(n - 1).click();
  await expect
    .poll(() => page.$eval(EDITOR, (el) => el.getAttribute("contenteditable")), {
      message: "لم تبدأ المعاينة",
    })
    .toBe("false");
  return editorText(page);
}

// ── أ/٣ ────────────────────────────────────────────────────
test("الحذف مرفوض أثناء المعاينة — البابان بقاعدة واحدة", async ({ page }) => {
  await open(page);
  const { id } = await twoRevisions(page);
  await previewOldest(page);

  // البابُ الأول: الزرّ المرسوم
  expect(await page.locator(DELETE).isDisabled(), "زرّ الحذف معطَّل").toBe(true);

  // **والباب الثاني** — ⌘⌫ وبند «ملف ← حذف النص» لا يمرّان بـ`candelete`
  // أصلًا، فلولا الشرط داخل `deleteDocument` لحُذف مستندٌ والكاتب يقرأ
  // نسخةً قديمة منه: نقيض «لا يُزيل إلا ما يقرؤه الكاتب الآن».
  expect(await menuDelete(page), "للبند مستمع فعلًا").toBe(1);
  await page.waitForTimeout(400);

  const st = await dump(page);
  expect(st.docs.map((d) => d.id), "المستند لم يُحذف").toContain(id);
  expect(st.trash, "ولم يصل السلّة").toEqual([]);
});

// ── أ/٤ (أ) ────────────────────────────────────────────────
test("«نصّ جديد» أثناء معاينة لا يستحضر نصّ المستند القديم", async ({ page }) => {
  await open(page);
  await twoRevisions(page);
  await previewOldest(page);

  // `setBlocks` **يُسقط لقطة المعاينة** مهما كان سببه: `startNew`
  // يستبدل المحتوى ثم يُنهي المعاينة بهذا الترتيب، فلولا الإسقاط
  // لعادت لقطةٌ قديمة فملأت المساحة النظيفة بنصّ مستندٍ غادره الكاتب.
  await page.click(NEWDOC);

  await expect
    .poll(() => editorText(page), { message: "المساحة الجديدة نظيفة" })
    .toBe("");
  expect(
    await page.$eval(EDITOR, (el) => el.getAttribute("contenteditable")),
    "والمحرر قابل للكتابة — لا لافتة معاينة معلّقة",
  ).toBe("true");

  // وتبقى نظيفة: الكتابة فيها تُنشئ مستندًا جديدًا لا تُلحق بالقديم
  await page.locator(EDITOR).click();
  await page.keyboard.type("سطرٌ في المساحة الجديدة.", { delay: 0 });
  await expect
    .poll(() => editorText(page))
    .toBe("سطرٌ في المساحة الجديدة.");
});

// ── أ/٤ (ب) ────────────────────────────────────────────────
test("معاينةٌ ثانية بلا خروج تُبقي الأصل هدفًا للعودة", async ({ page }) => {
  await open(page);
  await page.locator(EDITOR).click();
  await typeParagraph(page, longParagraph(1));
  const id = await currentDocId(page);
  await waitRevisions(page, id, 1);
  await page.keyboard.press("Enter");
  await typeParagraph(page, longParagraph(2));
  await waitRevisions(page, id, 2);
  await page.keyboard.press("Enter");
  await typeParagraph(page, longParagraph(3), { newGroup: false });
  await waitRevisions(page, id, 3);
  const live = await editorText(page);

  await page.click(HISTORY);
  const rows = page.locator(HISTORY_ROWS);
  await expect(rows.nth(1)).toBeVisible();
  const n = await rows.count();
  expect(n, "ثلاث لقطات مع صفّ «الآن»").toBeGreaterThan(3);

  // `nth(1)` أحدثُ لقطة وهي تطابق النصّ الحيّ (حُفظت للتوّ)، فنقصد
  // ما قبلها: لقطتان **مختلفتان** عن الحيّ وعن بعضهما.
  await rows.nth(2).click();
  await expect.poll(() => editorText(page)).not.toBe(live);
  const first = await editorText(page);

  // **لقطةٌ واحدة لا تُستبدل**: معاينةٌ ثانية دون خروج تُبقي الأصل
  // هدفًا للعودة، لا آخرَ ما عُوين. ولولا ذلك لعاد الخروجُ بنسخةٍ
  // قديمة فوق نصّ الكاتب الحيّ، وحفظها أول حرف.
  await rows.nth(n - 1).click();
  await expect.poll(() => editorText(page)).not.toBe(first);

  await rows.nth(0).click(); // «الآن» ⇒ خروج
  await expect
    .poll(() => editorText(page), { message: "العودة إلى النصّ الحيّ لا إلى أول ما عُوين" })
    .toBe(live);

  // والقرص يوافق الشاشة: المعاينة لم تكتب شيئًا
  const st = await dump(page);
  expect(st.docs.find((d) => d.id === id)!.text.replace(/\n/g, " ")).toContain(
    "فقرةٌ رقم 3",
  );
});

// ── أ/٥ ────────────────────────────────────────────────────
test("مغادرة السجل تنهي المعاينة — بأي طريق غودرت", async ({ page }) => {
  await open(page);
  const { live } = await twoRevisions(page);

  /** يؤكّد أن لا معاينة معلّقة: النصّ الحيّ، ومحررٌ يقبل الكتابة. */
  const expectNoPreview = async (label: string) => {
    await expect
      .poll(() => page.$eval(EDITOR, (el) => el.getAttribute("contenteditable")), {
        message: `${label}: المحرر لم يعد قابلًا للكتابة`,
      })
      .toBe("true");
    expect(await editorText(page), `${label}: النصّ الحيّ عاد`).toBe(live);
    await expect(page.locator("[data-preview-banner]")).toHaveCount(0);
  };

  // (١) إغلاق اللوحة من مدخلها
  await previewOldest(page);
  await page.click(HISTORY);
  await expectNoPreview("إغلاق اللوحة");

  // (٢) الانتقال إلى لوحة أخرى
  await previewOldest(page);
  await page.click(LIBRARY);
  await expect(page.locator('[data-panel="library"]')).toBeVisible();
  await expectNoPreview("الانتقال إلى المكتبة");
  await page.click(LIBRARY);

  // (٣) **شاشة الإعدادات** — `closeSettings` تتّكل على هذا صراحةً:
  // تعيد `setEditable(true)` بلا شرط، فمعاينةٌ نجت من فتح الإعدادات
  // تخرج منها بمحررٍ قابل للكتابة و`previewId` مضبوط ولافتة «للقراءة
  // فقط» معلّقة — وأول حرف يحفظ نسخةً قديمة فوق المستند الحيّ.
  await previewOldest(page);
  await openSettings(page);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-section]")).toHaveCount(0);
  await expectNoPreview("الإعدادات");

  // والكتابة تعمل فعلًا بعدها — الدعوى النهائية
  await page.locator(EDITOR).click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type(" ذيل.", { delay: 0 });
  await expect.poll(() => editorText(page)).toContain("ذيل.");
});

// ── أ/١٣ ───────────────────────────────────────────────────
test("مؤشر الحفظ يختفي أثناء المعاينة ويعود بعدها", async ({ page }) => {
  await open(page);
  await twoRevisions(page);

  await expect(page.locator(".save"), "المؤشر ظاهر على المستند الحيّ").toHaveCount(1);

  await previewOldest(page);
  // «أثناء المعاينة يدخل المستند وضع قراءة فقط **ويختفي مؤشر الحفظ**»
  // — بقاؤه يَعِد الكاتب بأن ما يقرؤه هو ما على القرص، وهو ليس كذلك.
  await expect(page.locator(".save"), "ويختفي في المعاينة").toHaveCount(0);

  await page.locator(HISTORY_ROWS).nth(0).click();
  await expect(page.locator(".save"), "ويعود بعد الخروج").toHaveCount(1);
});

// ── ب/٦ ────────────────────────────────────────────────────
test("المعاينة تحفظ مكدّس التراجع — عبر مسار المنتج لا نداء النواة", async ({
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

  const live = await editorText(page);
  const before = await historyButtons(page);
  expect(before.undo, "المكدّس عامر قبل المعاينة").toBe(true);

  await previewOldest(page);
  await page.locator(HISTORY_ROWS).nth(0).click();
  await expect.poll(() => editorText(page)).toBe(live);

  // **`beginPreview` لا `setBlocks`**: الثاني يبني حالة ProseMirror
  // جديدة فيمسح السجل — دخولًا وخروجًا — فيعود الكاتب من معاينةٍ لم
  // يكتب فيها حرفًا وقد ذهب تراجعه. مسٌّ بالمستند وإن لم يتغيّر نصّه.
  expect(
    (await historyButtons(page)).undo,
    "التراجع ما زال مضيئًا بعد المعاينة",
  ).toBe(true);

  await page.locator(EDITOR).click();
  await page.keyboard.press("Meta+z");
  await expect
    .poll(() => editorText(page), { message: "والتراجع يعمل فعلًا لا يضيء وحسب" })
    .not.toBe(live);
  await expect.poll(() => editorText(page)).not.toContain("فقرةٌ رقم 2");
});

// ── ب/١٧ ───────────────────────────────────────────────────
test("لقطة تالفة: خطأ ظاهر، والمستند الحالي لا يُمسّ", async ({ page }) => {
  await open(page);
  const { live } = await twoRevisions(page);

  await page.evaluate(() =>
    window.__luma.fail("load_revision", "ملف غير قابل للقراءة"),
  );
  await page.click(HISTORY);
  const rows = page.locator(HISTORY_ROWS);
  await expect(rows.nth(1)).toBeVisible();
  await rows.nth(1).click();

  // «تعذُّر قراءة لقطة قديمة **يُظهر خطأ** محصورًا في تلك اللقطة»
  // — كان المسار ينتهي عند `console.error` وحده: المستخدم يضغط ويرى
  // شيئًا لم يحدث بلا سبب معلن.
  await expect(page.locator('[role="alert"]'), "الخطأ ظاهر للكاتب").toBeVisible();
  await expect(page.locator('[role="alert"]')).toContainText("تعذّرت قراءة هذه النسخة");

  expect(await editorText(page), "النصّ لم يُمسّ").toBe(live);
  expect(
    await page.$eval(EDITOR, (el) => el.getAttribute("contenteditable")),
    "وعاد الإدخال — لم تبدأ معاينة",
  ).toBe("true");

  // والكتابة تعمل بعد الفشل
  await page.evaluate(() => window.__luma.clearFailures());
  await page.locator(EDITOR).click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type(" وحرفٌ بعد الفشل.", { delay: 0 });
  await expect.poll(() => editorText(page)).toContain("وحرفٌ بعد الفشل");
});
