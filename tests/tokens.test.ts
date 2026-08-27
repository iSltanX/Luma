/**
 * حرّاس طبقة الرموز — `IMPLEMENTATION.md` §٩ و§١٧ مبدأ ٦ **ثابت**.
 *
 * «لا لون مكتوب يدويًا؛ كل لون رمز ثيم.» قاعدة تُفرض آليًا لا اتفاقًا.
 *
 * **ومصدر الحقيقة هنا `tokens.css` المولَّد المشحون** لا `themes.ts` —
 * بندُ ب/١٤: الثاني `JSON.stringify(src.colors)` أي إعادةُ صياغةٍ
 * لـ`source.json`، **بنيويًّا عاجزة عن مخالفته**. فحصُ التباين عليه
 * يقيس أن المصدر يطابق نفسه. والملف الذي يُرسم منه هو CSS، فمنه يُقرأ.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { COLOR_VALUES, THEME_IDS, COLOR_ROLES } from "../src/tokens/themes";

const SRC = join(process.cwd(), "src");
const TOKENS_CSS = readFileSync(join(SRC, "tokens", "tokens.css"), "utf8");

function files(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...files(p, exts));
    else if (exts.some((x) => e.endsWith(x))) out.push(p);
  }
  return out;
}

/** `surface/paper` ⇄ `--surface-paper` */
const varOf = (role: string) => `--${role.replace(/\//g, "-")}`;
const ROLE_OF = new Map(COLOR_ROLES.map((r) => [varOf(r), r as string]));

// ── ٠ · قراءة الثيمات من CSS المولَّد ────────────────────────

/**
 * يستخرج قيم الأدوار لكل ثيم من `tokens.css` نفسه.
 *
 * الثيم الافتراضي على `:root` (فلا وميض قبل تطبيق التفضيل)، والأربعة
 * الباقية في كتل `[data-theme="…"]`. والملف يحوي كتل `:root` أخرى
 * للمسافات وأنماط النص، فتُميَّز كتلة الألوان بأنها التي تعرّف أدوارًا.
 */
function parseThemeBlocks(source: string): Map<string, Map<string, string>> {
  // التعليقات تُزال أولًا: ترويسة «ملف مولَّد» تسبق أول `:root` فتلتصق
  // بمُحدِّده، فيصير الثيم الافتراضي غير مقروء — والاختبار يخضرّ على
  // أربعة ثيمات من خمسة.
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "\n");
  const out = new Map<string, Map<string, string>>();
  for (const m of css.matchAll(/(^|\})\s*([^{}]+?)\{([^{}]*)\}/gm)) {
    const selector = (m[2] ?? "").trim();
    const body = m[3] ?? "";
    const values = new Map<string, string>();
    for (const d of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
      const role = ROLE_OF.get(d[1]!);
      if (role) values.set(role, d[2]!.trim());
    }
    if (values.size === 0) continue;

    const themed = selector.match(/^\[data-theme="([\w-]+)"\]$/);
    const id = themed ? themed[1]! : selector === ":root" ? THEME_IDS[0]! : null;
    if (!id) continue;
    // كتلةٌ واحدة لكل ثيم — الدمج يخفي تكرارًا يجب أن يُرى
    expect(out.has(id), `كتلتا ألوان للثيم ${id} في tokens.css`).toBe(false);
    out.set(id, values);
  }
  return out;
}

const THEME_CSS = parseThemeBlocks(TOKENS_CSS);

/** قيمة دورٍ لثيمٍ **كما تُشحن** — من CSS لا من `themes.ts`. */
function shipped(role: string, theme: string): string | undefined {
  return THEME_CSS.get(theme)?.get(role);
}

// ── ١ · لا لون حرفي ──────────────────────────────────────────

/** ما تُستثنى: طبقة الرموز المولَّدة نفسها، ومصدرها. */
const TOKEN_LAYER = [
  join(SRC, "tokens", "tokens.css"),
  join(SRC, "tokens", "themes.ts"),
  join(SRC, "tokens", "motion.ts"),
  join(SRC, "tokens", "source.json"),
];

/**
 * الخصائص التي تحمل لونًا — مُعدَّدة لا بنمط.
 *
 * `border-[a-z]+` كان يلتقط `border-radius` و`border-width` معهما،
 * فيصير الحارس يفحص أرقامًا لا ألوانًا.
 */
