/**
 * تطبيق الثيم — `IMPLEMENTATION.md` §٩ **ثابت**.
 *
 * «الثيم بيانات لا كود موزَّع. تُحمَّل خمس لوحات، وتُختار بـ`themeId`.»
 *
 * التطبيق سمة واحدة على جذر المستند، فتقلب الشجرة كلها في خطوة واحدة.
 * **لا يُعاد بناء شيء، فلا يُفقد موضع تمرير ولا مؤشر** — §١٤.
 */

import { DEFAULT_THEME, isThemeId, type ThemeId } from "../tokens/themes";

class ThemeStore {
  #id = $state<ThemeId>(DEFAULT_THEME);
  /** لا يُحفظ التفضيل قبل قراءته، وإلا كُتب الافتراضي فوق اختيار المستخدم. */
  #loaded = $state(false);

  get id(): ThemeId {
    return this.#id;
  }

  get loaded(): boolean {
    return this.#loaded;
  }

  /**
   * يطبّق الثيم فورًا.
   *
   * الافتراضي معرَّف على `:root` نفسه، فلا يحتاج سمة — وهذا ما يمنع
   * وميضًا قبل قراءة التفضيل.
   */
  apply(id: ThemeId): void {
    this.#id = id;
    const root = document.documentElement;
    if (id === DEFAULT_THEME) root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", id);
  }

  /** يقرأ التفضيل المحفوظ. قيمة غير معروفة تعود إلى الافتراضي. */
  hydrate(stored: unknown): void {
    if (isThemeId(stored)) this.apply(stored);
    this.#loaded = true;
  }
}

export const theme = new ThemeStore();
