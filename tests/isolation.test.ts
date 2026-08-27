/**
 * حارس بنيوي على §٧ **ثابت** — CLAUDE.md بند ١١، `IMPLEMENTATION.md`
 * §٧: «كل مقطع لاتيني داخل جملة عربية يُعزل بمحدِّدات الاتجاه
 * (`isolate()`) أو يُتجنَّب الإدراج أصلًا، وإلا رُسم في الطرف الخطأ.»
 *
 * قاعدة تُفرض آليًا لا اتفاقًا — على نمط `tests/tokens.test.ts`.
 *
 * يقرأ **الكود المشحون** وحده — `.svelte`/`.ts` تحت `src/` باستثناء
 * `src/dev/` (أدوات تطوير لا تُشحن — CLAUDE.md) و`src/tokens/` (بيانات
 * مولَّدة بلا نثر عربي). يفحص الملف كاملًا لا `<script>` وحدها: سلاسل
 * الاقتباس المزدوج (فيها نثر الترميز والبرمجة معًا) والقوالب الحرفية.
 *
 * اكتُشف عبر بنائه خمسة خروق حقيقية — أُصلحت في التزام واحد معه:
 * أربع رسائل `fail()` في `App.svelte`، وواحدة في `HistoryPanel.svelte`
 * (البنود المسمّاة في `docs/audit/AUDIT-2026-08-27.md`)، ومعها اثنان
 * لم يذكرهما التقرير — كشفهما بناء هذا الحارس نفسه: قيمة `BlockRole`
 * خامًا في رسالة `convert.ts`، واسم الصنف في `EditorCore.ts`.
 *
 * **حدوده المُقِرّ بها — لا يغطّيها هذا الحارس ولا يدّعي ذلك:**
 * - **النص الديناميكي غائب عن مرماه.** رسائل تصل `fail()` من
 *   `Error.message` (خاصة ما يعبر من Rust عبر `to_message`، وغالبًا
 *   إنجليزي خام من نظام التشغيل) لا عزل عليها بتاتًا في `Alert.svelte`
 *   — وهذا خرقٌ فعليّ أوسع من الخمسة التي أصلحها S2، لكنه يحتاج حلًّا
 *   عند موضع العرض (`{detail}` في `Alert.svelte`) لا ماسحَ مصدرٍ ساكن؛
 *   الماسح يرى نصّ الشيفرة لا قيمًا تصل وقت التشغيل. مسجَّل خارج نطاق
 *   S2 في `docs/audit/FIX-PLAN-2026-08-27.md`.
 * - نصوص `docs/*.md` خارج مرماه — هذا حارسُ كودٍ مشحون.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/** لا تُشحن، أو بلا نثر عربي — الشرح في الترويسة. */
const EXCLUDE_DIRS = new Set(["dev", "tokens"]);

function shippedFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (EXCLUDE_DIRS.has(name)) continue;
      shippedFiles(p, out);
    } else if (extname(name) === ".svelte" || extname(name) === ".ts") {
      out.push(p);
    }
  }
  return out;
}

