/**
 * مخطط المحرر — يطابق `Block` واحدًا لواحد.
 *
 * خمس عُقَد كتل: فقرة وثلاثة عناوين واقتباس. وعلامةٌ واحدة داخل
 * السطر: **الوزن** — وهو ما تسمّيه `Luma.md` §٥ بديلَ التمييز
 * للعربية. **ولا مائل**: العربية لا تُمال.
 *
 * وحارسُ اللصق باقٍ حيث كان يجب أن يكون: `handlePaste` يُدخل نصًّا
 * عاديًا دائمًا، فلا يتسرّب تنسيقٌ عبر HTML وإن عرف المخطط الوزن.
 *
 * لكل كتلة سمة `id` تعيش مع العقدة عبر التحرير، ولا تُكتب في DOM:
 * إخراجها يعني تسرّبها إلى ما يُنسخ خارج التطبيق. استعادتها بعد اللصق
 * ليست مطلوبة — `blockIdPlugin` يمنح الكتل الجديدة معرّفات جديدة.
 */

import { Schema } from "prosemirror-model";
import type { BlockRole } from "./blocks";

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },

    text: { group: "inline" },

    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { id: { default: null as string | null } },
      // الاتجاه مصرَّح به على كل كتلة، لا مستنتَج من المحتوى — §٧
      toDOM: () => ["p", { dir: "rtl" }, 0],
      parseDOM: [{ tag: "p" }],
    },

    heading1: {
      group: "block",
      content: "inline*",
      attrs: { id: { default: null as string | null } },
      defining: true,
      toDOM: () => ["h1", { dir: "rtl" }, 0],
      parseDOM: [{ tag: "h1" }],
    },

    heading2: {
      group: "block",
      content: "inline*",
      attrs: { id: { default: null as string | null } },
      defining: true,
      toDOM: () => ["h2", { dir: "rtl" }, 0],
      parseDOM: [{ tag: "h2" }],
    },

    heading3: {
      group: "block",
      content: "inline*",
      attrs: { id: { default: null as string | null } },
      defining: true,
      toDOM: () => ["h3", { dir: "rtl" }, 0],
      parseDOM: [{ tag: "h3" }],
    },

    // اقتباس **كتلة واحدة** لا وعاءً يحوي فقرات: نموذج المحتوى مسطّح.
    quote: {
      group: "block",
      content: "inline*",
      attrs: { id: { default: null as string | null } },
      defining: true,
      toDOM: () => ["blockquote", { dir: "rtl" }, 0],
      parseDOM: [{ tag: "blockquote" }],
    },
  },
  marks: {
    strong: {
      toDOM: () => ["strong", 0],
      parseDOM: [{ tag: "strong" }, { tag: "b" }],
    },
  },
});

export const NODE_FOR_ROLE: Readonly<Record<BlockRole, string>> = {
  body: "paragraph",
  h1: "heading1",
  h2: "heading2",
  h3: "heading3",
  quote: "quote",
};

export const ROLE_FOR_NODE: Readonly<Record<string, BlockRole>> = {
  paragraph: "body",
  heading1: "h1",
  heading2: "h2",
  heading3: "h3",
  quote: "quote",
};
