/**
 * التحويل بين `Block[]` ومستند المحرر — ذهابًا وإيابًا بلا فقد ولا إعادة ترتيب.
 *
 * `Block[]` هو المصدر. مستند المحرر تمثيل عامل عليه، لا نسخة موازية.
 */

import type { Node as PMNode, Slice } from "prosemirror-model";
import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import type { Block, BlockRole, InlineMark } from "./blocks";
import { createBlock, newBlockId } from "./blocks";
import { schema, NODE_FOR_ROLE, ROLE_FOR_NODE } from "./schema";

/**
 * محتوى الكتلة عقدًا نصّية، مقطَّعًا عند حدود العلامات.
 *
 * الكتلة نصٌّ واحد وعلاماتُه إزاحات فيه، وProseMirror يريد عقدًا
 * تحمل كلٌّ منها علاماتها. فتُجمع الحدود وتُقطَّع عندها — ولا يُبنى
 * قطعٌ حيث لا علامة.
 */
function inlineFor(b: Block): PMNode | PMNode[] | null {
  if (!b.text) return null;
  const strong = schema.marks["strong"];
  const spans = (b.marks ?? []).filter(
    (m) => m.type === "strong" && m.from < m.to,
  );
  if (!strong || spans.length === 0) return schema.text(b.text);

  const bounds = new Set<number>([0, b.text.length]);
  for (const m of spans) {
    bounds.add(Math.max(0, Math.min(b.text.length, m.from)));
    bounds.add(Math.max(0, Math.min(b.text.length, m.to)));
  }
  const points = [...bounds].sort((x, y) => x - y);

  const out: PMNode[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i]!;
    const to = points[i + 1]!;
    if (to <= from) continue;
    const on = spans.some((m) => m.from <= from && m.to >= to);
    out.push(schema.text(b.text.slice(from, to), on ? [strong.create()] : null));
  }
  return out;
}

/** علامات الكتلة مقروءةً من عقدتها — الإزاحات في نصّها هي. */
function marksFromNode(node: PMNode): InlineMark[] {
  const out: InlineMark[] = [];
  let at = 0;
  node.forEach((child) => {
    const len = child.text?.length ?? 0;
    if (len > 0 && child.marks.some((m) => m.type.name === "strong")) {
      const last = out[out.length - 1];
      // مقطعان متلاصقان يصيران مدًى واحدًا: النصّ واحد والحدّ زائل
      if (last && last.to === at) out[out.length - 1] = { ...last, to: at + len };
      else out.push({ type: "strong", from: at, to: at + len });
    }
    at += len;
  });
  return out;
}

export function blocksToDoc(blocks: readonly Block[]): PMNode {
  const source = blocks.length > 0 ? blocks : [createBlock("body", "")];
  const nodes = source.map((b) => {
    const type = schema.nodes[NODE_FOR_ROLE[b.role]];
    if (!type) throw new Error(`دور كتلة غير معروف: ${b.role}`);
    return type.create({ id: b.id }, inlineFor(b));
  });
  const doc = schema.nodes["doc"];
  if (!doc) throw new Error("مخطط بلا عقدة doc");
  return doc.create(null, nodes);
}

function blockFromNode(node: PMNode): Block {
  const role: BlockRole = ROLE_FOR_NODE[node.type.name] ?? "body";
  const id =
    typeof node.attrs["id"] === "string" && node.attrs["id"]
      ? (node.attrs["id"] as string)
      : newBlockId();
  return { id, role, text: node.textContent, marks: marksFromNode(node) };
}

export function docToBlocks(doc: PMNode): Block[] {
  const out: Block[] = [];
  doc.forEach((node) => out.push(blockFromNode(node)));
  return out.length > 0 ? out : [createBlock("body", "")];
}

