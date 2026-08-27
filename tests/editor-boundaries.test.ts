/**
 * حارس بنيوي لحدود نواة المحرر — `IMPLEMENTATION.md` §٢ **ثابت**.
 *
 * «المحرر نواة مستقلة لا تعرف شيئًا عن المكتبة ولا الصوت ولا الإملاء
 * ولا الإعدادات» — قاعدة تُفرض هنا آليًا، لا تُترك اتفاقًا بين المطورين.
 *
 * معيار اكتمال المرحلة ٢: «محاولة استدعاء أي شيء من المكتبة أو التخزين
 * داخل `EditorCore` تفشل بنيويًا، لا اتفاقًا.»
 *
 * **قائمة سماح لا قائمة منع** — بندُ ب/٣ في
 * `docs/audit/AUDIT-2026-08-27.md`: كانت هذه لائحة أنماطٍ محظورة
 * (`../library`، `../settings`، …)، وكل الستة كانت **ميتة**: تشير إلى
 * ملفات لا وجود لها أصلًا (الحقيقي `../lib/library` لا `../library`،
 * ولا `src/lib/storage.ts` موجود إطلاقًا). فمَن يكتب استيرادًا حقيقيًا
 * للمكتبة أو الإعدادات لا يصطدم بأيّ نمط منها. والقائمة المحظورة
 * تتقادم بالتصميم — كل مسارٍ جديد للانتهاك يحتاج سطرًا جديدًا لم
 * يُكتب بعد. لائحة السماح لا تتقادم: أيّ استيرادٍ لا يطابقها يسقط،
 * سواء عرفناه اليوم أو لا.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const EDITOR_DIR = join(ROOT, "src/editor");

/**
 * الوحيدة المسموح لها بالخروج من `src/editor/` — أداة نصّ عامة لا
 * معرفة تخزين ولا مكتبة، أُضيفت في S2 لعزل مقاطع لاتينية في رسائل
 * الأخطاء الداخلية (`convert.ts`/`paste.ts`/`EditorCore.ts`).
 */
const ALLOWED_EXTERNAL = new Set(["../lib/bidi"]);

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** كل مواصفة وحدة تصلها `from "…"` — أحاديّة السطر أو متعدّدته. */
function importedModules(src: string): string[] {
  return [...src.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]!);
}

describe("حدود نواة المحرر — قائمة سماح على الاستيراد", () => {
  const files = tsFiles(EDITOR_DIR);

  it("يوجد ملفات لفحصها", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("كل استيراد إمّا داخل src/editor/، أو حزمة prosemirror-*، أو في لائحة السماح", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file);
      for (const spec of importedModules(readFileSync(file, "utf8"))) {
        const isInternal = spec.startsWith("./") || spec.startsWith("../editor/");
        const isProsemirror = spec.startsWith("prosemirror-");
        const isAllowedExternal = ALLOWED_EXTERNAL.has(spec);
        if (!isInternal && !isProsemirror && !isAllowedExternal) {
          offenders.push(`${rel}: "${spec}"`);
        }
      }
    }
    expect(
      offenders,
      "استيرادٌ خارج src/editor/ لا يطابق لائحة السماح — IMPLEMENTATION.md §٢",
    ).toEqual([]);
  });

  it("لائحة السماح كلها تُستعمل فعلًا — سطرٌ لا يطابق شيئًا وعدٌ ميت", () => {
    const used = new Set<string>();
    for (const file of files) {
      for (const spec of importedModules(readFileSync(file, "utf8"))) {
        used.add(spec);
      }
    }
    const dead = [...ALLOWED_EXTERNAL].filter((s) => !used.has(s));
    expect(dead, "مسموحٌ به ولا مستوردًا — نظير العطل الذي أسقط هذا الحارس").toEqual(
      [],
    );
  });

  it("لا تلمس النواة القرص ولا مسارات الملفات", () => {
    const offenders = files.filter((f) =>
      /node:fs|node:path|require\(['"]fs/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("لا تعرف النواة Tauri ولا تخزين المتصفح ولا الشبكة", () => {
    const patterns = [
      { pattern: /@tauri-apps/, why: "التخزين والنواة الأصلية" },
      { pattern: /localStorage|sessionStorage|indexedDB/, why: "تخزين المتصفح" },
      { pattern: /\bfetch\s*\(/, why: "الشبكة" },
    ];
    for (const { pattern, why } of patterns) {
      const offenders = files.filter((f) => pattern.test(readFileSync(f, "utf8")));
      expect(offenders, `نواة المحرر لا يجوز أن تعرف ${why}`).toEqual([]);
    }
  });
});
