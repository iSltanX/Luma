/**
 * التحويل بين `Block[]` ومستند المحرر — ذهابًا وإيابًا بلا فقد ولا إعادة ترتيب.
 *
 * `Block[]` هو المصدر. مستند المحرر تمثيل عامل عليه، لا نسخة موازية.
 */

import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import type { Block, BlockRole } from "./blocks";
import { createBlock, newBlockId } from "./blocks";
import { schema, NODE_FOR_ROLE, ROLE_FOR_NODE } from "./schema";

export function blocksToDoc(blocks: readonly Block[]): PMNode {
  const source = blocks.length > 0 ? blocks : [createBlock("body", "")];
  const nodes = source.map((b) => {
    const type = schema.nodes[NODE_FOR_ROLE[b.role]];
    if (!type) throw new Error(`دور كتلة غير معروف: ${b.role}`);
    return type.create({ id: b.id }, b.text ? schema.text(b.text) : null);
  });
  const doc = schema.nodes["doc"];
  if (!doc) throw new Error("مخطط بلا عقدة doc");
  return doc.create(null, nodes);
}

export function docToBlocks(doc: PMNode): Block[] {
  const out: Block[] = [];
  doc.forEach((node) => {
    const role: BlockRole = ROLE_FOR_NODE[node.type.name] ?? "body";
    const id =
      typeof node.attrs["id"] === "string" && node.attrs["id"]
        ? (node.attrs["id"] as string)
        : newBlockId();
    out.push({ id, role, text: node.textContent, marks: [] });
  });
  return out.length > 0 ? out : [createBlock("body", "")];
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
export function blockIdPlugin(): Plugin {
  return new Plugin({
    key: blockIdPluginKey,
    appendTransaction(trs, _oldState, newState) {
      if (!trs.some((tr) => tr.docChanged)) return null;

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
