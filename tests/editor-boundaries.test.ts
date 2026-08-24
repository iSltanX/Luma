/**
 * حارس بنيوي لحدود نواة المحرر — `IMPLEMENTATION.md` §٢ **ثابت**.
 *
 * «المحرر نواة مستقلة لا تعرف شيئًا عن المكتبة ولا الصوت ولا الإملاء
 * ولا الإعدادات» — قاعدة تُفرض هنا آليًا، لا تُترك اتفاقًا بين المطورين.
 *
 * معيار اكتمال المرحلة ٢: «محاولة استدعاء أي شيء من المكتبة أو التخزين
 * داخل `EditorCore` تفشل بنيويًا، لا اتفاقًا.»
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const EDITOR_DIR = join(process.cwd(), "src/editor");

/** ما لا يجوز أن تعرفه النواة إطلاقًا. */
const FORBIDDEN = [
  { pattern: /@tauri-apps/, why: "التخزين والنواة الأصلية" },
  { pattern: /['"]\.\.\/lib\/storage/, why: "التخزين" },
  { pattern: /['"]\.\.\/library/, why: "المكتبة" },
  { pattern: /['"]\.\.\/settings/, why: "الإعدادات" },
  { pattern: /['"]\.\.\/audio/, why: "الصوت" },
  { pattern: /['"]\.\.\/dictation/, why: "الإملاء" },
  { pattern: /['"]\.\.\/history/, why: "السجل الزمني" },
  { pattern: /localStorage|sessionStorage|indexedDB/, why: "تخزين المتصفح" },
  { pattern: /\bfetch\s*\(/, why: "الشبكة" },
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("حدود نواة المحرر", () => {
  const files = tsFiles(EDITOR_DIR);

  it("يوجد ملفات لفحصها", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN)(
    "لا تعرف النواة $why",
    ({ pattern, why }) => {
      const offenders = files.filter((f) =>
        pattern.test(readFileSync(f, "utf8")),
      );
      expect(
        offenders,
        `نواة المحرر لا يجوز أن تعرف ${why} — IMPLEMENTATION.md §٢`,
      ).toEqual([]);
    },
  );

  it("لا تلمس النواة القرص ولا مسارات الملفات", () => {
    const offenders = files.filter((f) =>
      /node:fs|node:path|require\(['"]fs/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
