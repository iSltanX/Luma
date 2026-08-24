/**
 * التفضيلات — `IMPLEMENTATION.md` §٣ و`Luma.md` §١٥.
 *
 * «تُطبَّق التغييرات وتُحفظ فورًا؛ لا زر «حفظ الإعدادات».» ولذلك لا
 * حالة «معلَّقة» هنا: كل تغيير يُطبَّق على الشجرة في اللحظة، ثم يُكتب
 * إلى القرص بتجميع قصير حتى لا يكتب المنزلقُ ملفًّا مع كل بكسل.
 *
 * **لا تمسّ المحتوى المخزَّن** — §١٧ مبدأ ٣. كل ما تفعله هذه الوحدة
 * ضبط متغيّرات CSS على جذر المستند.
 */

import { DEFAULT_THEME, isThemeId, type ThemeId } from "../tokens/themes";

/** خط الكتابة المدمج — أساس سلسلة الرجوع الآمن (§٨). */
export const FALLBACK_FAMILY = "Almarai";

/** الحدود من `IMPLEMENTATION.md` §٣ — لا تُخمَّن في الواجهة. */
export const LIMITS = {
  fontSize: { min: 14, max: 26, step: 1 },
  lineHeight: { min: 1.4, max: 2.2, step: 0.1 },
  columnWidth: { min: 520, max: 800, step: 20 },
} as const;

export interface Preferences {
  themeId: ThemeId;
  /** اسم عائلة خط الكتابة. Cairo خط الواجهة ولا يدخل هنا — §١١ **ثابت**. */
  fontFamily: string;
  fontSource: "bundled" | "system" | "imported";
  fontSize: number;
  lineHeight: number;
  columnWidth: number;
  showWordCount: boolean;
  typewriterEnabled: boolean;
  focusEnabled: boolean;
  zenEnabled: boolean;
  reduceMotionOverride: boolean;
}

/**
 * الافتراضات.
 *
 * «الوضع الافتراضي يجمع الآلة الكاتبة والتركيز» — `Luma.md` §٧، فـZen
 * وحده مطفأ. وعدّاد الكلمات مخفي — §٥ **ثابت**.
 */
export const DEFAULTS: Preferences = {
  themeId: DEFAULT_THEME,
  fontFamily: FALLBACK_FAMILY,
  fontSource: "bundled",
  fontSize: 19,
  lineHeight: 1.9,
  columnWidth: 800,
  showWordCount: false,
  typewriterEnabled: true,
  focusEnabled: true,
  zenEnabled: false,
  reduceMotionOverride: false,
};

