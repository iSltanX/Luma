/**
 * مرشح ٢ — محرر ذو نموذج شجري (Lexical).
 *
 * الفرضية: نموذج شجري خاص به مع محرّر حالة معاملاتي، وسجل تراجع
 * بتجميع زمني، وطبقة `NodeSelection`/`theme` للتخفيت.
 */

import {
  createEditor,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $createTextNode,
  ParagraphNode,
  TextNode,
  UNDO_COMMAND,
  type LexicalEditor,
} from "lexical";
import { registerHistory, createEmptyHistoryState } from "@lexical/history";
import {
  HeadingNode,
  $createHeadingNode,
  $isHeadingNode,
  registerRichText,
} from "@lexical/rich-text";

import type { Block, EditorCandidate, CapabilityReport } from "../types";

export class LexicalCandidate implements EditorCandidate {
  readonly id = "lexical";
  readonly name = "نموذج شجري · Lexical";
  readonly capabilities: CapabilityReport = {
    caretRect: true,
    // التخفيت ممكن عبر أصناف على العُقَد، لكنه يمرّ بتحديث للنموذج
    // لا بطبقة عرض منفصلة — يُتحقق منه عمليًا في التقرير.
    focusDecorations: false,
    arabicDirection: true,
    undoGrouping: true,
    incrementalLayout: true,
  };

  readonly undoGroupingIsConfigurable = true; // registerHistory(editor, state, delay)

  private editor: LexicalEditor | null = null;
  private cleanups: Array<() => void> = [];
  private el: HTMLElement | null = null;
  private host: HTMLElement | null = null;
  private undoCount = 0;

  mount(host: HTMLElement, initial: Block[]): void {
    this.host = host;
    const el = document.createElement("div");
    el.contentEditable = "true";
    el.dir = "rtl";
    el.className = "luma-editor";
    el.setAttribute("role", "textbox");
    el.setAttribute("aria-multiline", "true");
    el.setAttribute("aria-label", "مساحة الكتابة");
    host.appendChild(el);
    this.el = el;

    const editor = createEditor({
      namespace: "luma-probe",
      nodes: [ParagraphNode, TextNode, HeadingNode],
      onError: (e) => {
        console.error("[lexical]", e);
      },
      theme: { paragraph: "luma-p", heading: { h1: "luma-h1", h2: "luma-h2" } },
    });
    editor.setRootElement(el);

    this.cleanups.push(registerRichText(editor));
    this.cleanups.push(
      registerHistory(editor, createEmptyHistoryState(), 500),
    );
    this.cleanups.push(
      editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
        if (dirtyElements.size > 0 || dirtyLeaves.size > 0) this.undoCount += 1;
      }),
    );

    editor.update(() => {
      const root = $getRoot();
      root.clear();
      for (const b of initial) {
        if (b.role === "body") {
          const p = $createParagraphNode();
          if (b.text) p.append($createTextNode(b.text));
          root.append(p);
        } else {
          const h = $createHeadingNode(b.role);
          if (b.text) h.append($createTextNode(b.text));
          root.append(h);
        }
      }
    });

    this.editor = editor;
  }

  destroy(): void {
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.editor?.setRootElement(null);
    this.editor = null;
    if (this.el && this.host) this.host.removeChild(this.el);
    this.el = null;
    this.host = null;
  }

  getBlocks(): Block[] {
    if (!this.editor) return [];
    const out: Block[] = [];
    this.editor.getEditorState().read(() => {
      const children = $getRoot().getChildren();
      children.forEach((node, i) => {
        const role: Block["role"] = $isHeadingNode(node)
          ? node.getTag() === "h1"
            ? "h1"
            : "h2"
          : "body";
        out.push({
          id: `b${i + 1}`,
          role,
          text: node.getTextContent(),
          marks: [],
        });
      });
    });
    return out;
  }

  focus(): void {
    this.editor?.focus();
  }

  caretRect(): DOMRect | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const rects = sel.getRangeAt(0).cloneRange().getClientRects();
    return rects.length > 0 ? (rects[0] as DOMRect) : null;
  }

  setFocusMode(enabled: boolean): void {
    if (!this.editor || !this.el) return;
    // يمرّ بقراءة التحديد من النموذج ثم يكتب أصنافًا على DOM المُدار.
    this.editor.getEditorState().read(() => {
      const selection = $getSelection();
      const activeKey =
        $isRangeSelection(selection)
          ? selection.anchor.getNode().getTopLevelElement()?.getKey()
          : undefined;
      const root = this.el;
      if (!root) return;
      const children = $getRoot().getChildren();
      children.forEach((node, i) => {
        const dom = root.children[i];
        if (!dom) return;
        dom.classList.toggle(
          "luma-dimmed",
          enabled && node.getKey() !== activeKey,
        );
      });
    });
  }

  undoDepth(): number {
    return this.undoCount;
  }

  undo(): void {
    this.editor?.dispatchCommand(UNDO_COMMAND, undefined);
  }

  /** النموذج المرجعي هو EditorState، مستقل عن الـDOM المُدار. */
  modelSignature(): string {
    return this.editor
      ? JSON.stringify(this.editor.getEditorState().toJSON())
      : "";
  }
}
