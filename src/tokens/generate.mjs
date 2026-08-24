/**
 * مولّد طبقة الرموز — `IMPLEMENTATION.md` §٩ **ثابت**.
 *
 * «الثيم بيانات لا كود موزَّع… ولا يُكتب لون واحد يدويًا في الواجهة.»
 *
 * المصدر الوحيد `source.json`، مستخرج من متغيّرات Figma. هذا المولّد
 * يُنتج `tokens.css` و`themes.ts`، ومخرجاته **لا تُحرَّر يدويًا**.
 *
 *   node src/tokens/generate.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = JSON.parse(readFileSync(join(here, "source.json"), "utf8"));

/** `surface/paper` → `--surface-paper` */
const cssVar = (role) => `--${role.replace(/\//g, "-")}`;

const BANNER = `/* ملف مولَّد — لا يُحرَّر يدويًا.
 * المصدر: src/tokens/source.json (مستخرج من متغيّرات Figma ${src.figmaFile})
 * التوليد: node src/tokens/generate.mjs
 */`;

function colorsFor(themeId) {
  return Object.entries(src.colors)
    .map(([role, byTheme]) => `  ${cssVar(role)}: ${byTheme[themeId]};`)
    .join("\n");
}

const themeIds = src.themes.map((t) => t.id);
const [base, ...rest] = themeIds;

let css = `${BANNER}\n\n`;

// الثيم الافتراضي على :root، فلا وميض قبل تطبيق التفضيل.
css += `:root {\n${colorsFor(base)}\n}\n\n`;

for (const id of rest) {
  css += `[data-theme="${id}"] {\n${colorsFor(id)}\n}\n\n`;
}

// المسافات وأنصاف الأقطار والمقاسات — وضع واحد، لا تتغيّر بالثيم.
css += `:root {\n`;
for (const [k, v] of Object.entries(src.space)) css += `  --space-${k}: ${v}px;\n`;
css += `\n`;
for (const [k, v] of Object.entries(src.radius)) {
  css += `  --radius-${k}: ${k === "full" ? "9999px" : `${v}px`};\n`;
}
css += `\n`;
for (const [k, v] of Object.entries(src.size)) css += `  --size-${k}: ${v}px;\n`;
css += `}\n\n`;

// أنماط النص. التتبّع صفر على كل نمط يُشحن — قاعدة عربية لا تفضيل.
css += `:root {\n`;
for (const [name, [family, , weight, size, lh]] of Object.entries(src.text)) {
  css += `  --text-${name}: ${weight} ${size}px/${lh}px "${family}", system-ui, sans-serif;\n`;
}
css += `}\n\n`;

css += `/* أصناف جاهزة لأنماط النص — التتبّع صفر دائمًا */\n`;
for (const name of Object.keys(src.text)) {
  css += `.t-${name} { font: var(--text-${name}); letter-spacing: 0; }\n`;
}

writeFileSync(join(here, "tokens.css"), css);

// ── themes.ts ─────────────────────────────────────────────────
const ts = `${BANNER.replace(/^\/\* /, "/* ").trim()}

export const THEMES = ${JSON.stringify(src.themes, null, 2)} as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const THEME_IDS: readonly ThemeId[] = [
${themeIds.map((id) => `  "${id}",`).join("\n")}
];

export const DEFAULT_THEME: ThemeId = "${base}";

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === "string" && (THEME_IDS as readonly string[]).includes(v);
}

/** أدوار الألوان — تُستخدم في فحص التباين والمعرض. */
export const COLOR_ROLES = ${JSON.stringify(Object.keys(src.colors), null, 2)} as const;

/** القيم لكل ثيم — للفحص الآلي، لا للتلوين. التلوين من CSS. */
export const COLOR_VALUES: Record<string, Record<string, string>> =
${JSON.stringify(src.colors, null, 2)};
`;
writeFileSync(join(here, "themes.ts"), ts);

console.log(
  `✓ tokens.css و themes.ts — ${Object.keys(src.colors).length} لونًا × ${themeIds.length} ثيمات`,
);
