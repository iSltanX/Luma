/**
 * الطباعة (تصدير PDF) تفرض الورق الأبيض دائمًا — بصرف النظر عن ثيم
 * الشاشة النشط (`docs/decisions/0020-export.md`، قرار المنتج ٤).
 *
 * **لا لون جديد يُكتب هنا.** الآلية نفسها التي يملكها `theme.svelte.ts`
 * للثيم الافتراضي: غياب `data-theme` يعني الثيم المضيء المعرَّف على
 * `:root` نفسه في `tokens.css`. فإزالة السمة وقت الطباعة تكفي وحدها،
 * وإعادتها بعدها تُبقي شاشة المستخدم كما كانت تمامًا — دون أن يمسّ
 * هذا الملف حالة `theme` التفاعلية (`#id`)، فلا وميض في أي لوحة
 * ثيم مفتوحة أثناء الطباعة.
 *
 * `beforeprint`/`afterprint` حدثان قياسيان يُطلقهما محرّك الرسم نفسه
 * عند الطباعة — بصرف النظر عن كيفية استدعائها: `window.print()` أو
 * لوحة النظام الأصلية عبر Tauri (`WebviewWindow::print()`). فلا حاجة
 * لربط هذا بمسار تصدير PDF تحديدًا؛ أي طباعة تمرّ به.
 */

type PrintableRoot = Pick<HTMLElement, "getAttribute" | "setAttribute" | "removeAttribute">;
type PrintTarget = Pick<Window, "addEventListener" | "removeEventListener">;

/** يُبطل الثيم النشط على `root` فورًا، ويعيد دالّة تستعيده كما كان. */
export function suspendThemeForPrint(root: PrintableRoot): () => void {
  const saved = root.getAttribute("data-theme");
  root.removeAttribute("data-theme");
  return () => {
    if (saved !== null) root.setAttribute("data-theme", saved);
  };
}

/**
 * يربط `beforeprint`/`afterprint` بتعليق الثيم واستعادته على `root`.
 * تعيد دالّة فكّ الربط — لا حاجة لها في `main.ts` إذ يعيش الربط طوال
 * عمر التطبيق، لكنها موجودة لسلامة الاختبار وأي استعمال آخر لاحق.
 */
export function installPrintThemeGuard(root: PrintableRoot, target: PrintTarget): () => void {
  let restore: (() => void) | null = null;

  const onBeforePrint = () => {
    restore = suspendThemeForPrint(root);
  };
  const onAfterPrint = () => {
    restore?.();
    restore = null;
  };

  target.addEventListener("beforeprint", onBeforePrint);
  target.addEventListener("afterprint", onAfterPrint);

  return () => {
    target.removeEventListener("beforeprint", onBeforePrint);
    target.removeEventListener("afterprint", onAfterPrint);
  };
}
