import { test, expect, type Page } from "@playwright/test";
import { HAS_REAL_HIT_BOX_SRC } from "../hit-target";
import {
  EDITOR,
  LIBRARY,
  UNDO,
  editorText,
  historyButtons,
  open,
  openTrashSection,
  waitSaved,
} from "./helpers";

/**
 * الوصول وحرّاس الواجهة على الجسر — المرحلة ٧.
 *
 * أربعة بنود من `docs/audit/AUDIT-2026-08-27.md` تحتاج مسارَ تخزينٍ
 * حقيقيًّا (مستندًا قائمًا، سلّةً مبذورة) أو محرّك WebKit الحقيقي —
 * فمكانها هنا لا `tests/e2e/access.spec.ts` العاري من الجسر.
 *
 * **عمدًا على WebKit لا Chromium**: هو محرّك المشروع الأقرب إلى
 * نافذة العرض الفعلية، وفيه أُعيد إنتاج عطل أ/٧ تحديدًا — الشرح في
 * `playwright.config.ts`.
 */

/**
 * أركان صندوق ٣٢×٣٢ حول مركز كل عنصر تطابقه `selector` تصل إليه فعلًا
 * — منطق الأركان في `../hit-target.ts` (مشترك مع `tests/e2e/access.spec.ts`).
 * مصدر الدالّة نصًّا يعبر إلى المتصفح كوسيطٍ قابلٍ للتسلسل، ويُعاد
 * بناؤه هناك — لا استيراد مباشر: الاستيراد لا يعبر إلى صندوق التشغيل.
 */
async function hitTargetViolations(page: Page, selector: string): Promise<string[]> {
  return page.evaluate(
    ({ sel, fnSrc }) => {
      // eslint-disable-next-line no-new-func -- إعادة بناء دالّة مشتركة من مصدرها، لا كودًا خارجيًا
      const hasRealHitBox = new Function(`return (${fnSrc});`)() as (
        el: Element,
        rect: { left: number; top: number; width: number; height: number },
      ) => boolean;
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        if (el.closest("[inert]")) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue; // غير مرسوم أصلًا
        if (!hasRealHitBox(el, r)) {
          const n = (el.getAttribute("aria-label") || el.textContent || "").trim();
          out.push(`«${n.slice(0, 24)}» ${Math.round(r.width)}×${Math.round(r.height)}`);
        }
      }
      return out;
    },
    { sel: selector, fnSrc: HAS_REAL_HIT_BOX_SRC },
  );
}

/** يقرأ التفضيلات كما حُفظت فعلًا عبر `save_preferences` — لا افتراضًا. */
function savedPreferences(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() =>
    (
      window as unknown as {
        __TAURI_INTERNALS__: { invoke: (c: string) => Promise<Record<string, unknown>> };
      }
    ).__TAURI_INTERNALS__.invoke("load_preferences"),
  );
}

const ORIGINAL = "نصٌّ أصليٌّ موجود من قبل، كُتب في جلسةٍ سابقة.";
const ADDED = " وأضفتُ إليه الآن جملةً واحدة متّصلة.";

/**
 * أ/٧: تراجعٌ يُفرغ المكدّس فيعطَّل الزرّ تحت المؤشر — نقرةٌ واحدة
 * تُنفّذ التراجع **وتُعطّل الزرّ نفسه** في اللحظة ذاتها. `mousedown`
 * الملغى يمنع سرقة التركيز أولًا (`SurfacesBar.svelte`)، و`returnCaret()`
 * حاجزٌ ثانٍ (`App.svelte`) يمسك ما يفلت من الأول. بلا الحاجزين:
 * تراجعٌ صحيح ثم أول حرف يُدسّ في رأس المستند — `docs/decisions/
 * 0017-clean-start-and-deletion.md:88`.
 */
test("زرّ التراجع لا يسرق المؤشر عند تعطّله تحت النقرة — أ/٧", async ({ page }) => {
  await open(page, { seed: [{ id: "d1", text: ORIGINAL, updatedAt: Date.now() - 60_000 }] });

  await page.click(LIBRARY);
  await page.click('[data-document-row="d1"]');
  await expect.poll(() => editorText(page)).toContain(ORIGINAL);

  await page.locator(EDITOR).click();
  await page.keyboard.press("End");
  await page.keyboard.type(ADDED, { delay: 0 });
  await waitSaved(page, ADDED.trim());

  // خطوة تراجعٍ واحدة فقط: النقرة القادمة تُفرغ المكدّس فتُعطِّل الزرّ
  await expect
    .poll(() => historyButtons(page), { message: "خطوة تراجعٍ واحدة متوقَّعة" })
    .toEqual({ undo: true, redo: false });

  await page.locator(UNDO).click();
  await expect
    .poll(() => historyButtons(page), { message: "التراجع أفرغ المكدّس فأعاد إضاءة الإعادة" })
    .toEqual({ undo: false, redo: true });

  const stillEditor = await page.evaluate(() =>
    document.activeElement?.classList.contains("luma-editor"),
  );
  expect(stillEditor, "التركيز لم يعد إلى النص بعد أن تعطَّل الزرّ تحته").toBe(true);

  await page.keyboard.type("چ", { delay: 0 });
  const text = await editorText(page);
  expect(text.startsWith("چ"), "الحرف وقع في رأس المستند — المؤشر سقط إلى البداية").toBe(
    false,
  );
  expect(text.endsWith("چ"), "الحرف لم يقع عند موضع المؤشر الحقيقي").toBe(true);
});

