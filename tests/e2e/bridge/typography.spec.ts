import { test, expect, type Page } from "@playwright/test";
import {
  EDITOR,
  HISTORY,
  LIBRARY,
  currentDocId,
  longParagraph,
  open,
  openSettings,
  openTrashSection,
  typeParagraph,
  waitRevisions,
} from "./helpers";

/**
 * قواعد الطباعة العربية **على الشاشات المشحونة كلها** — بندا ب/٤ وب/١٣.
 *
 * الفحص القائم يمسح `document.querySelectorAll("*")` بحثًا عن نصٍّ
 * عربي دون ١٢ نقطة — لكنه يجري داخل الفحص الذاتي وشاشةُ المحرر وحدها
 * مركَّبة عندها. فورقة الخط وشاشة الإعدادات ولوحاتُ المكتبة والسجل
 * والسلّة **لم تُمسح قط**، و`docs/arabic-battery.md` كان يعلن «صفر
 * مخالفات» بناءً على ذلك المسح الناقص.
 *
 * وهناك كان الخرق: `FontSheet.svelte` يرسم عيّنة عربية مشكَّلة بـ
 * `calc(--luma-editor-size * 0.8)` — وأصغرُ مقاسٍ ممكن ١٤px، فالحاصل
 * ١١٫٢px. أُصلح في S2 بـ`max(12px, …)`، وهذا ما يحرسه.
 *
 * والتتبّع يُقاس هنا **محوسبًا** لا نصًّا: `tests/tokens.test.ts` يقرأ
 * المصدر، وهذا يقرأ ما رسمه المتصفح فعلًا بعد الوراثة والتتالي.
 */

/** أصغر مقاس نصّ عربي مرسوم، مع اسم مخالفٍ إن وُجد. */
async function arabicViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
      // العنصر الورقيّ وحده: نصّ الأب يظهر في `textContent` أبنائه
      if (el.children.length > 0) continue;
      const text = el.textContent?.trim() ?? "";
      if (!/[؀-ۿ]/.test(text)) continue;
      // ما لا يُرسم لا يُقاس
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (!el.getClientRects().length) continue;

      const size = parseFloat(cs.fontSize);
      if (size < 12) {
        out.push(`${el.tagName}.${el.className || "—"} = ${size}px «${text.slice(0, 24)}»`);
      }
    }
    return out;
  });
}

/** كل نصّ عربي مرسوم بتتبّعٍ غير صفر. */
async function trackingViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
      if (el.children.length > 0) continue;
      const text = el.textContent?.trim() ?? "";
      if (!/[؀-ۿ]/.test(text)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (!el.getClientRects().length) continue;

      const ls = cs.letterSpacing;
      if (ls === "normal" || parseFloat(ls) === 0) continue;
      out.push(`${el.tagName}.${el.className || "—"} = ${ls}`);
    }
    return out;
  });
}

/** يفحص الشاشة الحالية بالقاعدتين معًا. */
async function expectTypographyClean(page: Page, where: string): Promise<void> {
  expect(await arabicViolations(page), `${where}: نصٌّ عربي دون ١٢ نقطة`).toEqual([]);
  expect(await trackingViolations(page), `${where}: تتبّعٌ غير صفر`).toEqual([]);
}

test("المحرر واللوحات: لا نص عربي دون ١٢ نقطة ولا تتبّع", async ({ page }) => {
  await open(page, {
    seed: [{ id: "d1", text: "مسودةٌ في المكتبة فيها كلماتٌ كافية للعرض." }],
  });

  await expectTypographyClean(page, "المحرر الفارغ");

  await page.locator(EDITOR).click();
  await typeParagraph(page, longParagraph(1), { newGroup: false });
  const id = await currentDocId(page, ["d1"]);
  await expectTypographyClean(page, "المحرر بنصّ");

  await page.click(LIBRARY);
  await expect(page.locator('[data-panel="library"]')).toBeVisible();
  await expectTypographyClean(page, "لوحة المكتبة");
  await page.click(LIBRARY);

  await waitRevisions(page, id, 1);
  await page.click(HISTORY);
  await expect(page.locator('[data-panel="history"]')).toBeVisible();
  await expectTypographyClean(page, "لوحة السجل");
  await page.click(HISTORY);
});

test("شاشة الإعدادات بأقسامها الستة", async ({ page }) => {
  await open(page);
  await openSettings(page);

  const sections = await page.$$eval("[data-section]", (els) =>
    els.map((e) => (e as HTMLElement).dataset["section"]!),
  );
  expect(sections.length, "الأقسام الستة").toBe(6);

  for (const id of sections) {
    await page.click(`[data-section="${id}"] button`);
    await expectTypographyClean(page, `الإعدادات — ${id}`);
  }
});

test("قسم السلّة وصفوفه", async ({ page }) => {
  await open(page, {
    seedTrashed: [
      { id: "t1", text: "مستندٌ محذوف فيه نصٌّ عربي كافٍ للعرض في الصف." },
    ],
  });
  await openTrashSection(page);
  await expect(page.locator("[data-trash-row]")).toHaveCount(1);
  await expectTypographyClean(page, "لوحة السلّة");
});

/**
 * **ورقة الخط — موضع الخرق الذي أصلحته S2.**
 *
 * لا مدخل لها في وضع الويب إلا `demo_stage: "fonts"`، وهو ما يفتحه
 * الجسر. وعيّنتها الصغرى تُرسم بـ٪٨٠ من مقاس المستخدم، فتُفحص عند
 * **أصغر مقاس ممكن** (١٤px) — وهناك وحده يظهر الخرق: ١٤ × ٠٫٨ = ١١٫٢.
 */
test("ورقة الخط عند أصغر مقاس ممكن — موضع خرق خ‑١", async ({ page }) => {
  await open(page, { stage: "fonts" });
  await expect(page.locator("[data-font-sheet], .sheet, [aria-modal]").first()).toBeVisible();

  // نهبط بمقاس المحرر إلى حدّه الأدنى: العيّنة الصغرى تتبعه بـ٪٨٠
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--luma-editor-size", "14px");
  });

  const sample = page.locator(".sample.small");
  await expect(sample, "عيّنة ٪٨٠ مرسومة").toHaveCount(1);
  const size = await sample.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size, "٪٨٠ من ١٤px = ١١٫٢ — والأرضية تمنعها").toBeGreaterThanOrEqual(12);

  await expectTypographyClean(page, "ورقة الخط عند ١٤px");
});
