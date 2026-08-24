/**
 * `EditorCore` — نواة التحرير.
 *
 * **حدودها** (`IMPLEMENTATION.md` §٢ **ثابت**): تعرض النص وتدير الإدخال
 * والمؤشر والتحديد والتراجع وطبقتي الآلة الكاتبة والتركيز.
 * **لا تحفظ، ولا تعرف المكتبة، ولا تقرأ تفضيلات، ولا تلمس ملفًا.**
 *
 * تُبلّغ بالتغيير عبر `onChange` ولا تعرف من يستمع. من يحفظ شأنه.
 * يحرس هذا الحدَّ اختبارٌ في `tests/editor-boundaries.test.ts`.
 */

import { EditorState, Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { EditorView, Decoration, DecorationSet } from "prosemirror-view";
import { history, undo, redo, undoDepth, redoDepth } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";

import type { Block, BlockRole } from "./blocks";
import { emptyDocument, wordCount } from "./blocks";
import { schema, NODE_FOR_ROLE, ROLE_FOR_NODE } from "./schema";
import {
  blocksToDoc,
  docToBlocks,
  blockIdPlugin,
  createBlockMapper,
} from "./convert";
import { textToSlice } from "./paste";

const focusKey = new PluginKey<boolean>("lumaFocusMode");

/**
 * نافذة تجميع التراجع.
 *
 * ٥٠٠ms: دفقة الكتابة المتصلة تصير عملية تراجع واحدة، والتوقف يبدأ
 * دفقة جديدة. تجميعٌ بالحرف يجعل `Cmd+Z` بلا معنى — §٧ **ثابت**.
 */
const UNDO_GROUP_DELAY_MS = 500;

/**
 * تنفّس حول المؤشر عند التمرير إليه، بالبكسل.
 *
 * أربعة أسطر من نص القراءة (١٩/٣٦) تقريبًا: تكفي ليبقى السطر السابق
 * والتالي مرئيين، ولا تصل إلى تثبيت السطر في الوسط — ذاك وضع الآلة
 * الكاتبة في المرحلة ٦.
 */
const SCROLL_MARGIN = 144;

/**
 * متى يبدأ التمرير: قبل أن يبلغ المؤشر الحافة، لا بعدها.
 *
 * سطران تقريبًا. الصفر (الافتراضي) يعني ألّا يتحرّك شيء حتى يخرج
 * المؤشر من الشاشة فعلًا، فتأتي الحركة متأخّرة ودفعةً واحدة.
 */
const SCROLL_THRESHOLD = 96;

export interface EditorCoreOptions {
  /** يُستدعى بعد كل تغيير فعلي في المحتوى. */
  onChange?: (blocks: Block[]) => void;
  /** يُستدعى عند تغيّر التحديد أو المحتوى — لطبقة الآلة الكاتبة. */
  onSelectionChange?: () => void;
  /** تسمية مساحة الكتابة لقارئ الشاشة. */
  ariaLabel?: string;
}

/** طبقة التركيز: تخفيت الكتل غير النشطة **بلا لمس النموذج**. */
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
            decos.push(Decoration.node(offset, end, { class: "luma-dimmed" }));
          }
        });
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

export class EditorCore {
  private view: EditorView | null = null;
  private opts: EditorCoreOptions;
  /** يمنع إطلاق `onChange` أثناء الاستبدال البرمجي للمحتوى. */
  private suppressChange = false;
  /** قراءة فقط أثناء معاينة نسخة من السجل — §٩. */
  private editable = true;
  /**
   * محوِّل يعيد استعمال الكتل غير المتغيّرة.
   *
   * مسار الكتابة يمرّ به مع كل ضغطة مفتاح، فبناء المستند كله في كل
   * مرة يُحسّ تلعثمًا على النص الطويل. `getBlocks()` العامة تبقى على
   * التحويل المباشر: قارئها الخارجي لا يفترض إعادة استعمال.
   */
  private toBlocks = createBlockMapper();

  constructor(options: EditorCoreOptions = {}) {
    this.opts = options;
  }

  // ── دورة الحياة ──────────────────────────────────────────

