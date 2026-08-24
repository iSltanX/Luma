/**
 * حرّاس طبقة الرموز — `IMPLEMENTATION.md` §٩ و§١٧ مبدأ ٦ **ثابت**.
 *
 * «لا لون مكتوب يدويًا؛ كل لون رمز ثيم.» قاعدة تُفرض آليًا لا اتفاقًا.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { COLOR_VALUES, THEME_IDS, COLOR_ROLES } from "../src/tokens/themes";

const SRC = join(process.cwd(), "src");

function files(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...files(p, exts));
    else if (exts.some((x) => e.endsWith(x))) out.push(p);
  }
  return out;
}

// ── ١ · لا لون حرفي ──────────────────────────────────────────

/** ما تُستثنى: طبقة الرموز المولَّدة نفسها، ومصدرها، والأيقونات. */
const TOKEN_LAYER = [
  join(SRC, "tokens", "tokens.css"),
  join(SRC, "tokens", "themes.ts"),
  join(SRC, "tokens", "source.json"),
];

const LITERAL_COLOR =
  /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(|\boklch\s*\(/;

describe("لا لون مكتوب يدويًا", () => {
  const candidates = files(SRC, [".css", ".svelte", ".ts"]).filter(
    (f) => !TOKEN_LAYER.includes(f),
  );

  it("يوجد ملفات لفحصها", () => {
    expect(candidates.length).toBeGreaterThan(5);
  });

  it.each(candidates.map((f) => [f.slice(SRC.length + 1), f]))(
    "%s بلا ألوان حرفية",
    (_rel, full) => {
      const offenders = readFileSync(full as string, "utf8")
        .split("\n")
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        // تعليقات الشرح قد تذكر قيمة، والذِكر ليس استخدامًا
        .filter((l) => !l.line.startsWith("*") && !l.line.startsWith("//"))
        .filter((l) => LITERAL_COLOR.test(l.line));

      expect(
        offenders.map((o) => `${o.n}: ${o.line}`),
        "كل لون يجب أن يكون رمز ثيم — IMPLEMENTATION.md §١٧ مبدأ ٦",
      ).toEqual([]);
    },
  );
});

// ── ٢ · اكتمال الرموز ────────────────────────────────────────

describe("اكتمال طبقة الرموز", () => {
  it("٢٤ دورًا لونيًا في خمسة ثيمات", () => {
    expect(COLOR_ROLES.length).toBe(24);
    expect(THEME_IDS.length).toBe(5);
  });

  it("لا دور بلا قيمة في أي ثيم", () => {
    const missing: string[] = [];
    for (const role of COLOR_ROLES) {
      for (const t of THEME_IDS) {
        const v = COLOR_VALUES[role]?.[t];
        if (!v || !/^#[0-9a-f]{6}$/i.test(v)) missing.push(`${role}/${t}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("كل رمز في المصدر له متغيّر في CSS المولَّد", () => {
    const css = readFileSync(join(SRC, "tokens", "tokens.css"), "utf8");
    const absent = COLOR_ROLES.filter(
      (r) => !css.includes(`--${r.replace(/\//g, "-")}:`),
    );
    expect(absent).toEqual([]);
  });

  it("الثيمات الأربعة غير الافتراضية لها كتلة سمة", () => {
    const css = readFileSync(join(SRC, "tokens", "tokens.css"), "utf8");
    for (const t of THEME_IDS.slice(1)) {
      expect(css).toContain(`[data-theme="${t}"]`);
    }
  });
});

// ── ٣ · التتبّع صفر على كل نمط يُشحن ─────────────────────────

describe("قواعد الطباعة العربية في الرموز", () => {
  const css = readFileSync(join(SRC, "tokens", "tokens.css"), "utf8");

  it("كل صنف نمط نص يصرّح بتتبّع صفر", () => {
    const classes = [...css.matchAll(/\.t-([\w-]+)\s*\{([^}]*)\}/g)];
    expect(classes.length).toBeGreaterThan(10);
    for (const [, name, body] of classes) {
      expect(body, `.t-${name} بلا letter-spacing: 0`).toMatch(
        /letter-spacing:\s*0\b/,
      );
    }
  });

  it("لا نمط نص دون ١٢ نقطة", () => {
    const sizes = [...css.matchAll(/--text-[\w-]+:\s*\d+\s+(\d+)px/g)].map((m) =>
      Number(m[1]),
    );
    expect(sizes.length).toBeGreaterThan(10);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  });
});

// ── ٣ب · لا متغيّر غير معرَّف ────────────────────────────────

describe("كل متغيّر مستخدَم معرَّف في طبقة الرموز", () => {
  // متغيّر غير معرَّف لا يرمي خطأ: تسقط القاعدة صامتةً فتنهار المقاسات
  // بلا أثر. هذا ما حدث فعلًا حين تغيّرت أسماء الرموز.
  //
  // مصدرا التعريف: طبقة الرموز المولَّدة، و`app.css` للمتغيّرات
  // التخطيطية العامة التي لا تأتي من Figma — مثل جانب أزرار النافذة
  // (ADR ٠٠٠٣). كلاهما محمَّل قبل أي مكوّن، والحارس يبقى قادرًا على
  // كشف الأخطاء المطبعية لأنها لن تكون معرَّفة في أيٍّ منهما.
  const tokens = readFileSync(join(SRC, "tokens", "tokens.css"), "utf8");
  const globals = readFileSync(join(SRC, "app.css"), "utf8");
  const defined = new Set(
    [...`${tokens}\n${globals}`.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]!),
  );

  const consumers = files(SRC, [".css", ".svelte"]).filter(
    (f) => f !== join(SRC, "tokens", "tokens.css"),
  );

  it.each(consumers.map((f) => [f.slice(SRC.length + 1), f]))(
    "%s لا يستهلك متغيّرًا غير معرَّف",
    (_rel, full) => {
      const text = readFileSync(full as string, "utf8");
      // متغيّرات محلية يعرّفها الملف نفسه مقبولة
      const local = new Set(
        [...text.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]!),
      );
      const used = [...text.matchAll(/var\(\s*(--[\w-]+)\s*(?:,|\))/g)].map(
        (m) => m[1]!,
      );
      const unknown = [
        ...new Set(used.filter((v) => !defined.has(v) && !local.has(v))),
      ];
      expect(unknown, "متغيّر غير معرَّف يُسقط القاعدة صامتًا").toEqual([]);
    },
  );
});

// ── ٤ · التباين ──────────────────────────────────────────────

function luminance(hex: string): number {
  const v = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

function ratio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * أزواج تُفرض بحدّها الأدنى.
 *
 * ٤٫٥ للنص العادي، و٣ للنص الكبير وللرسوميات وحدود عناصر التحكم —
 * WCAG 2.2 AA كما في §١٣.
 */
const PAIRS: ReadonlyArray<[string, string, number, string]> = [
  ["text/primary", "surface/paper", 4.5, "نص الواجهة على الورقة"],
  ["text/primary", "surface/canvas", 4.5, "نص الواجهة على الخلفية"],
  ["text/primary", "surface/raised", 4.5, "نص على سطح مرتفع"],
  ["text/secondary", "surface/paper", 4.5, "نص ثانوي على الورقة"],
  ["text/secondary", "surface/raised", 4.5, "نص ثانوي على سطح مرتفع"],
  ["text/muted", "surface/paper", 4.5, "نص خافت على الورقة"],
  ["text/muted", "surface/raised", 4.5, "نص خافت على سطح مرتفع"],
  ["editor/ink", "surface/paper", 4.5, "حبر المحرر على الورقة"],
  ["editor/ink", "accent/selection", 4.5, "حبر المحرر على التحديد"],
  ["accent/text", "accent/subtle", 4.5, "نص اللمسة على تظليلها"],
  ["accent/text", "surface/paper", 4.5, "نص اللمسة على الورقة"],
  ["text/on-accent", "accent/text", 4.5, "نص فوق تعبئة اللمسة"],
  ["state/positive", "state/positive-bg", 4.5, "حالة موجبة على تظليلها"],
  ["state/caution", "state/caution-bg", 4.5, "حالة تحذير على تظليلها"],
  ["state/critical", "state/critical-bg", 4.5, "حالة خطأ على تظليلها"],
  ["state/info", "state/info-bg", 4.5, "حالة معلومة على تظليلها"],
  ["text/secondary", "accent/subtle", 4.5, "نص ثانوي على الصف المحدَّد"],
  ["text/primary", "surface/sunken", 4.5, "نص على السطح الغائر (تمرير)"],
  ["text/secondary", "surface/sunken", 4.5, "نص ثانوي على السطح الغائر"],
  // رسوميات وحدود: ٣:١
  ["accent/graphic", "surface/canvas", 3, "الرسوميات وحلقة التركيز على الخلفية"],
  ["accent/graphic", "surface/paper", 3, "الرسوميات على الورقة"],
  ["accent/graphic", "surface/raised", 3, "الرسوميات وحلقة التركيز على سطح مرتفع"],
  ["accent/graphic", "surface/sunken", 3, "الرسوميات على السطح الغائر"],
  ["border/control", "surface/paper", 3, "حدّ عنصر التحكم على الورقة"],
  ["border/control", "surface/canvas", 3, "حدّ عنصر التحكم على الخلفية"],
  ["border/control", "surface/raised", 3, "حدّ عنصر التحكم على سطح مرتفع"],
  // علامة الاختيار رسمٌ لا نص: عتبتها ٣:١ — WCAG 1.4.11
  ["text/on-accent", "accent/graphic", 3, "علامة الاختيار فوق تعبئة اللمسة"],
];

/**
 * أزواج تُرسم فعلًا ولا تُفرض — **بقرار مكتوب لا بسهو**.
 *
 * القائمة أعلاه كانت يدويةً بلا حارس يكشف ما يفلت منها، فمرّت سبعة
 * أزواج مرسومة في المكوّنات بلا فحص واحد. الحارس أدناه يشتقّ الأزواج
 * من الكود، وهذا الاستثناء هو ما يُخرَج منه صراحةً ومعه سببه.
 */
const ACCEPTED: ReadonlyArray<[string, string, string]> = [
  [
    "border/control",
    "surface/sunken",
    "الحافة الداخلية للحقل والمسار: ٢٫٨٢:١ على التعبئة الغائرة. " +
      "وWCAG 1.4.11 يطلب ٣:١ لما **يعرّف** العنصر، والذي يعرّفه هو حدّه " +
      "على السطح المحيط (٣٫١٩–٤٫٠١ — مفروضة أعلاه)، لا حافته على تعبئته.",
  ],
  [
    "text/on-accent",
    "surface/paper",
    "صندوق خانة الاختيار **غير المحدَّدة**: يحمل لون العلامة استعدادًا " +
      "لها، ولا علامة تُرسم قبل التحديد (`{#if checked}`). وحين تُرسم " +
      "تكون التعبئة `accent/graphic` — وذاك الزوج مفروض أعلاه. أثرُ " +
      "قراءةٍ ساكنة للقاعدة، لا زوجٌ يقع على الشاشة.",
  ],
  [
    "text/on-accent",
    "state/critical",
    "الزر المتلف: نصّ فوق تعبئة `state/critical`. لا إجراء متلفًا في " +
      "Luma («لا حذف» — `Luma.md` §٦)، والمكوّن غير مستعمل في أي شاشة.",
  ],
];

/**
 * حارس الاكتمال — **يشتقّ الأزواج من الكود لا من قائمة يدوية**.
 *
 * §١٥: «فحص تباين آلي لكل زوج رمز». وقائمةٌ يكتبها إنسان تنسى، وقد
 * نسيت: `accent/graphic` تعبئةً خلف نص الزر الأساسي عند التمرير
 * (٣٫٦٠:١) بقيت سنةً خارج الفحص. هذا الحارس يقرأ كل قاعدة CSS تضبط
 * `color` و`background` معًا من رمزين، ويسقط إن وجد زوجًا لا في
 * `PAIRS` ولا في `ACCEPTED` — فالنسيان يصير خطأ بناء لا مفاجأة إصدار.
 *
 * ما لا يلتقطه: الزوج الموروث (لون هنا وخلفية على السلف). ذاك يبقى في
 * `PAIRS` يدويًّا، وهو سبب بقائها.
 */
describe("لا زوج مرسوم خارج الفحص", () => {
  /** `--text-primary` ← `text/primary`. الاشتقاق عكسي من أسماء الأدوار. */
  const roleOf = new Map(
    COLOR_ROLES.map((r) => [`--${r.replace(/\//g, "-")}`, r]),
  );

  const guarded = new Set([
    ...PAIRS.map(([fg, bg]) => `${fg}|${bg}`),
    ...ACCEPTED.map(([fg, bg]) => `${fg}|${bg}`),
  ]);

  it("كل قاعدة تضبط اللون والخلفية معًا زوجُها مفروض", () => {
    const unguarded = new Set<string>();
    for (const file of files(SRC, [".css", ".svelte"])) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
        const body = m[1] ?? "";
        const fg = body.match(/(?:^|[;\s])color:\s*var\((--[\w-]+)\)/);
        const bg = body.match(
          /(?:^|[;\s])background(?:-color)?:\s*var\((--[\w-]+)\)/,
        );
        if (!fg || !bg) continue;
        const a = roleOf.get(fg[1]!);
        const b = roleOf.get(bg[1]!);
        if (!a || !b) continue;
        if (!guarded.has(`${a}|${b}`)) {
          unguarded.add(`${a} على ${b}  ‹${file.slice(SRC.length + 1)}›`);
        }
      }
    }
    expect(
      [...unguarded],
      "زوج يُرسم ولا يُفحص — أضِفه إلى PAIRS أو إلى ACCEPTED بسببه",
    ).toEqual([]);
  });

  it("كل استثناء يحمل سببًا مكتوبًا", () => {
    for (const [fg, bg, why] of ACCEPTED) {
      expect(COLOR_VALUES[fg], `${fg} ليس رمزًا`).toBeDefined();
      expect(COLOR_VALUES[bg], `${bg} ليس رمزًا`).toBeDefined();
      expect(why.length, `${fg}/${bg} بلا سبب`).toBeGreaterThan(40);
    }
  });
});

describe("تباين الرموز في الثيمات الخمسة", () => {
  it.each(THEME_IDS.map((t) => [t]))("ثيم %s يجتاز كل الأزواج", (themeId) => {
    const failures: string[] = [];
    for (const [fg, bg, min, why] of PAIRS) {
      const a = COLOR_VALUES[fg]?.[themeId as string];
      const b = COLOR_VALUES[bg]?.[themeId as string];
      if (!a || !b) {
        failures.push(`${fg} أو ${bg} مفقود`);
        continue;
      }
      const r = ratio(a, b);
      if (r < min) {
        failures.push(`${why}: ${fg} على ${bg} = ${r.toFixed(2)}:١ (المطلوب ${min})`);
      }
    }
    expect(failures).toEqual([]);
  });
});
