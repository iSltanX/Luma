import { test, expect } from "@playwright/test";
import { EDITOR, LIBRARY, dump, editorText, open } from "./helpers";

/**
 * الإقلاع النظيف — ADR ٠٠١٧ و`Luma.md` §٤ **ثابت**، والبند ب/١١.
 *
 * «كل تشغيل يفتح مساحة كتابة نظيفة، مهما كان آخر مستند… وما كُتب
 * محفوظ في المكتبة ولا يُفتح إلا بيد الكاتب.»
 *
 * الحارس القائم (`tests/session.test.ts`) يؤكّد `load` غير مُنادى على
 * `EditorSession` **عاريًا**، وتوثيقه يقول «الضمانة بنيوية: لا سبيل
 * إلى تحميل مستند إلا بمعرّف يُمرَّر صراحةً». وهذا صحيحٌ على الصنف
 * وغير صحيح على المنتج: `App.svelte` يستطيع تمرير معرّف صريح، و
 * `open(id)` هو المسار المشروع — فلا شيء يحمرّ لو استؤنف آخرُ مستند.
 *
 * هنا يُقاس **مسار الإقلاع نفسه**، ومكتبةٌ عامرة تحته.
 */

test("الإقلاع على مكتبة عامرة يفتح مساحةً نظيفة ولا يقرأ مستندًا", async ({
  page,
}) => {
  const now = Date.now();
  await open(page, {
    seed: [
      { id: "old-1", text: "أقدمُ مسودةٍ في المكتبة.", updatedAt: now - 300_000 },
      { id: "old-2", text: "وهذه أحدثُ منها بكثير.", updatedAt: now - 1_000 },
      { id: "old-3", text: "وثالثةٌ بينهما.", updatedAt: now - 60_000 },
    ],
  });

  expect(await editorText(page), "المحرر فارغ رغم ثلاث مسودات").toBe("");

  // **الدعوى الحاسمة**: لا قراءةَ مستندٍ وقعت أصلًا. `list_documents`
  // مسموح (المكتبة تُعدّ عند فتح لوحتها)، أمّا `load_document` فهو
  // فعلُ الاستئناف بعينه.
  expect(
    await page.evaluate(() => window.__luma.calls("load_document")),
    "لم يُقرأ أيُّ مستند عند الإقلاع",
  ).toBe(0);

  // ولا مستند مفتوح: زرّ الحذف خافت لأن `currentId === null`
  await expect(page.locator("[data-delete-document] button")).toBeDisabled();

  // والمكتبة سليمة — الثلاثة كما هي، مرتَّبةً بآخر تعديل
  await page.click(LIBRARY);
  await expect(page.locator("[data-document-row]")).toHaveCount(3);
  const order = await page.$$eval("[data-document-row]", (els) =>
    els.map((e) => (e as HTMLElement).dataset["documentRow"]),
  );
  expect(order, "الترتيب بآخر تعديل تنازليًّا").toEqual(["old-2", "old-3", "old-1"]);

  expect((await dump(page)).docs.length, "ولم يُمَسّ شيء على القرص").toBe(3);
});

test("الكتابة بعد إقلاعٍ نظيف تُنشئ مستندًا جديدًا لا تُلحق بالقديم", async ({
  page,
}) => {
  await open(page, { seed: [{ id: "old-1", text: "مسودةٌ سابقة." }] });

  await page.locator(EDITOR).click();
  await page.keyboard.type("نصٌّ جديد تمامًا.", { delay: 0 });

  await expect
    .poll(async () => (await dump(page)).docs.length, {
      message: "أُنشئ مستندٌ ثانٍ",
    })
    .toBe(2);

  const st = await dump(page);
  expect(st.docs.find((d) => d.id === "old-1")!.text, "والقديم لم يُمسّ").toBe(
    "مسودةٌ سابقة.",
  );
});
