import { test, expect } from "@playwright/test";
import { dump, open, openTrashSection } from "./helpers";
import type { MockDoc } from "./mock-bridge";

/**
 * السلّة — ADR ٠٠١٩، والبند أ/١٤ في `docs/audit/AUDIT-2026-08-27.md`.
 *
 * «**إقصاءٌ متبادَل مع نفسها ومع الإفراغ — لا زرّ معطَّل وحده**»:
 * قاعدةٌ لها **حاجزان مستقلان**، وهذا الملف يقيسهما منفصلين —
 * المرسوم (`disabled`/`aria-busy`) والفعليّ (نداء النواة يقع أو لا).
 * الأول وحده كان مكسورًا حتى S2 (`$state<Set>` لا يوكَّل في Svelte 5)،
 * والثاني صامدًا — فلو قيس أحدهما مكان الآخر لبدا كلاهما سليمًا.
 *
 * ولا حزمةَ قبل الجسر لمست لوحة السلّة أصلًا: `[data-trash-row]` صفرُ
 * نتائج في `tests/` و`e2e/` و`selftest.ts`.
 */

const withRevision = (id: string, text: string): MockDoc => ({
  id,
  text,
  revisions: [
    {
      id: `rev-${id}`,
      documentId: id,
      createdAt: 1,
      source: "automatic",
      wordCount: 3,
      blocks: [{ role: "body", text: "قديم" }],
    },
  ],
});

test("زرّ الإفراغ وصفوف الاستعادة تُخفَت أثناء استعادةٍ جارية", async ({ page }) => {
  await open(page, {
    seedTrashed: [
      withRevision("t1", "نصّ الأول فيه كلماتٌ كافية للبقاء."),
      withRevision("t2", "نصّ الثاني فيه كلماتٌ كافية للبقاء."),
    ],
  });
  await page.evaluate(() => window.__luma.delay("restore_document", 900));
  await openTrashSection(page);

  await expect(page.locator("[data-trash-row]")).toHaveCount(2);
  await expect(page.locator("[data-empty-trash]")).toBeEnabled();

  // نبدأ استعادة ولا ننتظرها — الرحلة ٩٠٠ms، والحالة تُقاس في وسطها
  await page.evaluate(() =>
    document.querySelector<HTMLButtonElement>('[data-trash-row="t1"] button')!.click(),
  );

  // ① الحاجز **المرسوم**
  await expect(
    page.locator("[data-empty-trash]"),
    "زرّ الإفراغ يخفت أثناء استعادة جارية",
  ).toBeDisabled();
  await expect(
    page.locator('[data-trash-row="t1"] button'),
    "وصفّ الاستعادة يعلن انتظاره",
  ).toHaveAttribute("aria-busy", "true");

  // ② الحاجز **الفعليّ**، ويُقاس **مستقلًّا عن الأول**.
  //
  // نرفع `disabled` باليد ثم نضغط: بدون ذلك يحجب الحاجزُ المرسوم
  // الضغطةَ فلا تصل الدالّة أصلًا، فيبدو الحاجزان سليمين وأحدهما
  // مفقود. وهذا هو النداء البرمجيّ الثاني الذي يقول تعليق
  // `restoreFromTrash` صراحةً إنه ما لا يمنعه زرٌّ معطَّل وحده.
  await page.evaluate(() => {
    const b = document.querySelector<HTMLButtonElement>("[data-empty-trash]")!;
    b.disabled = false;
    b.click();
  });

  await expect
    .poll(async () => (await dump(page)).docs.map((d) => d.id), {
      message: "اكتملت الاستعادة",
    })
    .toContain("t1");

  expect(
    await page.evaluate(() => window.__luma.calls("empty_trash")),
    "ولم يصل النواةَ نداءُ إفراغ واحد",
  ).toBe(0);
  expect(
    (await dump(page)).trash.map((d) => d.id),
    "وبقي الثاني في السلّة لم يُفرَغ",
  ).toEqual(["t2"]);
});

