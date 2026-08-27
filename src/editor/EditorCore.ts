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

import { sentenceAt } from "./sentence";
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
// `bidi.ts` أداة نصّ عامة لا معرفة تخزين أو مكتبة — خارج حدود §٢.
import { isolate } from "../lib/bidi";

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
  /**
   * يُستدعى عند تغيّر التحديد أو المحتوى — لطبقة الآلة الكاتبة.
   *
   * `docChanged` يميّز الكتابة من الملاحة: الأولى تُمرَّر فورًا،
   * والثانية تحتمل انزلاقًا.
   */
  onSelectionChange?: (docChanged: boolean) => void;
  /**
   * يُستدعى عند **كل** تغيّر في حالة المحرر — لعمق التراجع والإعادة.
   *
   * منفصل عن أخويه لأن سؤاله مختلف: `onChange` يسأل «هل تغيّر النص؟»
   * و`onSelectionChange` «هل تحرّك المؤشر؟»، وهذا «هل تغيّر شيءٌ قد
   * يُغيّر عمق المكدّس؟». والفرق ليس نظريًا — `setBlocks` **يمسح
   * السجل ولا يُطلق أيًّا منهما**: لا `onChange` (استبدالٌ برمجي لا
   * تحرير)، ولا `onSelectionChange` (يمرّ بـ`updateState` لا
   * بـ`dispatch`). فمن بنى حالة الزرّين على أيٍّ منهما وجدهما مضيئين
   * على مكدّسٍ صُفِّر للتوّ.
   *
   * ويُطلق من **موضعَي تغيّر الحالة كليهما** داخل النواة لا من
   * مُستدعيها: قاعدةٌ بنيوية لا يمكن لمسارٍ جديد أن ينساها.
   */
  onHistoryChange?: () => void;
  /** تسمية مساحة الكتابة لقارئ الشاشة. */
  ariaLabel?: string;
}


/**
 * سطر المؤشر مقيسًا من DOM — احتياطُ `coordsAtPos` حين يعود بأصفار.
 *
 * يقيس **المحرف الذي قبل الموضع**: مدًى على محرفٍ حقيقي يعطي مستطيله
 * دائمًا، بخلاف مدًى منطوٍ عند حدّ عقدة.
 */
function caretRectFromDom(view: EditorView, pos: number): DOMRect | null {
  let node: Node;
  let offset: number;
  try {
    ({ node, offset } = view.domAtPos(pos));
  } catch {
    return null;
  }

  if (node.nodeType !== Node.TEXT_NODE) {
    // مرساةٌ عنصر: آخر عقدة نصّ قبل الإزاحة
    const kids = node.childNodes;
    let found: Text | null = null;
    for (let i = Math.min(offset, kids.length) - 1; i >= 0 && !found; i--) {
      const child = kids[i]!;
      // **الابن قد يكون النصّ نفسه.** `TreeWalker` لا يعيد جذره أبدًا،
      // فمسحُه وحده يُسقط الحالة الغالبة: فقرةٌ بلا زخارف أبناؤها عقد
      // نصّ مباشرة — وعندها كان الاحتياط يعود فارغًا فيضيع المؤشر.
      if (child.nodeType === Node.TEXT_NODE) {
        found = child as Text;
        break;
      }
      const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT);
      let last: Text | null = null;
      while (walker.nextNode()) last = walker.currentNode as Text;
      found = last;
    }
    if (!found) return null;
    node = found;
    offset = found.length;
  }

  const text = node as Text;
  if (text.length === 0) return null;
  const start = Math.max(0, Math.min(text.length - 1, offset - 1));
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, start + 1);
  const rects = range.getClientRects();
  return rects.length ? rects[0]! : null;
}