const COLOR_PROPS = new Set([
  "color",
  "background",
  "background-color",
  "background-image",
  "border",
  "border-color",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-block",
  "border-inline",
  "border-block-start",
  "border-block-end",
  "border-inline-start",
  "border-inline-end",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-block-start-color",
  "border-block-end-color",
  "border-inline-start-color",
  "border-inline-end-color",
  "outline",
  "outline-color",
  "fill",
  "stroke",
  "box-shadow",
  "text-shadow",
  "text-decoration-color",
  "caret-color",
  "accent-color",
  "column-rule",
  "column-rule-color",
]);

/**
 * كلمات لونية مسموحة — **ليست ألوانًا مكتوبة**.
 *
 * `transparent` و`currentColor` لا يثبّتان قيمة: الأولى غيابُ لون،
 * والثانية إحالةٌ إلى `color` المحيط الذي هو نفسه رمز ثيم.
 */
const COLOR_KEYWORDS_OK = new Set([
  "transparent",
  "currentcolor",
  "inherit",
  "initial",
  "unset",
  "revert",
  "none",
]);

/** أسماء ألوان CSS الـ١٤٨ — أخطر ما فات الكاشف القديم. */
const CSS_NAMED_COLORS = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond
   blue blueviolet brown burlywood cadetblue chartreuse chocolate coral
   cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray
   darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid
   darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey
   darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue
   firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod
   gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki
   lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
   lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon
   lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue
   lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue
   mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen
   mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
   navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod
   palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum
   powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon
   sandybrown seagreen seashell sienna silver skyblue slateblue slategray
   slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet
   wheat white whitesmoke yellow yellowgreen`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * **دوالّ تبني لونًا من أرقام** — وجودُها وحده لونٌ مكتوب يدويًا،
 * أيًّا كانت وسائطها: `lab(50% 40 59.5)` لا اسم فيه ولا هيكس ومع ذلك
 * هو لونٌ صريح. (`\bcolor\s*\(` لا يلتقط `color-mix(` لأن الشرطة
 * تفصل الاسم عن القوس.)
 */
const LITERAL_COLOR_FN =
  /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/i;

/**
 * **دوالّ تركّب من ألوانٍ أخرى** — مشروعةٌ ما دامت وسائطها رموزًا.
 * `color-mix(in srgb, var(--a) 88%, var(--b))` ليس لونًا مكتوبًا،
 * و`color-mix(in srgb, black 8%, transparent)` هو.
 */
const COMPOSITION_FN = /\b(?:color-mix|light-dark)\s*\(/i;

/** `#abc` و`#aabbcc` و`#aabbccdd`. */
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;

/**
 * هل في قيمة الخاصية لونٌ مكتوب يدويًا؟
 *
 * **`color-mix()` من رمزين ليست لونًا مكتوبًا** — وهي مستعملة بقصد
 * (`Button.svelte`: تعميق التعبئة عند التمرير). فتُزال `var(...)`
 * أولًا، ثم يُفتَّش ما بقي: هيكس، أو دالّة لونية بوسيطٍ حرفي، أو اسم
 * لونٍ من الـ١٤٨.
 */
function literalColorIn(value: string): string | null {
  // إزالة `var(--x)` و`var(--x, fallback)` — متداخلةً حتى تستقرّ
  let rest = value;
  for (let i = 0; i < 5; i++) {
    const next = rest.replace(/var\(\s*--[\w-]+\s*(?:,[^()]*)?\)/g, " ");
    if (next === rest) break;
    rest = next;
  }

  const hex = rest.match(HEX_COLOR);
  if (hex) return hex[0];

  // بانيةُ لونٍ من أرقام — لونٌ صريح مهما كانت وسائطها
  const built = rest.match(LITERAL_COLOR_FN);
  if (built) return built[0] + "…";

  // مركِّبةٌ بقيت بعد إزالة الرموز: يُفحَص ما بقي داخلها.
  // `color-mix(in srgb, «رمز» 88%, «رمز»)` تُصبح `color-mix(in srgb,  88%, )`
  // — بلا وسيطٍ لونيّ باقٍ، فهي مبنيّة على رموز وحدها.
  const composed = rest.match(COMPOSITION_FN);
  if (composed) {
    const inner = rest.slice(rest.indexOf(composed[0]) + composed[0].length);
    const literalInside =
      HEX_COLOR.test(inner) ||
      LITERAL_COLOR_FN.test(inner) ||
      inner
        .split(/[\s,()]+/)
        .some((w) => CSS_NAMED_COLORS.has(w.trim().toLowerCase()));
    if (literalInside) return composed[0] + "…";
  }

  for (const word of rest.split(/[\s,()/]+/)) {
    const w = word.trim().toLowerCase();
    if (!w || COLOR_KEYWORDS_OK.has(w)) continue;
    if (CSS_NAMED_COLORS.has(w)) return w;
  }
  return null;
}

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
      const offenders: string[] = [];
      readFileSync(full as string, "utf8")
        .split("\n")
        .forEach((raw, i) => {
          const line = raw.trim();
          // تعليقات الشرح قد تذكر قيمة، والذِكر ليس استخدامًا
          if (line.startsWith("*") || line.startsWith("//")) return;
          for (const d of line.matchAll(/([a-z-]+)\s*:\s*([^;]+)/gi)) {
            const prop = d[1]!.trim().toLowerCase();
            if (!COLOR_PROPS.has(prop)) continue;
            const found = literalColorIn(d[2]!);
            if (found) offenders.push(`${i + 1}: ${prop}: … «${found}»`);
          }
        });

      expect(
        offenders,
        "كل لون يجب أن يكون رمز ثيم — IMPLEMENTATION.md §١٧ مبدأ ٦",
      ).toEqual([]);
    },
  );
});

