/**
 * نصوص عربية اصطناعية — أداة تطوير لا تُشحن.
 *
 * تُستورد ديناميكيًا خلف `demo_mode` فقط، فلا تدخل حزمة الإنتاج.
 */

import { createBlock, type Block } from "../editor";

const SENTENCES = [
  "الكتابة فعل هادئ لا يحتمل الضجيج، وكل ما يزاحم النص يسرق منه شيئًا",
  "حين تفتح صفحة بيضاء لا تسأل عن الأدوات، بل عن الجملة الأولى",
  "المسافة بين الفكرة والكلمة هي كل ما يجب أن يُختصر",
  "قرأتُ أنّ أجمل النصوص كُتبت في غرف صغيرة وأوقات ضيّقة",
  "في اللغة العربية تتصل الحروف، ولذلك لا تُمَال ولا تُبَاعَد",
  "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ — سطر للتشكيل والهمزات",
  "كتب المؤلف عن مفهوم flow ثم انتقل إلى الجانب العملي",
  "بين ٥٢٠ و٨٠٠ بكسل يبقى عمود النص مريحًا للقراءة الطويلة",
];

const HEADINGS = ["في الهدوء", "عن المسافة", "الفصل الأول", "ملاحظات"];

export function buildLongDocument(targetWords: number): Block[] {
  const out: Block[] = [createBlock("h1", HEADINGS[0] as string)];
  let total = 0;
  let n = 0;
  while (total < targetWords) {
    if (n > 0 && n % 6 === 0) {
      out.push(
        createBlock("h2", HEADINGS[(n / 6) % HEADINGS.length] as string),
      );
    }
    const parts: string[] = [];
    let w = 0;
    let i = 0;
    while (w < 60) {
      const s = SENTENCES[(i * 3 + n) % SENTENCES.length] as string;
      parts.push(s);
      w += s.split(/\s+/).length;
      i += 1;
    }
    const text = parts.join("، ") + ".";
    out.push(createBlock("body", text));
    total += text.split(/\s+/).length;
    n += 1;
  }
  return out;
}