/**
 * طبقة التركيز: تخفيت ما حول **الجملة** النشطة — بلا لمس النموذج.
 *
 * كانت تخفّت بحبيبة الفقرة، فمن يكتب فقرةً طويلة — وهو ما يفعله كاتب
 * المقال — لا يرى فرقًا إطلاقًا: الفقرة كلها نشطة فلا يُخفَّت شيء.
 * والحبيبة الصحيحة هي الجملة، و`Luma.md` §٧ يقول «يبرز **السطر** أو
 * الفقرة الحالية» فيسعها.
 *
 * والتخفيت يبقى **مقروءًا** لا شبه مخفيّ — §٧ **ثابت**.
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
            // كتلة بعيدة عن المؤشر: تُخفَّت كاملة
            decos.push(Decoration.node(offset, end, { class: "luma-dimmed" }));
            return;
          }

          // الكتلة النشطة: يُخفَّت ما حول الجملة التي فيها المؤشر.
          // `offset + 1` هو أول موضع نصّي داخل العقدة.
          const text = node.textContent;
          if (!text) return;
          const inner = Math.max(0, Math.min(text.length, from - offset - 1));
          const { start, end: sEnd } = sentenceAt(text, inner);

          if (start > 0) {
            decos.push(
              Decoration.inline(offset + 1, offset + 1 + start, {
                class: "luma-dimmed",
              }),
            );
          }
          if (sEnd < text.length) {
            decos.push(
              Decoration.inline(offset + 1 + sEnd, offset + 1 + text.length, {
                class: "luma-dimmed",
              }),
            );
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
   * حالة ما قبل المعاينة — نصًّا وتحديدًا وسجلَّ تراجع.
   *
   * `null` حين لا معاينة. تعيش هنا لا عند المُستدعي: حالة ProseMirror
   * لا تعبر حدّ النواة (§٢)، ومن يعاين لا يحمل ما لا يعرفه.
   */
  private preserved: EditorState | null = null;
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
    if (this.view) throw new Error(`${isolate("EditorCore")} مركّبة بالفعل`);

    const state = EditorState.create({
      doc: blocksToDoc(initial),
      plugins: [
        history({ newGroupDelay: UNDO_GROUP_DELAY_MS }),
        keymap({
          "Mod-z": undo,
          "Mod-Shift-z": redo,
          "Mod-y": redo,
          // **مجموعة التنسيق كاملة بلوحة المفاتيح** — §١٣: «كل وظيفة
          // أساسية متاحة بلوحة المفاتيح». وما دام الزرّ موجودًا فله
          // اختصاره: زرٌّ بلا اختصار يجعل الوظيفة نصف متاحة.
          "Mod-Alt-0": () => this.applyRole("body"),
          "Mod-Alt-1": () => this.applyRole("h1"),
          "Mod-Alt-2": () => this.applyRole("h2"),
          "Mod-Alt-3": () => this.applyRole("h3"),
          "Mod-Alt-q": () => this.applyRole("quote"),
          // الوزن — بديل التمييز للعربية في §٥. و⌘B عُرفٌ عالمي.
          "Mod-b": () => this.toggleStrong(),
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
          this.opts.onSelectionChange?.(tr.docChanged);
        }
        // بلا شرط: التراجع نفسه لا يغيّر النص أحيانًا (خطوةٌ فارغة)
        // ومع ذلك ينقل عمق المكدّس من `done` إلى `undone`.
        this.opts.onHistoryChange?.();
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
   *
   * **ويُسقط لقطة المعاينة**: استبدالُ المحتوى كاملًا يُبطلها مهما كان
   * سببه. فمن فتح مسودة أخرى وهو يعاين — و`openDocument` تفتح ثم
   * تُنهي المعاينة بهذا الترتيب — لا تعود عليه لقطةٌ قديمة فتمحو ما
   * فُتح للتوّ. الإسقاط هنا لا عند المُستدعي: مسارٌ جديد يستبدل
   * المحتوى لا يحتاج أن يتذكّر شيئًا.
   */
  setBlocks(blocks: readonly Block[]): void {
    const view = this.view;
    if (!view) return;
    this.preserved = null;
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
    // **الموضع الثاني الذي تتغيّر فيه الحالة** — وهو الذي يمسح السجل.
    // خارج `finally` عمدًا: لو رمى الاستبدال لم تتغيّر الحالة أصلًا.
    this.opts.onHistoryChange?.();
  }

  /**
   * يبدأ معاينة نسخة: **يحفظ الحالة كاملة** ثم يعرض المحتوى المعروض.
   *
   * «المعاينة قراءةٌ فقط ولا تمسّ المستند الحالي» — `Luma.md` §٩
   * **ثابت**. وكان `setBlocks` وحده يخدم المعاينة، فيمسح سجل التراجع
   * **مرّتين**: عند الدخول وعند الخروج. فيعود الكاتب من معاينةٍ لم
   * يكتب فيها حرفًا ليجد تراجعه ذهب — وهو مسٌّ بالمستند الحالي وإن لم
   * يتغيّر نصّه. كان واقعًا غير مرئي قبل زرّي التراجع والإعادة (القرار
   * ٤)، فأظهراه، وهذا موضع إصلاحه.
   *
   * واللقطة حالةُ ProseMirror كاملة: النص والتحديد وسجل التراجع معًا،
   * فالعودة تعيد الثلاثة بضربة واحدة. وتبقى **داخل النواة**: من يعاين
   * لا يحتاج أن يعرف ما فيها ولا أن يحملها عنها.
   */
  beginPreview(blocks: readonly Block[]): void {
    const view = this.view;
    if (!view) return;
    // **اللقطة تُلتقط قبل الاستبدال وتُعاد بعده.** `setBlocks` يُسقط
    // اللقطة عمدًا (الشرح عنده)، وهذا المسار وحده يُعيدها: معاينةٌ
    // مقصودة لا استبدالٌ عابر. ولقطةٌ واحدة لا تُستبدل — معاينة نسخة
    // ثانية دون خروج تُبقي **الأصل** هدفًا للعودة لا آخرَ ما عُوين.
    const snapshot = this.preserved ?? view.state;
    this.setBlocks(blocks);
    this.preserved = snapshot;
  }

  /**
   * ينهي المعاينة ويعيد ما قبلها كما كان — نصًّا وتحديدًا ومكدّسًا.
   *
   * **يُبلّغ:** `true` إن كانت ثمّة لقطة عاد إليها.
   */
  endPreview(): boolean {
    const view = this.view;
    const snapshot = this.preserved;
    if (!view || !snapshot) return false;
    this.preserved = null;

    // طبقة التركيز تفضيلُ عرضٍ حيّ لا جزءٌ من المستند: لو بُدِّلت أثناء
    // المعاينة لم يكن يصحّ أن ترجع اللقطةُ بها إلى ما كانت عليه.
    const focus = this.focusModeEnabled;
    this.suppressChange = true;
    try {
      view.updateState(snapshot);
    } finally {
      this.suppressChange = false;
    }
    if (focus !== this.focusModeEnabled) this.setFocusMode(focus);
    this.opts.onHistoryChange?.();
    return true;
  }

  /**
   * يتخلّى عن لقطة المعاينة — حين تُستعاد النسخة فعلًا.
   *
   * الاستعادة تغيّر المستند قصدًا، فلا عودة إلى ما قبلها من هنا:
   * شبكةُ أمانها لقطةٌ في السجل (`BeforeRestore`، §٩) لا مكدّس تراجع.
   */
  dropPreview(): void {
    this.preserved = null;
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
      // **مستطيلٌ صفريّ ليس مؤشرًا.** WebKit يعطي أحيانًا مدًى بلا
      // مستطيلات لموضعٍ عند حدّ عقدة — كآخر محرف في آخر فقرة — فيعود
      // `coordsAtPos` بأصفار والمحرر مرسومٌ سليم (قِيس: ارتفاع نافذة
      // العرض ٤٢٩px ومستطيل المؤشر صفر). والبناء عليه يقرأ المؤشر في
      // أعلى النافذة فيمرّر إلى مكانٍ ليس فيه — أو لا يمرّر أصلًا،
      // وهو ما كان يُبقي السطر النشط خارج نطاق الآلة الكاتبة عند
      // الدخول وعند تفعيل الطبقة وعند تغيير حجم النافذة.
      if (c.top !== 0 || c.bottom !== 0) {
        return new DOMRect(c.left, c.top, c.right - c.left, c.bottom - c.top);
      }
      return caretRectFromDom(view, from);
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
   * يضع المؤشر عند أقرب موضع نصّي من نقطة قد تقع خارج `view.dom` —
   * الغلاف يجعل الورقة كلها منطقة نقر وإن كان صندوق التحرير الفعلي
   * أضيق منها (هوامش جانبية، أسفل آخر سطر).
   *
   * تُحصر الإحداثيتان داخل حدود `view.dom` أولًا: `posAtCoords` خارج
   * الحدود لا يضمن موضعًا، وحصرها يضمن السقوط دائمًا على أقرب نقطة
   * حقيقية — نهاية المستند تحت آخر سطر، وأقرب موضع في السطر نفسه من
   * جهته اليمنى أو اليسرى.
   */
  placeCaretNear(clientX: number, clientY: number): void {
    const view = this.view;
    if (!view) return;
    const rect = view.dom.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = Math.min(Math.max(clientX, rect.left), rect.right - 1);
    const y = Math.min(Math.max(clientY, rect.top), rect.bottom - 1);
    const found = view.posAtCoords({ left: x, top: y });
    if (!found) return;
    const $pos = view.state.doc.resolve(found.pos);
    view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)));
    view.focus();
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
    // **قارئ الشاشة يسمع ما يراه المُبصر.** المعاينة تُظهر تنبيهًا
    // «للقراءة فقط»، وكانت مساحة النص تبقى تُعلن نفسها قابلة للتحرير:
    // من يقرأ بالصوت يحاول الكتابة ولا يفهم لماذا لا شيء يحدث — §١٣.
    view.dom.setAttribute("aria-readonly", enabled ? "false" : "true");
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

  /**
   * الحارس نفسه على إخوتها: `editable=false` يمنع التراجع كما يمنع
   * الكتابة. كان غائبًا هنا — و`view.dispatch` لا يستشير `editable`
   * بنفسه (ذاك حراسة أحداث DOM لا حراسة التحويلة) — فنداءٌ مباشر مثل
   * ⌘Z أثناء نافذة «مغلق للتحرير» (رحلة `EditorSession`، أو معاينة
   * السجل قبل أن تُعلن نفسها) كان يتراجع في مستندٍ يُفترض ألّا يُمسّ.
   */
  undo(): boolean {
    const view = this.view;
    if (!view || !this.editable) return false;
    return undo(view.state, view.dispatch);
  }

  redo(): boolean {
    const view = this.view;
    if (!view || !this.editable) return false;
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

  /**
   * يبدّل الوزن على التحديد.
   *
   * **الوزن بديل التمييز للعربية** — `Luma.md` §٥: «لا مائل… بديل
   * التمييز هو علامة الاقتباس العربية «» أو الوزن».
   *
   * ويعمل على تحديدٍ غير فارغ وحده: علامةٌ مخزَّنة لمؤشرٍ منطوٍ تعني
   * حالةً غير مرئية يحملها المحرر، ونموذج المحتوى لا يحفظ نيّة.
   */
  toggleStrong(): boolean {
    const view = this.view;
    if (!view || !this.editable) return false;
    const mark = schema.marks["strong"];
    const { from, to, empty } = view.state.selection;
    if (!mark || empty) return false;
    const has = view.state.doc.rangeHasMark(from, to, mark);
    const tr = view.state.tr;
    if (has) tr.removeMark(from, to, mark);
    else tr.addMark(from, to, mark.create());
    view.dispatch(tr);
    return true;
  }

  /** هل التحديد كلّه موزون؟ — لحالة الزرّ في الشريط. */
  get isStrong(): boolean {
    const view = this.view;
    const mark = schema.marks["strong"];
    if (!view || !mark) return false;
    const { from, to, empty } = view.state.selection;
    if (empty) return false;
    return view.state.doc.rangeHasMark(from, to, mark);
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