/**
 * أ/١١: شاشة الإعدادات تصير `inert` فعليًّا تحت ورقة الخط — لا وثيقةً
 * تَعِد به. تكملها `keyboard.spec.ts` بمسار Tab الذي لا يصل خلفها.
 */
test("ورقة الخط: شاشة الإعدادات تحتها inert خاصّيةً حقيقية — أ/١١", async ({ page }) => {
  await open(page, { stage: "fonts" });
  await expect(page.locator("[data-font-sheet]")).toBeVisible();

  const settingsInert = await page.evaluate(
    () => (document.querySelector("[data-settings]") as HTMLElement | null)?.inert,
  );
  expect(settingsInert, "شاشة الإعدادات ليست inert تحت ورقة الخط").toBe(true);
});

/**
 * ب/٥: `.luma-hit` على صفحات فيها فعلًا — تبويبات ورقة الخط وأزرار
 * `sm` في السلّة. القياس بأركان صندوق ٣٢ لا بادّعاء `Math.max` ميت.
 */
test("تبويبات ورقة الخط: صندوق الالتقاط ٣٢×٣٢ فعليًا — ب/٥", async ({ page }) => {
  await open(page, { stage: "fonts" });
  await expect(page.locator("[data-font-sheet]")).toBeVisible();
  const small = await hitTargetViolations(page, ".luma-hit");
  expect(small, "هدف .luma-hit دون ٣٢×٣٢ فعليًا في ورقة الخط").toEqual([]);
});

test("أزرار السلّة الصغيرة: صندوق الالتقاط ٣٢×٣٢ فعليًا — ب/٥", async ({ page }) => {
  await open(page, {
    seedTrashed: [{ id: "t1", text: "مستندٌ محذوف فيه نصٌّ عربي كافٍ للعرض في الصف." }],
  });
  await openTrashSection(page);
  await expect(page.locator("[data-trash-row]")).toHaveCount(1);
  const small = await hitTargetViolations(page, ".luma-hit");
  expect(small, "هدف .luma-hit دون ٣٢×٣٢ فعليًا في السلّة").toEqual([]);
});

/**
 * ب/٢٤: تحريكٌ حقيقي لمنزلق ومفتاح — لا ضبط `--luma-editor-size` يدًا
 * كما في `tests/e2e/settings.spec.ts`. السلسلة الكاملة: مفتاح لوحة
 * على العنصر المرسوم ← `onchange` ← `setPref` ← `save_preferences`.
 */
test("منزلق حجم النص: تحريكٌ حقيقي يصل save_preferences — ب/٢٤", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__luma.emit("luma://menu", "settings"));
  await page.waitForSelector("[data-section]");
  await page.click('[data-section="writing"] button');

  const slider = page.locator('input[type="range"][aria-label="حجم النص"]');
  await slider.focus();
  await page.keyboard.press("Home"); // أدنى القيمة — ١٤، والافتراضي ١٩
  await expect.poll(() => slider.inputValue()).toBe("14");

  await expect
    .poll(async () => (await savedPreferences(page))["fontSize"], {
      message: "قيمة المنزلق لم تصل save_preferences",
    })
    .toBe(14);
});

test("مفتاح عدّاد الكلمات: تحريكٌ حقيقي يصل save_preferences — ب/٢٤", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__luma.emit("luma://menu", "settings"));
  await page.waitForSelector("[data-section]");
  await page.click('[data-section="writing"] button');

  const before = (await savedPreferences(page))["showWordCount"];
  // العنصر القابل للنقر فعليًا هو اللافتة المرئية — الحقل الأصلي نفسه
  // ٠×٠ بقصد (`Toggle.svelte`)، وتفويض النقر إليه سلوك المتصفح الحقيقي.
  const toggle = page.locator('label.wrap:has(input[aria-label="إظهار عدّاد الكلمات"])');
  await toggle.click();

  await expect
    .poll(async () => (await savedPreferences(page))["showWordCount"], {
      message: "قيمة المفتاح لم تصل save_preferences",
    })
    .toBe(!before);
});
