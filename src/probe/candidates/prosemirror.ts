/**
 * مرشح ١ — محرر ذو مخطط كتل (ProseMirror).
 *
 * الفرضية: مخططه يطابق `Block` واحدًا لواحد، و`Decoration` تخفت المحيط
 * بلا لمس النموذج، و`prosemirror-history` يجمّع التراجع بحسب الدفقة.
 */

import { Schema, type Node as PMNode } from "prosemirror-model";
import { EditorState, Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { EditorView, Decoration, DecorationSet } from "prosemirror-view";
import { history, undo, redo, undoDepth } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";

import type { Block, EditorCandidate, CapabilityReport } from "../types";

/** المخطط: فقرة وعنوانان فقط. لا مائل ولا تنسيق غني — `Luma.md` §٥. */
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: {
      group: "block",
      content: "inline*",
      toDOM: () => ["p", { dir: "rtl" }, 0],
      parseDOM: [{ tag: "p" }],
    },
    heading1: {
      group: "block",
      content: "inline*",
      defining: true,
      toDOM: () => ["h1", { dir: "rtl" }, 0],
      parseDOM: [{ tag: "h1" }],
    },
    heading2: {
      group: "block",
      content: "inline*",
      defining: true,
      toDOM: () => ["h2", { dir: "rtl" }, 0],
      parseDOM: [{ tag: "h2" }],
    },
  },
  marks: {},
});

const NODE_FOR_ROLE = {
  body: "paragraph",
  h1: "heading1",
  h2: "heading2",
} as const;

const ROLE_FOR_NODE: Record<string, Block["role"]> = {
  paragraph: "body",
  heading1: "h1",
  heading2: "h2",
};

const focusKey = new PluginKey<boolean>("lumaFocusMode");

/**
 * القدرة ٢ — التخفيت كطبقة عرض.
 * يضيف صنفًا للكتل غير النشطة عبر `Decoration.node`؛ لا يمسّ المحتوى.
 */
function focusModePlugin(): Plugin<boolean> {
  return new Plugin<boolean>({
    key: focusKey,
    state: {
      init: () => false,
      apply: (tr, value) => {
        const next = tr.getMeta(focusKey);
        return typeof next === "boolean" ? next : value;
      },
    },
    props: {
      decorations(state) {
        if (!focusKey.getState(state)) return DecorationSet.empty;
        const { from, to } = state.selection;
        const decos: Decoration[] = [];
        state.doc.forEach((node, offset) => {
          const end = offset + node.nodeSize;
          const active = from < end && to > offset;
          if (!active) {
            decos.push(
              Decoration.node(offset, end, { class: "luma-dimmed" }),
            );
          }
        });
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

function blocksToDoc(blocks: readonly Block[]): PMNode {
  const nodes = blocks.map((b) => {
    const type = schema.nodes[NODE_FOR_ROLE[b.role]];
    if (!type) throw new Error(`دور غير معروف: ${b.role}`);
    return type.create(null, b.text ? schema.text(b.text) : null);
  });
  return schema.nodes.doc!.create(null, nodes);
}

function docToBlocks(doc: PMNode): Block[] {
  const out: Block[] = [];
  let i = 0;
  doc.forEach((node) => {
    i += 1;
    out.push({
      id: `b${i}`,
      role: ROLE_FOR_NODE[node.type.name] ?? "body",
      text: node.textContent,
      marks: [],
    });
  });
  return out;
}

export class ProseMirrorCandidate implements EditorCandidate {
  readonly id = "prosemirror";
  readonly name = "مخطط كتل · ProseMirror";
  readonly capabilities: CapabilityReport = {
    caretRect: true,
    focusDecorations: true,
    arabicDirection: true,
    undoGrouping: true,
    incrementalLayout: true,
  };

  readonly undoGroupingIsConfigurable = true; // history({ newGroupDelay })

  private view: EditorView | null = null;

  mount(host: HTMLElement, initial: Block[]): void {
    const state = EditorState.create({
      doc: blocksToDoc(initial),
      plugins: [
        // القدرة ٤: newGroupDelay يجمّع الكتابة المتصلة في عملية تراجع واحدة.
        history({ newGroupDelay: 500 }),
        keymap({ "Mod-z": undo, "Mod-Shift-z": redo, "Mod-y": redo }),
        keymap(baseKeymap),
        focusModePlugin(),
      ],
    });

    this.view = new EditorView(host, {
      state,
      attributes: {
        // القدرة ٣: الاتجاه الأساسي مصرَّح به لا مستنتَج من المحتوى.
        dir: "rtl",
        class: "luma-editor",
        "aria-label": "مساحة الكتابة",
      },
    });
  }

  destroy(): void {
    this.view?.destroy();
    this.view = null;
  }

  getBlocks(): Block[] {
    return this.view ? docToBlocks(this.view.state.doc) : [];
  }

  focus(): void {
    this.view?.focus();
  }

  caretRect(): DOMRect | null {
    if (!this.view) return null;
    const { from } = this.view.state.selection;
    const c = this.view.coordsAtPos(from);
    return new DOMRect(c.left, c.top, c.right - c.left, c.bottom - c.top);
  }

  setFocusMode(enabled: boolean): void {
    if (!this.view) return;
    const tr = this.view.state.tr.setMeta(focusKey, enabled);
    tr.setMeta("addToHistory", false);
    this.view.dispatch(tr);
  }

  undoDepth(): number {
    return this.view ? undoDepth(this.view.state) : 0;
  }

  /** النموذج المرجعي مستقل عن الـDOM: الزخارف لا تظهر فيه إطلاقًا. */
  modelSignature(): string {
    return this.view ? JSON.stringify(this.view.state.doc.toJSON()) : "";
  }

  undo(): void {
    if (!this.view) return;
    undo(this.view.state, this.view.dispatch);
  }

  /** إدراج نص عند المؤشر — يُستخدم في القياس الآلي. */
  typeText(text: string): void {
    if (!this.view) return;
    const { from } = this.view.state.selection;
    this.view.dispatch(this.view.state.tr.insertText(text, from));
  }

  /** وضع المؤشر في نهاية المستند. */
  caretToEnd(): void {
    if (!this.view) return;
    const end = this.view.state.doc.content.size;
    const tr = this.view.state.tr.setSelection(
      TextSelection.create(this.view.state.doc, end - 1),
    );
    this.view.dispatch(tr);
  }
}
