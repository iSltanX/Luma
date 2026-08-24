/**
 * نصوص عربية اصطناعية للقياس — المرحلة ١.
 *
 * الهدف نص عربي واقعي: حروف متصلة، وهمزات، وتشكيل، وتاء مربوطة،
 * ولام ألف، ومقاطع لاتينية وأرقام مختلطة — لا «لوريم إيبسوم».
 */

import type { Block } from "./types";

const SENTENCES: readonly string[] = [
  "الكتابة فعل هادئ لا يحتمل الضجيج، وكل ما يزاحم النص يسرق منه شيئًا",
  "حين تفتح صفحة بيضاء لا تسأل عن الأدوات، بل عن الجملة الأولى",
  "المسافة بين الفكرة والكلمة هي كل ما يجب أن يُختصر",
  "قرأتُ أنّ أجمل النصوص كُتبت في غرف صغيرة وأوقات ضيّقة",
  "لا يحتاج الكاتب إلى لوحة تحكّم، يحتاج إلى ورقة لا تنطفئ",
  "الهدوء ليس زينةً في أداة الكتابة، بل شرطٌ لبقاء الانتباه",
  "كتبتُ الفقرة ثم حذفتها، ثم أعدتها كما هي بعد ساعتين",
  "في اللغة العربية تتصل الحروف، ولذلك لا تُمَال ولا تُبَاعَد",
  "الحفظ التلقائي يعني ألّا تفكّر في الحفظ أصلًا",
  "أهمّ ما في المحرّر أنّه يختفي حين تبدأ الكتابة",
  "الذاكرة الهادئة للنص أفضل من نظام إصدارات معقّد",
  "ما لا يخدم الكتابة أو يحمي المكتوب فهو خارج النطاق",
];

const MIXED: readonly string[] = [
  "استخدمتُ الإصدار ٢٫٣ من الأداة، ثم عدتُ إلى ١٫٩",
  "الملف محفوظ منذ ١٢ ثانية، والنسخة السابقة قبل ٤٥ دقيقة",
  "كتب المؤلف عن مفهوم flow ثم انتقل إلى الجانب العملي",
  "بين ٥٢٠ و٨٠٠ بكسل يبقى عمود النص مريحًا للقراءة الطويلة",
];

const HEADINGS: readonly string[] = [
  "في الهدوء",
  "عن المسافة بين الفكرة والكلمة",
  "الفصل الأول",
  "ملاحظات على الحافة",
];

let counter = 0;
function nextId(): string {
  counter += 1;
  return `b${counter}`;
}

/** فقرة بطول تقريبي بالكلمات. */
function paragraph(targetWords: number): string {
  const parts: string[] = [];
  let words = 0;
  let i = 0;
  while (words < targetWords) {
    // مقطع مختلط كل خمس جمل، ليختبر الاتجاه الثنائي في القياس نفسه.
    const pool = i % 5 === 4 ? MIXED : SENTENCES;
    const s = pool[(i * 7 + words) % pool.length] as string;
    parts.push(s);
    words += s.split(/\s+/).length;
    i += 1;
  }
  return parts.join("، ") + ".";
}

/**
 * يبني مستندًا بعدد كلمات تقريبي.
 * يوزّع عناوين H1/H2 بنسبة واقعية حتى يُقاس التخطيط على بنية مختلطة.
 */
export function buildDocument(targetWords: number): Block[] {
  counter = 0;
  const blocks: Block[] = [];
  let total = 0;
  let n = 0;

  blocks.push({ id: nextId(), role: "h1", text: HEADINGS[0] as string, marks: [] });

  while (total < targetWords) {
    if (n > 0 && n % 6 === 0) {
      blocks.push({
        id: nextId(),
        role: "h2",
        text: HEADINGS[(n / 6) % HEADINGS.length] as string,
        marks: [],
      });
    }
    const text = paragraph(60);
    blocks.push({ id: nextId(), role: "body", text, marks: [] });
    total += text.split(/\s+/).length;
    n += 1;
  }
  return blocks;
}

export function wordCount(blocks: readonly Block[]): number {
  return blocks.reduce(
    (sum, b) => sum + b.text.split(/\s+/).filter(Boolean).length,
    0,
  );
}

/** مستند فارغ — الحالة التي يفتح عليها التطبيق. */
export function emptyDocument(): Block[] {
  counter = 0;
  return [{ id: nextId(), role: "body", text: "", marks: [] }];
}
