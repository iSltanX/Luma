/**
 * فحص ذاتي داخل `Luma.app` — أداة تطوير لا تُشحن.
 *
 * يغطي ما لا تحكم عليه اختبارات الوحدة: هندسة المؤشر تحت RTL، وتجميع
 * التراجع عبر مسار الإدخال الحقيقي، وثبات المؤشر عند تغيير الخط،
 * والأداء على مستند طويل. لا WebDriver لـWKWebView على macOS، فالفحص
 * يعمل داخل التطبيق ويكتب نتيجته إلى ملف.
 */

import type { EditorCore } from "../editor";
import { buildLongDocument } from "./corpus";

export interface Check {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
}

const paint = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => r()));

const wait = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

function type(text: string): void {
  for (const ch of text) document.execCommand("insertText", false, ch);
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export async function runSelfTest(
  editor: EditorCore,
  host: HTMLElement,
): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (id: string, name: string, passed: boolean, detail: string) =>
    checks.push({ id, name, passed, detail });

  // ── ١ · المؤشر يتقدّم يسارًا في النص العربي ────────────────
  // القياس الصحيح ليس بُعد المؤشر عن حافة العمود — السطر القصير
  // يُحاذى يمينًا فيقع طرفه الأيسر في وسط العمود. الفيصل أن التقدّم
  // في النص يحرّك المؤشر **يسارًا**: بداية السطر يمينًا ونهايته يسارًا.
  editor.setBlocks([
    { id: "t1", role: "body", text: "الكتابة فعل هادئ", marks: [] },
  ]);
  editor.focus();
  await paint();
  const atStart = editor.caretRect();

  editor.caretToEnd();
  await paint();
  const atEnd = editor.caretRect();

  if (!atStart || !atEnd) {
    add("caret-rtl", "المؤشر يتقدّم يسارًا في النص العربي", false, "لا مستطيل مؤشر");
  } else {
    const moved = Math.round(atStart.left - atEnd.left);
    add(
      "caret-rtl",
      "المؤشر يتقدّم يسارًا في النص العربي",
      atEnd.left < atStart.left,
      `البداية x=${Math.round(atStart.left)} والنهاية x=${Math.round(atEnd.left)} — تحرّك ${moved}px يسارًا`,
    );
  }

  // ── ١ب · السطر العربي محاذى يمينًا ─────────────────────────
  const line = host.querySelector<HTMLElement>(".luma-editor p");
  if (line && atEnd) {
    const lineBox = line.getBoundingClientRect();
    const gapRight = Math.round(lineBox.right - (atStart?.left ?? 0));
    add(
      "line-rtl",
      "السطر العربي يبدأ من الحافة اليمنى",
      gapRight <= 4,
      `بداية النص على بُعد ${gapRight}px من يمين الفقرة`,
    );
  }

  // ── ٢ · تراجع واحد يزيل دفقة لا حرفًا ──────────────────────
  editor.setBlocks([{ id: "t2", role: "body", text: "", marks: [] }]);
  editor.focus();
  await paint();

  type("الكتابة فعل هادئ لا يحتمل الضجيج");
  await paint();
  const beforeUndo = editor.getBlocks()[0]?.text.length ?? 0;
  editor.undo();
  await paint();
  const afterUndo = editor.getBlocks()[0]?.text.length ?? 0;
  const removed = beforeUndo - afterUndo;
  add(
    "undo-burst",
    "تراجع واحد يزيل دفقة كتابة",
    removed > 1,
    `أزال ${removed} من ${beforeUndo} حرفًا`,
  );

  // ── ٣ · التوقف يبدأ دفقة جديدة ─────────────────────────────
  editor.setBlocks([{ id: "t3", role: "body", text: "", marks: [] }]);
  editor.focus();
  await paint();

  type("الجملة الأولى");
  await wait(700); // أطول من نافذة التجميع (٥٠٠ms)
  type(" والثانية");
  await paint();
  const twoBursts = editor.getBlocks()[0]?.text ?? "";
  editor.undo();
  await paint();
  const afterOne = editor.getBlocks()[0]?.text ?? "";
  const keptFirst = afterOne.startsWith("الجملة") && afterOne !== twoBursts;
  add(
    "undo-groups",
    "التوقف يبدأ دفقة تراجع جديدة",
    keptFirst,
    `بعد تراجع واحد بقي: «${afterOne}»`,
  );

  // ── ٤ · تفعيل التركيز لا يمسّ المحتوى ──────────────────────
  editor.setBlocks(buildLongDocument(400));
  await paint();
  const beforeFocus = JSON.stringify(editor.getBlocks());
  editor.setFocusMode(true);
  await paint();
  const duringFocus = JSON.stringify(editor.getBlocks());
  editor.setFocusMode(false);
  add(
    "focus-purity",
    "التركيز لا يغيّر المحتوى",
    beforeFocus === duringFocus,
    beforeFocus === duringFocus ? "المحتوى مطابق" : "تغيّر المحتوى",
  );

  // ── ٥ · تغيير حجم الخط يحفظ موضع المؤشر ────────────────────
  editor.setBlocks([
    { id: "t5", role: "body", text: "الكتابة فعل هادئ لا يحتمل الضجيج", marks: [] },
  ]);
  editor.focus();
  editor.caretToEnd();
  await paint();
  const blocksBefore = JSON.stringify(editor.getBlocks());

  const el = host.querySelector<HTMLElement>(".luma-editor");
  const prev = el?.style.fontSize ?? "";
  if (el) el.style.fontSize = "24px";
  await paint();
  const rectAfter = editor.caretRect();
  const blocksAfter = JSON.stringify(editor.getBlocks());
  if (el) el.style.fontSize = prev;
  add(
    "font-change",
    "تغيير الحجم يحفظ المؤشر ولا يمسّ المحتوى",
    !!rectAfter && blocksBefore === blocksAfter,
    rectAfter ? "المؤشر باقٍ والمحتوى مطابق" : "فُقد المؤشر",
  );

  // ── ٥ب · مسار اللصق ────────────────────────────────────────
  // يختبر `handlePaste` والتنظيف عبر حدث لصق حقيقي. لا يختبر جسر
  // حافظة النظام نفسه — ذاك يحتاج ضغط مفاتيح، وهو من بنود التحقق
  // اليدوي في `docs/arabic-battery.md`.
  editor.setBlocks([{ id: "t6", role: "body", text: "", marks: [] }]);
  editor.focus();
  await paint();

  const dirty =
    "\u200fبِسْمِ اللَّهِ\u202a — كتبت hello\u200e للعالم\u202c «اقتباس»\u200b ١٢٣";
  const dt = new DataTransfer();
  dt.setData("text/plain", dirty);
  dt.setData("text/html", "<b>بِسْمِ</b> <i>اللَّهِ</i>");
  host
    .querySelector(".luma-editor")
    ?.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  await paint();

  const pasted = editor.getBlocks()[0]?.text ?? "";
  const html = host.querySelector(".luma-editor")?.innerHTML ?? "";
  const noBidi = !/[\u200e\u200f\u202a-\u202e\u2066-\u2069\u200b]/.test(pasted);
  const noFormat = !/<(b|i|strong|em)\b/i.test(html);
  const keptText = pasted.includes("hello") && pasted.includes("«اقتباس»");
  add(
    "paste",
    "اللصق ينظّف محارف الاتجاه ولا يُدخل تنسيقًا",
    noBidi && noFormat && keptText,
    `«${pasted}» — اتجاه:${noBidi ? "نظيف" : "ملوّث"} تنسيق:${noFormat ? "لا" : "تسرّب"}`,
  );

  // ── ٥ج · قواعد الطباعة العربية داخل التطبيق ────────────────
  // تُفحص هنا لا في Playwright وحده: القاعدة أن لا بند يُعلَّم ممرًّا
  // إلا داخل `Luma.app`.
  const ed = host.querySelector<HTMLElement>(".luma-editor");
  if (ed) {
    const cs = getComputedStyle(ed);
    const tracking = cs.letterSpacing;
    const lh = cs.lineHeight;
    const trackingOk = tracking === "normal" || parseFloat(tracking) === 0;
    const lhOk = lh !== "normal" && parseFloat(lh) > 20;

    const tooSmall: string[] = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const t = el.textContent?.trim() ?? "";
      if (!/[\u0600-\u06FF]/.test(t)) continue;
      if (el.children.length > 0) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 12) tooSmall.push(`${el.tagName}:${size}px`);
    }

    add(
      "typography",
      "التتبّع صفر وارتفاع السطر صريح ولا نص عربي دون ١٢ نقطة",
      trackingOk && lhOk && tooSmall.length === 0,
      `تتبّع ${tracking} — ارتفاع ${lh} — مخالفات الحجم: ${tooSmall.length ? tooSmall.join(", ") : "لا شيء"}`,
    );
  }

  // ── ٦ · الأداء على مستند طويل ──────────────────────────────
  const long = buildLongDocument(20000);
  const t0 = performance.now();
  editor.setBlocks(long);
  host.getBoundingClientRect();
  const mountMs = round(performance.now() - t0);

  editor.focus();
  editor.caretToEnd();
  await paint();

  const samples: number[] = [];
  for (const ch of "الكتابة فعل هادئ لا يحتمل الضجيج") {
    const s = performance.now();
    document.execCommand("insertText", false, ch);
    host.getBoundingClientRect();
    samples.push(performance.now() - s);
    await paint();
  }
  samples.sort((a, b) => a - b);
  const p50 = round(samples[Math.floor(samples.length / 2)] ?? 0);
  const p95 = round(samples[Math.floor(samples.length * 0.95)] ?? 0);
  const wordsTotal = long.reduce(
    (n, b) => n + b.text.split(/\s+/).filter(Boolean).length,
    0,
  );
  add(
    "long-doc",
    "مستند ٢٠ ألف كلمة",
    p95 < 16,
    `${wordsTotal} كلمة — بناء ${mountMs}ms، حرف p50 ${p50}ms / p95 ${p95}ms`,
  );

  return checks;
}
