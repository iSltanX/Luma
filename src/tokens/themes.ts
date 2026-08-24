/* ملف مولَّد — لا يُحرَّر يدويًا.
 * المصدر: src/tokens/source.json (مستخرج من متغيّرات Figma 7CDWsUiMz0xae1CRwvpmPY)
 * التوليد: node src/tokens/generate.mjs
 */

export const THEMES = [
  {
    "id": "paper",
    "name": "ورق · Paper"
  },
  {
    "id": "mist",
    "name": "ضباب · Mist"
  },
  {
    "id": "sage",
    "name": "مريمية · Sage"
  },
  {
    "id": "lavender",
    "name": "خزامى · Lavender"
  },
  {
    "id": "midnight",
    "name": "ليل · Midnight"
  }
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const THEME_IDS: readonly ThemeId[] = [
  "paper",
  "mist",
  "sage",
  "lavender",
  "midnight",
];

export const DEFAULT_THEME: ThemeId = "paper";

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === "string" && (THEME_IDS as readonly string[]).includes(v);
}

/** أدوار الألوان — تُستخدم في فحص التباين والمعرض. */
export const COLOR_ROLES = [
  "surface/paper",
  "surface/canvas",
  "surface/raised",
  "surface/sunken",
  "border/subtle",
  "border/strong",
  "border/control",
  "text/primary",
  "text/secondary",
  "text/muted",
  "text/on-accent",
  "editor/ink",
  "accent/graphic",
  "accent/text",
  "accent/subtle",
  "accent/selection",
  "state/positive",
  "state/positive-bg",
  "state/caution",
  "state/caution-bg",
  "state/critical",
  "state/critical-bg",
  "state/info",
  "state/info-bg"
] as const;

/** القيم لكل ثيم — للفحص الآلي، لا للتلوين. التلوين من CSS. */
export const COLOR_VALUES: Record<string, Record<string, string>> =
{
  "surface/paper": {
    "paper": "#fffbf3",
    "mist": "#f7fdff",
    "sage": "#f9fef9",
    "lavender": "#fdfbff",
    "midnight": "#191d24"
  },
  "surface/canvas": {
    "paper": "#fcf5ed",
    "mist": "#f1f7fb",
    "sage": "#f3f8f3",
    "lavender": "#f7f5fb",
    "midnight": "#13161c"
  },
  "surface/raised": {
    "paper": "#f5eee6",
    "mist": "#eaf0f4",
    "sage": "#ecf1ec",
    "lavender": "#f0eef4",
    "midnight": "#212630"
  },
  "surface/sunken": {
    "paper": "#eee7df",
    "mist": "#e3e9ed",
    "sage": "#e5eae5",
    "lavender": "#e9e7ed",
    "midnight": "#0d1014"
  },
  "border/subtle": {
    "paper": "#e3dcd4",
    "mist": "#d8dee2",
    "sage": "#dadfda",
    "lavender": "#dedce2",
    "midnight": "#2c313b"
  },
  "border/strong": {
    "paper": "#ccc5bd",
    "mist": "#c1c7cb",
    "sage": "#c3c7c3",
    "lavender": "#c7c5cb",
    "midnight": "#434a57"
  },
  "border/control": {
    "paper": "#968877",
    "mist": "#7f8c94",
    "sage": "#848c84",
    "lavender": "#8c8894",
    "midnight": "#6f7784"
  },
  "text/primary": {
    "paper": "#2b241c",
    "mist": "#202629",
    "sage": "#222722",
    "lavender": "#26242a",
    "midnight": "#e3e7ee"
  },
  "text/secondary": {
    "paper": "#534b43",
    "mist": "#464d51",
    "sage": "#494e49",
    "lavender": "#4e4b52",
    "midnight": "#a9b1bd"
  },
  "text/muted": {
    "paper": "#6e665d",
    "mist": "#61686c",
    "sage": "#646964",
    "lavender": "#69666d",
    "midnight": "#8a929e"
  },
  "text/on-accent": {
    "paper": "#fffbf3",
    "mist": "#f7fdff",
    "sage": "#f9fef9",
    "lavender": "#fdfbff",
    "midnight": "#191d24"
  },
  "editor/ink": {
    "paper": "#2b241c",
    "mist": "#202629",
    "sage": "#222722",
    "lavender": "#26242a",
    "midnight": "#d4dae2"
  },
  "accent/graphic": {
    "paper": "#b67642",
    "mist": "#4d8bab",
    "sage": "#648e6c",
    "lavender": "#917bab",
    "midnight": "#a8703c"
  },
  "accent/text": {
    "paper": "#905522",
    "mist": "#2e6b89",
    "sage": "#456e4e",
    "lavender": "#705b88",
    "midnight": "#c08553"
  },
  "accent/subtle": {
    "paper": "#fbddc8",
    "mist": "#cfe8f7",
    "sage": "#d7eada",
    "lavender": "#e9dff5",
    "midnight": "#2c2015"
  },
  "accent/selection": {
    "paper": "#f7d3b6",
    "mist": "#bcdff5",
    "sage": "#c6e3cb",
    "lavender": "#ded1ef",
    "midnight": "#3c2c1c"
  },
  "state/positive": {
    "paper": "#416b4a",
    "mist": "#416b4a",
    "sage": "#416b4a",
    "lavender": "#416b4a",
    "midnight": "#6d9a76"
  },
  "state/positive-bg": {
    "paper": "#d2e5d5",
    "mist": "#d2e5d5",
    "sage": "#d2e5d5",
    "lavender": "#d2e5d5",
    "midnight": "#1a2a1f"
  },
  "state/caution": {
    "paper": "#815b1d",
    "mist": "#815b1d",
    "sage": "#815b1d",
    "lavender": "#815b1d",
    "midnight": "#b08a4c"
  },
  "state/caution-bg": {
    "paper": "#f0dec5",
    "mist": "#f0dec6",
    "sage": "#f0dec6",
    "lavender": "#f0ddc5",
    "midnight": "#2f2614"
  },
  "state/critical": {
    "paper": "#974d44",
    "mist": "#974d44",
    "sage": "#974d44",
    "lavender": "#974d44",
    "midnight": "#cb7a70"
  },
  "state/critical-bg": {
    "paper": "#fdd8d2",
    "mist": "#fdd8d3",
    "sage": "#fdd8d3",
    "lavender": "#fdd8d2",
    "midnight": "#33211f"
  },
  "state/info": {
    "paper": "#386787",
    "mist": "#386787",
    "sage": "#386787",
    "lavender": "#386787",
    "midnight": "#6796b8"
  },
  "state/info-bg": {
    "paper": "#cfe3f2",
    "mist": "#cfe3f2",
    "sage": "#cfe3f2",
    "lavender": "#cfe3f2",
    "midnight": "#182935"
  }
};
