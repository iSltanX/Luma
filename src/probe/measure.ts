/**
 * قياس القدرات — المرحلة ١.
 *
 * كل رقم هنا يُقاس داخل `Luma.app` على نافذة العرض الحقيقية.
 * لا رقم يُعتمد من متصفح ولا من خادم تطوير — `PLAN.md`.
 *
 * حدود القياس مُعلَنة لا مخفية:
 * - `keyToPaintMs` مُكمَّم بحدود الإطار (~١٦٫٧ms عند ٦٠Hz). يصلح للحكم
 *   «أنجز داخل إطار واحد أم لا»، ولا يصلح لترتيب المرشحين فيما دون ذلك.
 * - `insertCostMs` هو التكلفة المتزامنة الحقيقية: الإدراج + إجبار التخطيط.
 *   هذا هو الرقم الذي يُقارَن به.
 * - قياس البناء يسبقه تشغيل إحماء يُهمَل، وإلا حمل المرشح الأول تكلفة
 *   تحميل الوحدات وتسخين المترجم وحده.
 */

import type { Block, EditorCandidate } from "./types";

export interface Timing {
  p50: number;
  p95: number;
  max: number;
  samples: number;
}

export interface CandidateMeasurement {
  id: string;
  name: string;
  words: number;
  /** زمن بناء المحرر وعرض المستند كاملًا، بعد إحماء. */
  mountMs: number;
  /** التكلفة المتزامنة للإدراج مع إجبار التخطيط — رقم المقارنة. */
  insertCost: Timing;
  /** من الإدخال إلى الرسم التالي — مُكمَّم بالإطار. */
  keyToPaint: Timing;
  /** كم حرفًا أزالته عملية تراجع واحدة بعد دفقة متصلة. */
  undoBurstChars: number;
  /** هل يتيح الأساس ضبط نافذة التجميع برمجيًا؟ */
  undoConfigurable: boolean;
  /** هل غيّر تفعيل التركيز **النموذج المرجعي**؟ يجب أن يكون false. */
  focusMutatesModel: boolean;
  /** هل أعاد المحرر مستطيل مؤشر صالحًا؟ */
  caretRectAvailable: boolean;
  /** كم إطارًا لزم حتى استقر المؤشر. */
  framesToCaret: number;
  notes: string[];
}

function stats(xs: number[]): Timing {
  if (xs.length === 0) return { p50: 0, p95: 0, max: 0, samples: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) =>
    s[Math.min(s.length - 1, Math.floor(q * s.length))] as number;
  return {
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(s[s.length - 1] as number),
    samples: s.length,
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

const nextPaint = (): Promise<number> =>
  new Promise((r) => requestAnimationFrame(() => r(performance.now())));

/** يُدخل حرفًا عبر مسار الإدخال الحقيقي — نفس المسار للثلاثة. */
function insertChar(ch: string): void {
  document.execCommand("insertText", false, ch);
}

const ARABIC_SAMPLE = "الكتابة فعل هادئ لا يحتمل الضجيج وكل ما يزاحم النص";

export async function measureCandidate(
  candidate: EditorCandidate,
  host: HTMLElement,
  doc: Block[],
  words: number,
  warmupHost: HTMLElement,
): Promise<CandidateMeasurement> {
  const notes: string[] = [];

  // ── إحماء يُهمَل: تحميل الوحدات وتسخين المسارات ──────────────
  candidate.mount(warmupHost, doc.slice(0, Math.min(20, doc.length)));
  await nextPaint();
  candidate.destroy();
  warmupHost.innerHTML = "";

  // ── زمن البناء (مقيس بعد الإحماء) ──────────────────────────
  const t0 = performance.now();
  candidate.mount(host, doc);
  host.getBoundingClientRect(); // إجبار التخطيط قبل إيقاف الساعة
  const mountMs = round(performance.now() - t0);
  await nextPaint();

  candidate.focus();
  await nextPaint();

  // ── مستطيل المؤشر (القدرة ١) ───────────────────────────────
  // يُمنح حتى ٨ إطارات ليستقر التحديد، إنصافًا للأسس التي يكون
  // فيها `focus()` غير متزامن. عدد الإطارات اللازمة نفسه إشارة.
  let rect: DOMRect | null = null;
  let framesToCaret = 0;
  for (let i = 0; i < 8; i += 1) {
    rect = candidate.caretRect();
    if (rect && Number.isFinite(rect.top) && rect.height > 0) break;
    rect = null;
    framesToCaret += 1;
    await nextPaint();
  }
  const caretRectAvailable = !!rect;
  if (!caretRectAvailable) {
    notes.push("لم يُرجع مستطيل مؤشر خلال ٨ إطارات — الآلة الكاتبة متعذّرة");
  } else if (framesToCaret > 0) {
    notes.push(
      `استقرّ المؤشر بعد ${framesToCaret} إطارًا — التركيز غير متزامن`,
    );
  }

  // ── تكلفة الإدراج ──────────────────────────────────────────
  const sync: number[] = [];
  const paint: number[] = [];
  for (const ch of ARABIC_SAMPLE) {
    const start = performance.now();
    insertChar(ch);
    host.getBoundingClientRect(); // إجبار التخطيط: التكلفة الحقيقية
    sync.push(performance.now() - start);
    const painted = await nextPaint();
    paint.push(painted - start);
  }

  // ── تجميع التراجع (القدرة ٤) ───────────────────────────────
  const beforeUndo = totalChars(candidate.getBlocks());
  candidate.undo();
  await nextPaint();
  const afterUndo = totalChars(candidate.getBlocks());
  const undoBurstChars = Math.max(0, beforeUndo - afterUndo);
  if (undoBurstChars <= 1) {
    notes.push(`تراجع واحد أزال ${undoBurstChars} حرفًا — لا تجميع`);
  }
  if (!candidate.undoGroupingIsConfigurable) {
    notes.push(
      "نافذة التجميع غير قابلة للضبط: التجميع سلوك متصفح لا قرار منتج",
    );
  }

  // ── نقاء التركيز (القدرة ٢) — على النموذج المرجعي لا على النص ─
  const before = candidate.modelSignature();
  candidate.setFocusMode(true);
  await nextPaint();
  const after = candidate.modelSignature();
  candidate.setFocusMode(false);
  const focusMutatesModel = before !== after;
  if (focusMutatesModel) {
    notes.push("تفعيل التركيز غيّر النموذج المرجعي — مخالف لـ§٧");
  }

  candidate.destroy();

  return {
    id: candidate.id,
    name: candidate.name,
    words,
    mountMs,
    insertCost: stats(sync),
    keyToPaint: stats(paint),
    undoBurstChars,
    undoConfigurable: candidate.undoGroupingIsConfigurable,
    focusMutatesModel,
    caretRectAvailable,
    framesToCaret,
    notes,
  };
}

function totalChars(blocks: readonly Block[]): number {
  return blocks.reduce((n, b) => n + b.text.length, 0);
}
