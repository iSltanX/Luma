/**
 * أمانة الجسر المقلَّد — `tests/e2e/bridge/mock-bridge.ts`.
 *
 * الجسر يعيد إنتاج دلالات `src-tauri/src/storage` في JS كي تعمل حزمة
 * e2e على مسار التخزين. وقيمةُ ذلك كلها معلَّقة على شرطٍ واحد:
 * **أن يبقى مطابقًا لما يقلّده**. جسرٌ انحرف عن النواة أسوأ من لا
 * جسر: يمنح ثقةً كاذبة، ويُخضِّر اختبارًا يصف تطبيقًا لا وجود له.
 *
 * والتطابق هنا **بالقيمة لا بمرجعٍ مشترك** — لا سبيل إلى استيراد
 * ثابت Rust في JS — فيحرسه هذا الملف بقراءة المصدر نفسه: انحراف
 * أحد الطرفين يُسقط البناء ويسمّي الطرفين معًا.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MOCK_MIN_CHANGE_CHARS,
  MOCK_TRASH_RETENTION_MS,
} from "./e2e/bridge/mock-bridge";
import { TRASH_RETENTION_MS } from "../src/lib/library";

const ROOT = process.cwd();
const rust = (p: string) => readFileSync(join(ROOT, "src-tauri/src", p), "utf8");

/**
 * يقرأ ثابتًا عدديًّا من مصدر Rust ويحسب تعبيره الحسابي.
 *
 * القيمة تُكتب هناك مضروبةً لتُقرأ (`30 * 24 * 60 * 60 * 1000`)، فلا
 * تكفي مطابقةُ رقمٍ حرفي.
 */
function rustConst(source: string, name: string): number {
  const m = source.match(
    new RegExp(`const\\s+${name}\\s*:\\s*\\w+\\s*=\\s*([0-9_ */+-]+);`),
  );
  expect(m, `لم يُعثر على الثابت ${name} في مصدر Rust`).toBeTruthy();
  const expr = m![1]!.replace(/_/g, "");
  // تعبير حسابي بحت — الأرقام والعمليات الأربع وحدها
  expect(expr, `تعبير غير متوقَّع للثابت ${name}`).toMatch(/^[0-9 */+-]+$/);
  return Number(new Function(`return (${expr});`)());
}

describe("الجسر المقلَّد يطابق النواة التي يقلّدها", () => {
  it("مهلة السلّة تطابق `TRASH_RETENTION_MS` في Rust", () => {
    const fromRust = rustConst(rust("storage/document.rs"), "TRASH_RETENTION_MS");
    expect(fromRust, "٣٠ يومًا بالميلّي").toBe(30 * 24 * 60 * 60 * 1000);
    expect(MOCK_TRASH_RETENTION_MS, "الجسر انحرف عن Rust").toBe(fromRust);
  });

  it("ومهلة السلّة تطابق نسخة الواجهة في `src/lib/library.ts`", () => {
    // النسخة الثالثة من الرقم نفسه؛ تعليقُها يقرّ بأنها تُطابق بالقيمة
    // وتُغيَّر باليد — فالمقارنة هنا هي ما يجعل ذلك الإقرار محروسًا.
    expect(MOCK_TRASH_RETENTION_MS).toBe(TRASH_RETENTION_MS);
  });

  it("عتبة اللقطة تطابق `MIN_CHANGE_CHARS` في Rust", () => {
    const fromRust = rustConst(rust("storage/revision.rs"), "MIN_CHANGE_CHARS");
    expect(fromRust, "ثمانون حرفًا — ADR ٠٠٠٦").toBe(80);
    expect(MOCK_MIN_CHANGE_CHARS, "الجسر انحرف عن Rust").toBe(fromRust);
  });
});

describe("الجسر يغطّي كل أمرٍ تناديه الواجهة", () => {
  const bridge = readFileSync(
    join(ROOT, "tests/e2e/bridge/mock-bridge.ts"),
    "utf8",
  );

  /** أسماء الأوامر المعرَّفة في الجسر — مفاتيح `handlers` وإضافاتها. */
  const implemented = new Set<string>([
    ...[...bridge.matchAll(/^\s{6}([a-z_]+)[:(]/gm)].map((m) => m[1]!),
    ...[...bridge.matchAll(/handlers\["([^"]+)"\]/g)].map((m) => m[1]!),
  ]);

  it("يعرف الأوامر المعروفة سلفًا", () => {
    // مرساة: لو انهار الاستخراج أعلاه لصارت المجموعة فارغة والفحص
    // التالي يمرّ بلا معنى.
    for (const cmd of ["save_document", "load_document", "delete_document"]) {
      expect(implemented.has(cmd), `الاستخراج فات ${cmd}`).toBe(true);
    }
  });

  it("لا أمر في `src/` بلا معالج في الجسر", () => {
    const app = readFileSync(join(ROOT, "src/App.svelte"), "utf8");
    const invoked = new Set(
      [
        ...app.matchAll(/(?:invoke|activeInvoke|call)\s*(?:<[^>]*>)?\s*\(\s*"([a-z_]+)"/g),
      ].map((m) => m[1]!),
    );
    expect(invoked.size, "لم يُستخرج أيُّ أمر من App.svelte").toBeGreaterThan(10);

    const missing = [...invoked].filter((c) => !implemented.has(c));
    expect(
      missing,
      `أوامر تناديها الواجهة ولا يعرفها الجسر: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