const ARABIC = /[؀-ۿ]/;
const LATIN_RUN = /[A-Za-z][A-Za-z'-]*/g;
/** بادئة كل سجلّ تطوير — لا تصل الكاتب أبدًا، فلا عزل عليها. */
const DEV_LOG_PREFIX = "[luma]";

/**
 * أدوات `bidi.ts` التي تُعيد عربية أو أرقامًا عربية آمنة **ببنائها**:
 * `isolate` نفسها، وكل دالة في الملف لا تُخرج لاتينيًّا خامًا مطلقًا.
 * نداءٌ إلى إحداها داخل عنصر نائب (`${…}` في قالب، أو `{…}` في سمة
 * Svelte) يُعفى — غيره يحتاج عزلًا صريحًا أو سطرًا في `ALLOW` أدناه.
 */
const SAFE_CALLEES = new Set([
  "isolate",
  "arabicDigits",
  "counted",
  "words",
  "wordDelta",
  "duration",
  "sinceLabel",
  "untilTrashEmptyLabel",
]);

/**
 * لائحة سماح — مواضع تحقّقتُ يدويًا أن العنصر النائب فيها عربيّ دومًا،
 * ولا سبيل لإثبات ذلك بمطابقة اسم دالّة وحدها (وسيطٌ محليّ لا نداء).
 * كل سطر إضافة تحتاج المراجعة نفسها.
 */
const ALLOW: { file: string; needle: string; why: string }[] = [
  {
    file: "src/lib/session.ts",
    needle: "${action}",
    why:
      "وسيطٌ محليّ في NotSettledError، وكل نداءاته الثلاثة في الملف " +
      "نفسه تمرّر حرفًا عربيًا («يُفتح غيره»، «يُبدأ غيره»، «يُحذف»)",
  },
];

/** يستخرج سلاسل الاقتباس المزدوج والقوالب الحرفية بعد حذف التعليقات. */
function extractStrings(src: string): { raw: string; kind: "double" | "template" }[] {
  const noLine = src.replace(/\/\/[^\n]*/g, "");
  const noComments = noLine.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { raw: string; kind: "double" | "template" }[] = [];
  for (const m of noComments.matchAll(/"(?:[^"\\\n]|\\.)*"/g)) {
    out.push({ raw: m[0].slice(1, -1), kind: "double" });
  }
  for (const m of noComments.matchAll(/`(?:[^`\\]|\\.)*`/g)) {
    out.push({ raw: m[0].slice(1, -1), kind: "template" });
  }
  return out;
}

/**
 * يفحص سلسلة واحدة. `placeholderRe` يميّز عنصرها النائب:
 * `${…}` للقوالب الحرفية، `{…}` (بلا `$`) لسمات Svelte المقتبَسة.
 * يُبلّغ بكل مخالفة: مقطعٌ لاتيني عارٍ في النص الساكن، أو عنصر نائب
 * غير مثبَتٍ عربيًّا.
 */
function checkString(
  file: string,
  raw: string,
  placeholderRe: RegExp,
): string[] {
  if (raw.trimStart().startsWith(DEV_LOG_PREFIX)) return [];

  const violations: string[] = [];
  let staticText = raw;

  for (const m of raw.matchAll(placeholderRe)) {
    const inner = m[1] ?? "";
    const full = m[0];
    staticText = staticText.replace(full, "");

    const calleeMatch = inner.match(/^\s*([A-Za-z_$][\w$]*)\s*\(/);
    if (calleeMatch && SAFE_CALLEES.has(calleeMatch[1]!)) continue;
    if (ALLOW.some((a) => file.endsWith(a.file) && raw.includes(a.needle) && full === a.needle)) {
      continue;
    }
    violations.push(`عنصر نائب غير مثبَت عربيًّا: ${full}`);
  }

  if (!ARABIC.test(staticText)) return violations;
  const runs = [...staticText.matchAll(LATIN_RUN)].map((m) => m[0]);
  if (runs.length > 0) {
    violations.push(`مقطع لاتيني عارٍ: ${JSON.stringify(runs)}`);
  }
  return violations;
}

describe("عزل المقاطع اللاتينية داخل الجمل العربية — §٧ ثابت", () => {
  const files = shippedFiles(SRC);

  it("يفحص عددًا معقولًا من الملفات المشحونة", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("لا سلسلة عربية شحونة فيها مقطع لاتيني عارٍ", () => {
    const failures: string[] = [];

    for (const file of files) {
      const rel = relative(ROOT, file);
      const src = readFileSync(file, "utf8");
      for (const { raw, kind } of extractStrings(src)) {
        if (!ARABIC.test(raw)) continue;
        const placeholderRe = kind === "template" ? /\$\{([^}]*)\}/g : /\{([^{}]*)\}/g;
        const violations = checkString(rel, raw, placeholderRe);
        for (const v of violations) {
          failures.push(`${rel}: «${raw.slice(0, 80)}» — ${v}`);
        }
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("لائحة السماح كلها لا تزال مطابقة لموضعها", () => {
    // سطرٌ في ALLOW لم يعد يطابق شيئًا هو تعليقٌ ميت — إما أُصلح
    // الموضع فزال، أو تغيّر نصّه فوجب تحديث `needle` معه.
    for (const entry of ALLOW) {
      const full = join(ROOT, entry.file);
      const src = readFileSync(full, "utf8");
      expect(src.includes(entry.needle), `${entry.file}: ${entry.needle}`).toBe(true);
    }
  });
});