// ── ٢ · اكتمال الرموز — من CSS المشحون ───────────────────────

describe("اكتمال طبقة الرموز", () => {
  it("٢٤ دورًا لونيًا في خمسة ثيمات", () => {
    expect(COLOR_ROLES.length).toBe(24);
    expect(THEME_IDS.length).toBe(5);
  });

  it("لكل ثيم كتلةٌ في `tokens.css`", () => {
    expect([...THEME_CSS.keys()].sort()).toEqual([...THEME_IDS].sort());
  });

  /**
   * **كل دورٍ داخل كل كتلة** — لا `includes` في أي موضع.
   *
   * كان الفحص `css.includes("--text-muted:")` فيُشبعه ظهورُ الدور في
   * `:root` وحدها: دورٌ يسقط من كتل الثيمات الأربع يمرّ خضراء، ويرث
   * الثيمُ قيمةَ الافتراضي صامتًا. بندُ ب/١٤.
   */
  it("لا دور بلا قيمة في **كل كتلة ثيم** بالمشحون", () => {
    const missing: string[] = [];
    for (const theme of THEME_IDS) {
      for (const role of COLOR_ROLES) {
        const v = shipped(role, theme as string);
        if (!v || !/^#[0-9a-f]{6}$/i.test(v)) {
          missing.push(`${role}/${theme}${v ? ` = «${v}»` : " مفقود"}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  /** المخرَجان من مصدرٍ واحد، فافتراقهما يعني مولّدًا معطوبًا. */
  it("`themes.ts` يطابق `tokens.css` قيمةً بقيمة", () => {
    const drift: string[] = [];
    for (const theme of THEME_IDS) {
      for (const role of COLOR_ROLES) {
        const fromCss = shipped(role, theme as string);
        const fromTs = COLOR_VALUES[role]?.[theme as string];
        if (fromCss?.toLowerCase() !== fromTs?.toLowerCase()) {
          drift.push(`${role}/${theme}: css=${fromCss} ts=${fromTs}`);
        }
      }
    }
    expect(drift, "مخرَجا المولّد افترقا — أعِد `node src/tokens/generate.mjs`").toEqual(
      [],
    );
  });
});

// ── ٣ · التتبّع صفر على كل نمط يُشحن ─────────────────────────

describe("قواعد الطباعة العربية في الرموز", () => {
  it("كل صنف نمط نص يصرّح بتتبّع صفر", () => {
    const classes = [...TOKENS_CSS.matchAll(/\.t-([\w-]+)\s*\{([^}]*)\}/g)];
    expect(classes.length).toBeGreaterThan(10);
    for (const [, name, body] of classes) {
      expect(body, `.t-${name} بلا letter-spacing: 0`).toMatch(
        /letter-spacing:\s*0\b/,
      );
    }
  });

  it("لا نمط نص دون ١٢ نقطة", () => {
    const sizes = [...TOKENS_CSS.matchAll(/--text-[\w-]+:\s*\d+\s+(\d+)px/g)].map(
      (m) => Number(m[1]),
    );
    expect(sizes.length).toBeGreaterThan(10);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  });

  /**
   * **وعلى كل مكوّن يُشحن، لا أصناف `.t-*` وحدها** — بندُ ب/١٣.
   *
   * أصناف `.t-*` استعمالاتها كلها في `src/dev/Gallery.svelte` — أداةٌ
   * لا تُشحن. والمكوّنات تكتب `letter-spacing: 0` بأيديها في اثنين
   * وسبعين موضعًا، ولا شيء كان يفحص أن أحدها لم ينحرف.
   */
  it("لا `letter-spacing` غير صفر في أي ملف مشحون", () => {
    const shippedFiles = files(SRC, [".css", ".svelte"]).filter(
      (f) => !f.includes(`${SRC}/dev/`),
    );
    expect(shippedFiles.length).toBeGreaterThan(20);

    const offenders: string[] = [];
    for (const file of shippedFiles) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((raw, i) => {
          const line = raw.trim();
          if (line.startsWith("*") || line.startsWith("//")) return;
          for (const d of line.matchAll(/letter-spacing\s*:\s*([^;]+)/gi)) {
            const v = d[1]!.trim().toLowerCase();
            // `normal` مقبولة: العربية لا تُتبَّع افتراضيًا، وهي ما
            // يقيسه الفحص الذاتي داخل التطبيق (`trackingOk`).
            if (v === "normal" || parseFloat(v) === 0) continue;
            offenders.push(`${file.slice(SRC.length + 1)}:${i + 1} — «${v}»`);
          }
        });
    }
    expect(
      offenders,
      "التتبّع صفر على كل نص عربي — CLAUDE.md بند ٤ و`Luma.md` §١٦",
    ).toEqual([]);
  });
});

// ── ٣ب · لا متغيّر غير معرَّف ────────────────────────────────

describe("كل متغيّر مستخدَم معرَّف في طبقة الرموز", () => {
  // متغيّر غير معرَّف لا يرمي خطأ: تسقط القاعدة صامتةً فتنهار المقاسات
  // بلا أثر. هذا ما حدث فعلًا حين تغيّرت أسماء الرموز.
  const globals = readFileSync(join(SRC, "app.css"), "utf8");
  const defined = new Set(
    [...`${TOKENS_CSS}\n${globals}`.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]!),
  );

  const consumers = files(SRC, [".css", ".svelte"]).filter(
    (f) => f !== join(SRC, "tokens", "tokens.css"),
  );

  it.each(consumers.map((f) => [f.slice(SRC.length + 1), f]))(
    "%s لا يستهلك متغيّرًا غير معرَّف",
    (_rel, full) => {
      const text = readFileSync(full as string, "utf8");
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

/** أدنى نسبةٍ لزوجٍ عبر الثيمات الخمسة — **من المشحون**. */
function worstRatio(fg: string, bg: string): number {
  let min = Infinity;
  for (const t of THEME_IDS) {
    const a = shipped(fg, t as string);
    const b = shipped(bg, t as string);
    if (!a || !b) return NaN;
    min = Math.min(min, ratio(a, b));
  }
  return min;
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
 * أزواج تُرسم فعلًا ولا تُفرض — **بقرار مكتوب ونسبةٍ مثبَّتة**.
 *
 * كان الاستثناء بابًا ثمنه `why.length > 40`: ثلاثة وأربعون حرف «ا»
 * متطابقة تُرضيه، فيمرّ زوجٌ فاشل بنقله إلى هنا بلا أثر (بندُ ب/٢٠).
 * الآن يلزمه **تسجيل النسبة المقيسة**، ويؤكّد الحارس أن المقيس اليوم
 * يطابق المسجَّل: انحدارُ لونٍ يغيّر النسبة يُسقط البناء ولو بقي
 * الزوج مستثنًى، ونقلُ زوجٍ فاشل إلى هنا يفرض كتابة رقمه السيّئ عيانًا.
 */
const ACCEPTED: ReadonlyArray<{
  fg: string;
  bg: string;
  /** أدنى نسبة عبر الثيمات الخمسة، مقيسةً من `tokens.css` المشحون. */
  measured: number;
  why: string;
}> = [
  {
    fg: "border/control",
    bg: "surface/sunken",
    measured: 2.82,
    why:
      "الحافة الداخلية للحقل والمسار: ٢٫٨٢:١ على التعبئة الغائرة. " +
      "وWCAG 1.4.11 يطلب ٣:١ لما **يعرّف** العنصر، والذي يعرّفه هو حدّه " +
      "على السطح المحيط (٣٫١٩–٤٫٠١ — مفروضة أعلاه)، لا حافته على تعبئته.",
  },
  {
    fg: "text/on-accent",
    bg: "surface/paper",
    measured: 1.0,
    why:
      "صندوق خانة الاختيار **غير المحدَّدة**: يحمل لون العلامة استعدادًا " +
      "لها، ولا علامة تُرسم قبل التحديد (`{#if checked}`). وحين تُرسم " +
      "تكون التعبئة `accent/graphic` — وذاك الزوج مفروض أعلاه. أثرُ " +
      "قراءةٍ ساكنة للقاعدة، لا زوجٌ يقع على الشاشة. والنسبة ١٫٠٠ لأن " +
      "الرمزين متطابقان في الثيمات الخمسة — لا لأن التباين انحدر.",
  },
  {
    fg: "text/on-accent",
    bg: "state/critical",
    measured: 5.28,
    why:
      "الزر المتلف: نصّ فوق تعبئة `state/critical`. لا إجراء متلفًا في " +
      "Luma («لا حذف» — `Luma.md` §٦)، والمكوّن غير مستعمل في أي شاشة. " +
      "والنسبة تجتاز ٤٫٥ فعلًا؛ الاستثناء لعدم الاستعمال لا لقصور التباين.",
  },
];

/**
 * أزواج خلفيتها **مزيج رموز** لا رمزًا مفردًا — تُسجَّل ولا تُهمَل.
 *
 * `color-mix(in srgb, var(--a) 88%, var(--b))` لا يطابق اشتقاق الأزواج
 * (يبحث عن `background: var(--x)`)، فكان يُقفَز **بصمت**. تسجيله هنا
 * بنسبته المحسوبة يجعل القرار مرئيًا: خلفيةٌ مبنيّة على رموز، ونسبةٌ
 * تُقاس بمزجها فعليًّا لا بأحد طرفيها.
 */
const BLENDED: ReadonlyArray<{
  fg: string;
  mix: [string, number, string];
  min: number;
  where: string;
  why: string;
}> = [
  {
    fg: "text/on-accent",
    mix: ["accent/text", 0.88, "text/primary"],
    min: 4.5,
    where: "components/Button.svelte — `.primary:hover`",
    why:
      "التمرير يُعمّق التعبئة نحو `text/primary`، وهو نقيض " +
      "`text/on-accent` في كل ثيم، فالتباين يزيد ولا ينقص.",
  },
];

/** مزجٌ خطّي في sRGB — تقريب `color-mix(in srgb, a p%, b)`. */
function mixSrgb(a: string, b: string, pa: number): string {
  const parse = (h: string) =>
    [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16));
  const [ra, ga, ba] = parse(a) as [number, number, number];
  const [rb, gb, bb] = parse(b) as [number, number, number];
  const c = [ra * pa + rb * (1 - pa), ga * pa + gb * (1 - pa), ba * pa + bb * (1 - pa)];
  return "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

/**
 * حارس الاكتمال — **يشتقّ الأزواج من الكود لا من قائمة يدوية**.
 *
 * §١٥: «فحص تباين آلي لكل زوج رمز». وقائمةٌ يكتبها إنسان تنسى، وقد
 * نسيت: `accent/graphic` تعبئةً خلف نص الزر الأساسي عند التمرير
 * (٣٫٦٠:١) بقيت سنةً خارج الفحص.
 *
 * **ولا قفزَ صامت بعد اليوم** (بندُ ب/٢٠): متغيّرٌ وسيط
 * (`--row-bg: var(--state-critical-bg)`) يُحلّ مستوًى واحدًا، وما
 * تعذّر حلّه يُبلَّغ عنه بدل أن يُهمَل — فقد جرّبته المراجعة فمرّ
 * `text/muted` على `state/critical-bg` وهو ٤٫٢٥ في أربعة ثيمات.
 */
describe("لا زوج مرسوم خارج الفحص", () => {
  const guarded = new Set([
    ...PAIRS.map(([fg, bg]) => `${fg}|${bg}`),
    ...ACCEPTED.map((a) => `${a.fg}|${a.bg}`),
  ]);

  /** يحلّ `var(--x)` إلى دورٍ، عبر متغيّرات الملف المحلّية مستوًى واحدًا. */
  function resolveRole(
    varName: string,
    locals: Map<string, string>,
  ): string | null {
    const direct = ROLE_OF.get(varName);
    if (direct) return direct;
    const local = locals.get(varName);
    if (!local) return null;
    const inner = local.match(/var\(\s*(--[\w-]+)/);
    if (!inner) return null;
    return ROLE_OF.get(inner[1]!) ?? null;
  }

  const scanned = files(SRC, [".css", ".svelte"]);

  it("كل قاعدة تضبط اللون والخلفية معًا زوجُها مفروض", () => {
    const unguarded = new Set<string>();
    const unresolved = new Set<string>();

    for (const file of scanned) {
      const text = readFileSync(file, "utf8");
      const rel = file.slice(SRC.length + 1);
      // متغيّرات يعرّفها الملف نفسه — مصدرُ الوساطة
      const locals = new Map(
        [...text.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map((m) => [
          m[1]!,
          m[2]!.trim(),
        ]),
      );

      for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
        const body = m[1] ?? "";
        const fg = body.match(/(?:^|[;\s])color:\s*([^;]+)/);
        const bg = body.match(/(?:^|[;\s])background(?:-color)?:\s*([^;]+)/);
        if (!fg || !bg) continue;

        const fgVar = fg[1]!.match(/var\(\s*(--[\w-]+)/);
        const bgVar = bg[1]!.match(/var\(\s*(--[\w-]+)/);

        // خلفية مزيجٌ من رموز — تُسجَّل في `BLENDED` لا تُقفَز
        if (/color-mix|light-dark/i.test(bg[1]!)) {
          const a = fgVar ? resolveRole(fgVar[1]!, locals) : null;
          const known = BLENDED.some((x) => x.fg === a);
          if (!known) unresolved.add(`${rel}: خلفية مزيج غير مسجَّلة — ${bg[1]!.trim()}`);
          continue;
        }

        if (!fgVar || !bgVar) continue; // كلمة مفتاحية (`transparent`/`inherit`)
        const a = resolveRole(fgVar[1]!, locals);
        const b = resolveRole(bgVar[1]!, locals);

        if (!a || !b) {
          unresolved.add(
            `${rel}: ${!a ? fgVar[1] : bgVar[1]} لا يُحَلّ إلى رمز ثيم`,
          );
          continue;
        }
        if (!guarded.has(`${a}|${b}`)) {
          unguarded.add(`${a} على ${b}  ‹${rel}›`);
        }
      }
    }

    expect(
      [...unresolved],
      "زوجٌ تعذّر حلّه — لا يُقفَز بصمت: اربطه برمز ثيم أو سجّله في BLENDED",
    ).toEqual([]);
    expect(
      [...unguarded],
      "زوج يُرسم ولا يُفحص — أضِفه إلى PAIRS أو إلى ACCEPTED بسببه",
    ).toEqual([]);
  });

  it("كل استثناء يحمل سببًا مكتوبًا ونسبةً تطابق المقيس اليوم", () => {
    for (const { fg, bg, measured, why } of ACCEPTED) {
      expect(shipped(fg, THEME_IDS[0] as string), `${fg} ليس رمزًا`).toBeDefined();
      expect(shipped(bg, THEME_IDS[0] as string), `${bg} ليس رمزًا`).toBeDefined();
      expect(why.length, `${fg}/${bg} بلا سبب`).toBeGreaterThan(40);

      const actual = worstRatio(fg, bg);
      expect(
        actual,
        `${fg}/${bg}: النسبة المسجَّلة ${measured} والمقيس ${actual.toFixed(2)} — ` +
          "استثناءٌ لا يُقبل إلا برقمه الصادق",
      ).toBeCloseTo(measured, 1);
    }
  });

  it("كل خلفية مزيج تجتاز حدّها فعليًّا", () => {
    const failures: string[] = [];
    for (const { fg, mix, min, where, why } of BLENDED) {
      const [ma, pa, mb] = mix;
      for (const t of THEME_IDS) {
        const f = shipped(fg, t as string);
        const a = shipped(ma, t as string);
        const b = shipped(mb, t as string);
        if (!f || !a || !b) {
          failures.push(`${where}: رمزٌ مفقود في ${t}`);
          continue;
        }
        const r = ratio(f, mixSrgb(a, b, pa));
        if (r < min) {
          failures.push(`${where} (${t}): ${r.toFixed(2)} < ${min} — ${why}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("تباين الرموز في الثيمات الخمسة", () => {
  it.each(THEME_IDS.map((t) => [t]))("ثيم %s يجتاز كل الأزواج", (themeId) => {
    const failures: string[] = [];
    for (const [fg, bg, min, why] of PAIRS) {
      // **من `tokens.css` المشحون** لا من `themes.ts` — بندُ ب/١٤
      const a = shipped(fg, themeId as string);
      const b = shipped(bg, themeId as string);
      if (!a || !b) {
        failures.push(`${fg} أو ${bg} مفقود في كتلة ${themeId}`);
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
