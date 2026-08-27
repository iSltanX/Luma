/**
 * مساعدات حزمة الجسر — **استقصاءُ حالةٍ حقيقية لا مهلٌ ثابتة**.
 *
 * المهلة الثابتة تجعل الاختبار يقيس سرعة الآلة: حزمةٌ خضراء وحدها
 * تحمرّ حين تُشغَّل مع غيرها. كل انتظارٍ هنا يسأل «القرص» المقلَّد أو
 * الشاشة عن الحالة التي ينتظرها، ويسقط برسالةٍ تقول ما لم يقع.
 */

import { expect, type Page } from "@playwright/test";
import { installBridge, type MockDoc, type MockDump } from "./mock-bridge";

export const EDITOR = ".luma-editor";
export const LIBRARY = '[data-surface="library"] button';
export const HISTORY = '[data-surface="history"] button';
export const NEWDOC = "[data-new-document] button";
export const DELETE = "[data-delete-document] button";
export const UNDO = "[data-undo] button";
export const REDO = "[data-redo] button";
export const HISTORY_ROWS = '[data-panel="history"] li button';

/** أطول من `UNDO_GROUP_DELAY_MS` في `EditorCore` (٥٠٠ms). */
const UNDO_GROUP_GAP_MS = 650;

/** يفتح التطبيق بجسرٍ مركَّب ومكتبةٍ مبذورة، وينتظر جاهزية المحرر. */
export async function open(
  page: Page,
  opts: { seed?: MockDoc[]; seedTrashed?: MockDoc[] } = {},
): Promise<void> {
  await installBridge(page, opts);
  await page.goto("/");
  await page.waitForSelector(EDITOR);
  // الجلسة تُنشأ بعد سلسلة `await` في `onMount`؛ ننتظر أثرها المرصود
  // لا مهلةً مقدَّرة: `ui_ready` آخر ما يُنادى في تركيب نقطة الاستقبال.
  await expect
    .poll(() => page.evaluate(() => window.__luma.calls("ui_ready")), {
      message: "لم تُنادَ ui_ready — لم تكتمل تهيئة الجسر",
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
}

/** نصّ المحرر كما يقرؤه إنسان — فقرات مفصولة بسطر. */
export function editorText(page: Page): Promise<string> {
  return page.$eval(EDITOR, (el) =>
    [...el.querySelectorAll("p, h1, h2, blockquote")]
      .map((n) => (n.textContent || "").trim())
      .filter(Boolean)
      .join("\n"),
  );
}

export function dump(page: Page): Promise<MockDump> {
  return page.evaluate(() => window.__luma.dump());
}

/** حالة زرَّي التراجع والإعادة كما تُرسم فعلًا. */
export function historyButtons(page: Page): Promise<{ undo: boolean; redo: boolean }> {
  return page.evaluate(() => ({
    undo: !document.querySelector<HTMLButtonElement>("[data-undo] button")!.disabled,
    redo: !document.querySelector<HTMLButtonElement>("[data-redo] button")!.disabled,
  }));
}

/** ينتظر وصولَ نصٍّ بعينه إلى «القرص» — لا مهلة الحفظ التلقائي. */
export async function waitSaved(page: Page, needle: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          (n) => window.__luma.dump().docs.some((d) => d.text.includes(n)),
          needle,
        ),
      { message: `لم يصل القرصَ نصٌّ يحوي «${needle}»`, timeout: 15_000 },
    )
    .toBe(true);
}

/** ينتظر بلوغ عدد اللقطات المطلوب لمستندٍ بعينه. */
export async function waitRevisions(
  page: Page,
  docId: string,
  n: number,
): Promise<void> {
  await expect
    .poll(
      () => page.evaluate((id) => window.__luma.dump().revs[id] ?? 0, docId),
      { message: `لم تبلغ لقطات ${docId} العدد ${n}`, timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(n);
}

/** معرّف المستند المفتوح — أول ما ظهر في المكتبة بعد أول محتوى. */
export async function currentDocId(page: Page, exclude: string[] = []): Promise<string> {
  let id = "";
  await expect
    .poll(
      async () => {
        const d = await dump(page);
        const found = d.docs.find((x) => !exclude.includes(x.id));
        id = found?.id ?? "";
        return id;
      },
      { message: "لم يُنشأ مستندٌ على القرص", timeout: 15_000 },
    )
    .not.toBe("");
  return id;
}

/**
 * يكتب فقرةً وينتظر وصولها القرص، ثم يفصل خطوة التراجع عمّا بعدها.
 *
 * الفجوة لازمة: `prosemirror-history` يجمع الكتابة المتقاربة في خطوة
 * واحدة، فبلا فاصلٍ يتجاوز `UNDO_GROUP_DELAY_MS` يصير «تراجعان» تراجعًا.
 */
export async function typeParagraph(
  page: Page,
  text: string,
  opts: { newGroup?: boolean } = {},
): Promise<void> {
  await page.keyboard.type(text, { delay: 0 });
  await waitSaved(page, text.slice(0, 24));
  if (opts.newGroup !== false) await page.waitForTimeout(UNDO_GROUP_GAP_MS);
}

/** فقرة طويلة تتجاوز عتبة اللقطة التلقائية بيقين. */
export function longParagraph(n: number): string {
  return (
    `فقرةٌ رقم ${n}: ` +
    "نصٌّ عربي مطوَّل يتجاوز عتبة اللقطة التلقائية وهي ثمانون حرفًا كاملة، ".repeat(2)
  );
}

/** يفتح شاشة الإعدادات من بند قائمة النظام — لا مدخل مرسوم لها. */
export async function openSettings(page: Page): Promise<void> {
  await page.evaluate(() => window.__luma.emit("luma://menu", "settings"));
  await page.waitForSelector("[data-section]");
}

/** يفتح قسم السلّة داخل الإعدادات. */
export async function openTrashSection(page: Page): Promise<void> {
  await openSettings(page);
  await page.click('[data-section="trash"] button');
}

/** يطرق بند «حذف النص» في قائمة النظام (⌘⌫). يُبلّغ بعدد المستمعين. */
export function menuDelete(page: Page): Promise<number> {
  return page.evaluate(() => window.__luma.emit("luma://menu", "delete"));
}