test("استعادتان متزامنتان على مستندين — كلٌّ يعود مرة واحدة", async ({ page }) => {
  await open(page, {
    seedTrashed: [
      withRevision("p1", "محتوى الأول — نصٌّ حقيقي فيه كلمات تكفي."),
      withRevision("p2", "محتوى الثاني — نصٌّ حقيقي فيه كلمات تكفي."),
    ],
  });
  await page.evaluate(() => window.__luma.delay("restore_document", 600));
  await openTrashSection(page);

  // **نقرتان في الدورة نفسها** — تشابكٌ حقيقي لا نقرتان متتاليتان.
  // (نقرتا Playwright المتوازيتان تتداخل حركاتُ فأرتهما فلا تقعان.)
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[data-trash-row="p1"] button')!.click();
    document.querySelector<HTMLButtonElement>('[data-trash-row="p2"] button')!.click();
  });

  await expect
    .poll(async () => (await dump(page)).trash.length, {
      message: "السلّة فرغت من الاثنين",
      timeout: 15_000,
    })
    .toBe(0);

  expect((await dump(page)).docs.map((d) => d.id).sort()).toEqual(["p1", "p2"]);
  expect(
    await page.evaluate(() => window.__luma.calls("restore_document")),
    "نداءا استعادة لا أكثر — لا تكرار",
  ).toBe(2);
});

test("نقرتان على صفّ الاستعادة نفسه لا تُنتجان نداءين", async ({ page }) => {
  await open(page, { seedTrashed: [withRevision("d1", "نصٌّ فيه كلماتٌ كافية.")] });
  await page.evaluate(() => window.__luma.delay("restore_document", 700));
  await openTrashSection(page);

  await page.evaluate(() => {
    const b = document.querySelector<HTMLButtonElement>('[data-trash-row="d1"] button')!;
    b.click();
    b.click();
  });

  await expect
    .poll(async () => (await dump(page)).docs.map((d) => d.id), { timeout: 15_000 })
    .toContain("d1");
  expect(
    await page.evaluate(() => window.__luma.calls("restore_document")),
    "الحارس الدالّي (`trashBusyIds.has`) يمنع الثاني",
  ).toBe(1);
});

test("إفراغ السلّة يمحو كل شيء، والصفوف تختفي", async ({ page }) => {
  await open(page, {
    seedTrashed: [
      withRevision("e1", "الأول في السلّة."),
      withRevision("e2", "الثاني في السلّة."),
    ],
  });
  await openTrashSection(page);
  await expect(page.locator("[data-trash-row]")).toHaveCount(2);

  await page.click("[data-empty-trash]");

  await expect(page.locator("[data-trash-row]")).toHaveCount(0);
  const st = await dump(page);
  expect(st.trash).toEqual([]);
  expect(st.docs, "ولم يعد شيء إلى المكتبة").toEqual([]);
  expect(st.revs["e1"], "ومعها سجلّها").toBeUndefined();
});

test("السلّة تُكسح كسلًا عند فتحها — ما تجاوز مهلته يُمحى", async ({ page }) => {
  // «الفحص كسول لا خلفي: عند الإقلاع، وعند فتح لوحة السلّة» — ADR ٠٠١٩.
  await open(page);
  await page.evaluate(() => {
    const day = 24 * 60 * 60 * 1000;
    window.__luma.seedTrashed({ id: "fresh", text: "حُذف اليوم." });
    window.__luma.seedTrashed({ id: "stale", text: "حُذف قبل دهر." });
    // نُقدّم ختم الحذف إلى ما قبل المهلة — أربعون يومًا تتجاوز الثلاثين
    window.__luma.ageTrashed("stale", 40 * day);
  });

  await openTrashSection(page);

  await expect(page.locator("[data-trash-row]")).toHaveCount(1);
  await expect(page.locator('[data-trash-row="fresh"]')).toBeVisible();
  expect(
    (await dump(page)).trash.map((d) => d.id),
    "ما تجاوز المهلة مُحي عند الفتح",
  ).toEqual(["fresh"]);
});