  mount(host: HTMLElement, initial: readonly Block[] = emptyDocument()): void {
    if (this.view) throw new Error("EditorCore مركّبة بالفعل");

    const state = EditorState.create({
      doc: blocksToDoc(initial),
      plugins: [
        history({ newGroupDelay: UNDO_GROUP_DELAY_MS }),
        keymap({
          "Mod-z": undo,
          "Mod-Shift-z": redo,
          "Mod-y": redo,
          // مجموعة التنسيق المعتمدة كاملة بلوحة المفاتيح — `Luma.md` §٥
          // و§١٣: «كل وظيفة أساسية متاحة بلوحة المفاتيح». المجموعة ثلاثة
          // أدوار لا أكثر، فلا اختصار لـH3 ولا لغامق.
          "Mod-Alt-0": () => this.applyRole("body"),
          "Mod-Alt-1": () => this.applyRole("h1"),
          "Mod-Alt-2": () => this.applyRole("h2"),
        }),
        keymap(baseKeymap),
        blockIdPlugin(),
        focusModePlugin(),
      ],
    });

    this.view = new EditorView(host, {
      state,
      editable: () => this.editable,
      // **هامش تمرير حول المؤشر.**
      //
      // الافتراضي صفر: يُمرَّر السطر إلى داخل الشاشة بالكاد، فيلتصق
      // المؤشر بحافة النافذة وتصير الكتابة على الحافة — وهذا أظهر ما
      // يُحسّ «غير سلس» في الكتابة المتصلة. §٥: «التمرير يحافظ على موضع
      // واضح للمؤشر». ليس هذا وضع الآلة الكاتبة (المرحلة ٦) الذي يثبّت
      // السطر النشط في نطاق وسطي، بل حدٌّ أدنى من التنفّس حوله.
      scrollThreshold: {
        top: SCROLL_THRESHOLD,
        bottom: SCROLL_THRESHOLD,
        left: 0,
        right: 0,
      },
      scrollMargin: {
        top: SCROLL_MARGIN,
        bottom: SCROLL_MARGIN,
        left: 0,
        right: 0,
      },
      attributes: {
        dir: "rtl",
        class: "luma-editor",
        "aria-label": this.opts.ariaLabel ?? "مساحة الكتابة",
        role: "textbox",
        "aria-multiline": "true",
      },
      // اللصق نصًّا عاديًا دائمًا: يمنع تسرّب تنسيق عبر HTML
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (typeof text !== "string" || text.length === 0) return false;
        view.dispatch(view.state.tr.replaceSelection(textToSlice(text)));
        return true;
      },
      transformPastedText: (text) => text,
      // السحب والإفلات يمرّ بالمسار نفسه
      transformPasted: (slice) => slice,
      dispatchTransaction: (tr) => {
        const view = this.view;
        if (!view) return;
        const next = view.state.apply(tr);
        view.updateState(next);

        if (tr.docChanged && !this.suppressChange) {
          this.opts.onChange?.(this.toBlocks(next.doc));
        }
        if (tr.docChanged || tr.selectionSet) {
          this.opts.onSelectionChange?.();
        }
      },
    });
  }

  destroy(): void {
    this.view?.destroy();
    this.view = null;
  }

  get isMounted(): boolean {
    return this.view !== null;
  }

  // ── المحتوى ──────────────────────────────────────────────

  getBlocks(): Block[] {
    return this.view ? docToBlocks(this.view.state.doc) : [];
  }

  /**
   * يستبدل المحتوى كاملًا — لفتح مستند آخر.
   *
   * يمسح سجل التراجع: التراجع عبر مستندين مختلفين سلوك مربك.
   * لا يُطلق `onChange` لأن الاستبدال ليس تحريرًا من المستخدم.
   */
  setBlocks(blocks: readonly Block[]): void {
    const view = this.view;
    if (!view) return;
    this.suppressChange = true;
    try {
      view.updateState(
        EditorState.create({
          doc: blocksToDoc(blocks),
          plugins: view.state.plugins,
        }),
      );
    } finally {
      this.suppressChange = false;
    }
  }

  get wordCount(): number {
    return wordCount(this.getBlocks());
  }

  // ── التركيز والمؤشر ──────────────────────────────────────

  focus(): void {
    this.view?.focus();
  }

  get hasFocus(): boolean {
    return this.view?.hasFocus() ?? false;
  }

  /** مستطيل المؤشر في إحداثيات النافذة — أساس وضع الآلة الكاتبة. */
  caretRect(): DOMRect | null {
    const view = this.view;
    if (!view) return null;
    try {
      const { from } = view.state.selection;
      const c = view.coordsAtPos(from);
      return new DOMRect(c.left, c.top, c.right - c.left, c.bottom - c.top);
    } catch {
      return null;
    }
  }

  caretToEnd(): void {
    const view = this.view;
    if (!view) return;
    const end = Math.max(0, view.state.doc.content.size - 1);
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, end)),
    );
  }

  /**
   * مستطيل التحديد الحالي في إحداثيات النافذة، أو `null` بلا تحديد.
   *
   * أساس موضع شريط التحديد: يظهر فوق النص المحدَّد ويختفي بزواله.
   * يُقاس من نطاق DOM لا من المواضع المنطقية، لأن التحديد قد يمتدّ على
   * أسطر — والمطلوب حدوده كما يراها القارئ.
   */
  selectionRect(): DOMRect | null {
    const view = this.view;
    if (!view || view.state.selection.empty) return null;
    const sel = view.dom.ownerDocument.defaultView?.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return rect;
  }

  /**
   * قراءة فقط — لمعاينة نسخة من السجل.
   *
   * «أثناء المعاينة يدخل المستند وضع قراءة فقط» — `Luma.md` §٩ **ثابت**.
   * يُمنع التحرير ويبقى التحديد والنسخ عاملين: المعاينة قراءة لا تجميد.
   */
  setEditable(enabled: boolean): void {
    const view = this.view;
    if (!view) return;
    this.editable = enabled;
    // `editable` دالة تُستشار عند كل محاولة تحرير، فتكفي إعادة الرسم
    view.setProps({ editable: () => this.editable });
  }

  get isEditable(): boolean {
    return this.editable;
  }

  // ── الطبقات ──────────────────────────────────────────────

  setFocusMode(enabled: boolean): void {
    const view = this.view;
    if (!view) return;
    const tr = view.state.tr.setMeta(focusKey, enabled);
    tr.setMeta("addToHistory", false);
    view.dispatch(tr);
  }

  get focusModeEnabled(): boolean {
    return this.view ? (focusKey.getState(this.view.state) ?? false) : false;
  }

  // ── التراجع ──────────────────────────────────────────────

  undo(): boolean {
    const view = this.view;
    if (!view) return false;
    return undo(view.state, view.dispatch);
  }

  redo(): boolean {
    const view = this.view;
    if (!view) return false;
    return redo(view.state, view.dispatch);
  }

  get undoDepth(): number {
    return this.view ? undoDepth(this.view.state) : 0;
  }

  get redoDepth(): number {
    return this.view ? redoDepth(this.view.state) : 0;
  }

  // ── التنسيق المعتمد ──────────────────────────────────────

  /** دور الكتلة التي فيها المؤشر. */
  currentRole(): BlockRole | null {
    const view = this.view;
    if (!view) return null;
    const $from = view.state.selection.$from;
    for (let d = $from.depth; d > 0; d -= 1) {
      const role = ROLE_FOR_NODE[$from.node(d).type.name];
      if (role) return role;
    }
    return null;
  }

  /** يحوّل الكتل المشمولة بالتحديد إلى الدور المطلوب. */
  setRole(role: BlockRole): void {
    this.applyRole(role);
  }

  /** الشكل الأمري للتحويل — يعيد `true` إن غيّر شيئًا، كما تتوقّع الاختصارات. */
  private applyRole(role: BlockRole): boolean {
    const view = this.view;
    if (!view || !this.editable) return false;
    const type = schema.nodes[NODE_FOR_ROLE[role]];
    if (!type) return false;
    const { from, to } = view.state.selection;
    const tr = view.state.tr;
    view.state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name in ROLE_FOR_NODE) {
        tr.setNodeMarkup(pos, type, node.attrs);
        return false;
      }
      return true;
    });
    if (!tr.docChanged) return false;
    view.dispatch(tr);
    return true;
  }

  /**
   * يحيط التحديد بعلامتَي الاقتباس العربيتين «».
   *
   * بديل التمييز في العربية — العربية لا تُمال. `Luma.md` §٥ **ثابت**
   */
  wrapInQuotes(): void {
    const view = this.view;
    if (!view || !this.editable) return;
    const { from, to, empty } = view.state.selection;
    if (empty) return;
    const text = view.state.doc.textBetween(from, to, " ");
    if (!text) return;
    const tr = view.state.tr.insertText(`«${text}»`, from, to);
    // يبقى النص محدَّدًا بعد الإحاطة، فيمكن التراجع عنها بصريًا
    tr.setSelection(
      TextSelection.create(tr.doc, from, from + text.length + 2),
    );
    view.dispatch(tr);
  }
}
