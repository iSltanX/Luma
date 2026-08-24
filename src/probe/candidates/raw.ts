/**
 * مرشح ٣ — مساحة تحرير خام (`contenteditable`).
 *
 * الفرضية المضادة: أبسط ما يمكن. يُقاس ليُعرف ما الذي تشتريه الأطر فعلًا،
 * لا ليفوز. كل قدرة لا يوفّرها الأساس هنا تعني كودًا مكتوبًا يدويًا —
 * وذلك بنفسه سبب إسقاط وفق `IMPLEMENTATION.md` §١.
 */

import type { Block, EditorCandidate, CapabilityReport } from "../types";

const TAG_FOR_ROLE = { body: "p", h1: "h1", h2: "h2" } as const;
const ROLE_FOR_TAG: Record<string, Block["role"]> = {
  P: "body",
  H1: "h1",
  H2: "h2",
  DIV: "body",
};

export class RawCandidate implements EditorCandidate {
  readonly id = "raw";
  readonly name = "تحرير خام · contenteditable";
  readonly capabilities: CapabilityReport = {
    // مستطيل المؤشر متاح عبر Range، لكن بلا تجريد فوق النموذج.
    caretRect: true,
    // لا طبقة عرض: أي تخفيت يعني لمس DOM الذي هو نفسه النموذج.
    focusDecorations: false,
    arabicDirection: true,
    // التراجع من المتصفح، بلا تحكم في التجميع ولا في نطاقه.
    undoGrouping: false,
    incrementalLayout: true,
  };

  readonly undoGroupingIsConfigurable = false; // تجميع المتصفح، بلا تحكم

  private host: HTMLElement | null = null;
  private el: HTMLElement | null = null;

  mount(host: HTMLElement, initial: Block[]): void {
    this.host = host;
    const el = document.createElement("div");
    el.contentEditable = "true";
    el.dir = "rtl";
    el.className = "luma-editor";
    el.setAttribute("role", "textbox");
    el.setAttribute("aria-multiline", "true");
    el.setAttribute("aria-label", "مساحة الكتابة");
    el.spellcheck = false;

    for (const b of initial) {
      const node = document.createElement(TAG_FOR_ROLE[b.role]);
      node.dir = "rtl";
      node.textContent = b.text;
      el.appendChild(node);
    }

    host.appendChild(el);
    this.el = el;
  }

  destroy(): void {
    if (this.el && this.host) this.host.removeChild(this.el);
    this.el = null;
    this.host = null;
  }

  getBlocks(): Block[] {
    if (!this.el) return [];
    return Array.from(this.el.children).map((child, i) => ({
      id: `b${i + 1}`,
      role: ROLE_FOR_TAG[child.tagName] ?? "body",
      text: child.textContent ?? "",
      marks: [],
    }));
  }

  focus(): void {
    this.el?.focus();
  }

  caretRect(): DOMRect | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0).cloneRange();
    const rects = range.getClientRects();
    if (rects.length > 0) return rects[0] as DOMRect;
    // مؤشر مطوي في عنصر فارغ: لا مستطيل. يلزم عنصر مؤقت — كود يدوي.
    const probe = document.createElement("span");
    probe.textContent = "​";
    range.insertNode(probe);
    const r = probe.getBoundingClientRect();
    probe.remove();
    return r;
  }

  /**
   * القدرة ٢ غير متوفرة: لا طبقة عرض منفصلة.
   * التخفيت هنا يكتب أصنافًا في DOM نفسه — أي في النموذج —
   * وهو ما تمنعه `IMPLEMENTATION.md` §٧ صراحةً.
   */
  setFocusMode(enabled: boolean): void {
    if (!this.el) return;
    const sel = window.getSelection();
    const anchor = sel?.anchorNode;
    for (const child of Array.from(this.el.children)) {
      const active = !!anchor && child.contains(anchor);
      child.classList.toggle("luma-dimmed", enabled && !active);
    }
  }

  undoDepth(): number {
    // المتصفح لا يكشف عمق مكدس التراجع.
    return -1;
  }

  undo(): void {
    document.execCommand("undo");
  }

  /**
   * لا نموذج منفصل: الـDOM هو المحتوى.
   * لذلك أي صنف تخفيت يُكتب هنا يغيّر البصمة — وهو الدليل على
   * غياب طبقة العرض، لا مجرد رأي معماري.
   */
  modelSignature(): string {
    return this.el?.innerHTML ?? "";
  }
}