/**
 * محوِّل يعيد استعمال الكتل التي لم تتغيّر عقدتها.
 *
 * عقد ProseMirror **غير قابلة للتغيير**، فالعقدة التي لم تُمسّ تحتفظ
 * بهُويّتها المرجعية عبر المعاملات. وهذا يجعل المقارنة بـ`===` كافية
 * وصحيحة: ما تغيّر وحده يُعاد بناؤه.
 *
 * بدونه تُبنى كل كتل المستند من جديد **مع كل ضغطة مفتاح** — و
 * `textContent` يخصّص سلسلة لكل كتلة. على مستند طويل هذا يظهر تلعثمًا
 * في الكتابة لا خطأً في النتيجة.
 */
export function createBlockMapper(): (doc: PMNode) => Block[] {
  let lastNodes: PMNode[] = [];
  let lastBlocks: Block[] = [];

  return (doc: PMNode): Block[] => {
    const nodes: PMNode[] = [];
    const blocks: Block[] = [];
    let i = 0;
    doc.forEach((node) => {
      nodes.push(node);
      blocks.push(node === lastNodes[i] ? lastBlocks[i]! : blockFromNode(node));
      i += 1;
    });
    lastNodes = nodes;
    lastBlocks = blocks;
    return blocks.length > 0 ? blocks : [createBlock("body", "")];
  };
}

export const blockIdPluginKey = new PluginKey("lumaBlockIds");

/**
 * يضمن أن لكل كتلة معرّفًا فريدًا غير فارغ.
 *
 * لازم لأن شقّ الفقرة بـ`Enter` واللصقَ ينسخان سمات العقدة، فتتكرر
 * المعرّفات. التكرار يفسد المطابقة عند الحفظ والفروق في السجل.
 * يعمل في `appendTransaction` فيقع الإصلاح داخل الخطوة نفسها،
 * ولا يُسجَّل في التراجع حتى لا يبتلع `Cmd+Z` إصلاحًا داخليًا.
 */
/**
 * هل يمكن لهذه المعاملات أن تُكرّر معرّف كتلة؟
 *
 * التكرار مصدره **نسخ سمات العقدة**: الشقّ بـ`Enter` واللصق. أما
 * كتابة حرف فتستبدل نصًّا داخل عقدة واحدة، ولا تُنشئ عقدة ولا تنسخ
 * سمة — فلا حاجة لمسح المستند كله بحثًا عن تكرار لا يمكن أن يقع.
 *
 * الفحص محافظ: أي شريحة تحمل محتوى غير سطري، أو أي تغيّر في عدد
 * الكتل، يُعيد المسح الكامل.
 */
function mayDuplicateBlockIds(
  trs: readonly Transaction[],
  before: number,
  after: number,
): boolean {
  if (before !== after) return true;
  for (const tr of trs) {
    for (const step of tr.steps) {
      const slice = (step as { slice?: Slice }).slice;
      if (!slice) return true; // خطوة لا نعرف أثرها — تُمسح احتياطًا
      let block = false;
      slice.content.forEach((n) => {
        if (!n.isInline) block = true;
      });
      if (block) return true;
    }
  }
  return false;
}

export function blockIdPlugin(): Plugin {
  return new Plugin({
    key: blockIdPluginKey,
    appendTransaction(trs, oldState, newState) {
      if (!trs.some((tr) => tr.docChanged)) return null;
      if (
        !mayDuplicateBlockIds(trs, oldState.doc.childCount, newState.doc.childCount)
      ) {
        return null;
      }

      const seen = new Set<string>();
      const fixes: Array<{ pos: number; id: string }> = [];

      newState.doc.forEach((node, pos) => {
        if (!(node.type.name in ROLE_FOR_NODE)) return;
        const id = node.attrs["id"];
        if (typeof id !== "string" || !id || seen.has(id)) {
          fixes.push({ pos, id: newBlockId() });
        } else {
          seen.add(id);
        }
      });

      if (fixes.length === 0) return null;

      const tr = newState.tr;
      for (const f of fixes) {
        const node = newState.doc.nodeAt(f.pos);
        if (node) tr.setNodeMarkup(f.pos, undefined, { ...node.attrs, id: f.id });
      }
      tr.setMeta("addToHistory", false);
      return tr;
    },
  });
}
