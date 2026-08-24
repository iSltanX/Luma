/**
 * مخطط المحرر — يطابق `Block` واحدًا لواحد.
 *
 * ثلاث عُقَد كتل فقط: فقرة وعنوانان. **بلا marks إطلاقًا** حتى تُعتمد
 * مجموعة التنسيق المرشحة في `Luma.md` §٥.
 *
 * غياب `marks` من المخطط ليس نقصًا بل حارس: اللصق لا يستطيع أن يُدخل
 * غامقًا أو مائلًا لأن المخطط لا يعرفهما، لا لأن الكود ينظّفهما.
 * والعربية لا تُمال أصلًا — §٥ **ثابت**.
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
  },
  marks: {},
});

export const NODE_FOR_ROLE: Readonly<Record<BlockRole, string>> = {
  body: "paragraph",
  h1: "heading1",
  h2: "heading2",
};

export const ROLE_FOR_NODE: Readonly<Record<string, BlockRole>> = {
  paragraph: "body",
  heading1: "h1",
  heading2: "h2",
};
