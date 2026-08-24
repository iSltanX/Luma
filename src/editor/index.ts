/**
 * الواجهة العامة لنواة المحرر.
 *
 * لا يستورد أحد من داخل `src/editor/` مباشرة — هذا هو المدخل.
 */

export { EditorCore } from "./EditorCore";
export type { EditorCoreOptions } from "./EditorCore";

export type { Block, BlockRole, InlineMark } from "./blocks";
export {
  BLOCK_ROLES,
  createBlock,
  newBlockId,
  emptyDocument,
  isEmptyDocument,
  isBlockRole,
  coerceBlocks,
  sameContent,
  wordCount,
  excerpt,
} from "./blocks";

export { cleanPastedText } from "./paste";