function clamp(v: unknown, { min, max }: { min: number; max: number }, fallback: number) {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/**
 * يقرأ قيمة حرّة من القرص إلى تفضيلات صالحة.
 *
 * كل حقل يُصحَّح إلى مداه: ملف تفضيلات محرَّر يدويًا أو من إصدار أقدم
 * لا يجوز أن يعطي حجم خط ٢٠٠ ولا عمودًا بعرض صفر.
 */
export function coerce(raw: unknown): Preferences {
  const v = (raw ?? {}) as Record<string, unknown>;
  const source = v["fontSource"];
  return {
    themeId: isThemeId(v["themeId"]) ? v["themeId"] : DEFAULTS.themeId,
    fontFamily:
      typeof v["fontFamily"] === "string" && v["fontFamily"].trim()
        ? v["fontFamily"]
        : DEFAULTS.fontFamily,
    fontSource:
      source === "system" || source === "imported" || source === "bundled"
        ? source
        : DEFAULTS.fontSource,
    fontSize: Math.round(clamp(v["fontSize"], LIMITS.fontSize, DEFAULTS.fontSize)),
    lineHeight:
      Math.round(clamp(v["lineHeight"], LIMITS.lineHeight, DEFAULTS.lineHeight) * 10) / 10,
    columnWidth: Math.round(
      clamp(v["columnWidth"], LIMITS.columnWidth, DEFAULTS.columnWidth),
    ),
    showWordCount: bool(v["showWordCount"], DEFAULTS.showWordCount),
    typewriterEnabled: bool(v["typewriterEnabled"], DEFAULTS.typewriterEnabled),
    focusEnabled: bool(v["focusEnabled"], DEFAULTS.focusEnabled),
    zenEnabled: bool(v["zenEnabled"], DEFAULTS.zenEnabled),
    reduceMotionOverride: bool(v["reduceMotionOverride"], DEFAULTS.reduceMotionOverride),
  };
}

/**
 * سلسلة خطوط المحرر — **هي سلسلة الرجوع الآمن** في §٨.
 *
 * الخط المختار أولًا وAlmarai بعده، فما لا يغطّيه المختار من نطاقات
 * عربية يرسمه المتصفح بـAlmarai. لا كود يتدخّل ولا تبديل يدوي: هذا ما
 * تفعله سلسلة `font-family` أصلًا، وهو أدقّ من أي بديل لأنه يعمل على
 * مستوى المِحرف لا على مستوى المستند.
 */
export function fontStack(family: string): string {
  const chosen = family.trim();
  if (!chosen || chosen === FALLBACK_FAMILY) {
    return `"${FALLBACK_FAMILY}", system-ui, sans-serif`;
  }
  return `"${chosen}", "${FALLBACK_FAMILY}", system-ui, sans-serif`;
}

/** يُطبّق تفضيلات العرض على جذر المستند. */
export function applyToRoot(p: Preferences, root: HTMLElement): void {
  const s = root.style;
  s.setProperty("--luma-editor-family", fontStack(p.fontFamily));
  s.setProperty("--luma-editor-size", `${p.fontSize}px`);
  s.setProperty("--luma-editor-leading", String(p.lineHeight));
  s.setProperty("--editor-measure", `${p.columnWidth}px`);
  // تقليل الحركة: تفضيل المستخدم يُضاف إلى تفضيل النظام ولا يلغيه.
  // القاعدة في `app.css` تقرأ السمة، والاستعلام يبقى عاملًا معها.
  if (p.reduceMotionOverride) root.dataset["reduceMotion"] = "on";
  else delete root.dataset["reduceMotion"];
}

/** مهلة تجميع كتابة التفضيلات — المنزلق لا يكتب ملفًّا مع كل بكسل. */
const WRITE_DEBOUNCE_MS = 300;

type Writer = (value: Preferences) => void;

/**
 * مخزن التفضيلات التفاعلي.
 *
 * يملك القيم، ويطبّقها على الشجرة عند كل تغيير، ويجدول الكتابة.
 * الثيم يبقى في `theme.svelte.ts` لأنه يُطبَّق بسمة لا بمتغيّر، وهذه
 * الوحدة تحفظ معرّفه فقط.
 */
export class PreferencesStore {
  #value = $state<Preferences>({ ...DEFAULTS });
  #write: Writer | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #root: HTMLElement | null = null;

  get value(): Preferences {
    return this.#value;
  }

  /** يربط المخزن بالقرص وبجذر المستند، ويطبّق ما قُرئ فورًا. */
  hydrate(raw: unknown, root: HTMLElement, write: Writer): void {
    this.#root = root;
    this.#write = write;
    this.#value = coerce(raw);
    applyToRoot(this.#value, root);
  }

  /**
   * يغيّر حقلًا: يُطبَّق فورًا ويُحفظ بعده.
   *
   * الترتيب مقصود — المستخدم يرى الأثر قبل أن يلمس القرصُ شيئًا.
   * «ويظهر أثر إعدادات العرض مباشرة حيث أمكن» §١٥.
   */
  set<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
    if (this.#value[key] === value) return;
    this.#value = { ...this.#value, [key]: value };
    if (this.#root) applyToRoot(this.#value, this.#root);
    this.#schedule();
  }

  /** يعيد الخط إلى Almarai — حين يغيب المختار أو تنقص تغطيته. */
  fallBackToBundled(): void {
    this.set("fontFamily", FALLBACK_FAMILY);
    this.set("fontSource", "bundled");
  }

  #schedule(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#write?.(this.#value);
    }, WRITE_DEBOUNCE_MS);
  }

  /** كتابة فورية — عند إغلاق النافذة. */
  flush(): void {
    if (!this.#timer) return;
    clearTimeout(this.#timer);
    this.#timer = null;
    this.#write?.(this.#value);
  }
}

export const preferences = new PreferencesStore();
