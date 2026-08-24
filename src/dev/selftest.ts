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
import { theme } from "../lib/theme.svelte";
import { THEME_IDS } from "../tokens/themes";

export interface Check {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
}

/**
 * ينتظر الرسم التالي — **مع مهلة احتياطية**.
 *
 * macOS يعلّق `requestAnimationFrame` للنوافذ المحجوبة، فانتظاره
 * وحده يجعل الفحص يتوقف إلى الأبد إن لم تكن النافذة في المقدمة —
 * بلا خطأ ولا تقرير. المهلة تضمن أن يمضي الفحص ويُبلّغ دائمًا.
 *
 * القياسات تبقى ذات معنى فقط والنافذة في المقدمة، ولذلك يُفعّلها
 * سكربت التشغيل قبل البدء.
 */
const paint = (): Promise<void> =>
  new Promise((r) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        r();
      }
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 50);
  });

const wait = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

function type(text: string): void {
  for (const ch of text) document.execCommand("insertText", false, ch);
}

const round = (n: number) => Math.round(n * 1000) / 1000;

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export async function runSelfTest(
  editor: EditorCore,
  host: HTMLElement,
  invoke?: Invoke,
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

  // ── ٦ب · تبديل الثيم لا يفقد المؤشر ولا التمرير ────────────
  // معيار اكتمال المرحلة ٤: «يغيّر كل السطوح فورًا بلا وميض وبلا
  // فقد موضع التمرير أو المؤشر».
  {
    editor.setBlocks(buildLongDocument(3000));
    editor.focus();
    editor.caretToEnd();
    await paint();

    // يُبحث عن العنصر القابل للتمرير فعلًا لا عن صنف بعينه:
    // أصناف Svelte مُلحقة بلاحقة، والاعتماد عليها هشّ.
    let scroller: Element | null = host;
    const chain: string[] = [];
    while (scroller) {
      chain.push(
        `${scroller.tagName}.${(scroller.className || "").toString().split(" ")[0]}:${scroller.scrollHeight}/${scroller.clientHeight}`,
      );
      // حاوية تمرير حقيقية: محتوى فائض **و**`overflow` يسمح بالتمرير.
      // الفيض وحده لا يكفي — عنصر بلا `overflow:auto` لا يستجيب لـscrollTop.
      const oy = getComputedStyle(scroller).overflowY;
      if (
        scroller.scrollHeight > scroller.clientHeight + 4 &&
        (oy === "auto" || oy === "scroll")
      ) {
        break;
      }
      scroller = scroller.parentElement;
    }
    if (scroller) scroller.scrollTop = 400;
    await paint();

    const beforeScroll = scroller?.scrollTop ?? -1;
    const beforeCaret = editor.caretRect();
    const beforeBlocks = JSON.stringify(editor.getBlocks());
    const original = theme.id;

    // يمرّ على الثيمات الخمسة كلها
    const surfaces: string[] = [];
    for (const id of THEME_IDS) {
      theme.apply(id);
      await paint();
      // تُقرأ قيمة الرمز لا الخلفية المحسوبة: الخلفية تحت انتقال
      // زمني، فقراءتها أثناءه تُرجع قيمة وسيطة لا قيمة الثيم.
      surfaces.push(
        getComputedStyle(document.documentElement)
          .getPropertyValue("--surface-canvas")
          .trim(),
      );
    }
    theme.apply(original);
    await paint();

    const afterScroll = scroller?.scrollTop ?? -2;
    const afterCaret = editor.caretRect();
    const afterBlocks = JSON.stringify(editor.getBlocks());

    const distinct = new Set(surfaces).size;
    // تمرير صفري يجعل المقارنة بلا معنى: يُشترط أن يكون قد تحرّك فعلًا
    const scrollWasReal = beforeScroll > 0;
    const scrollKept = scrollWasReal && beforeScroll === afterScroll;
    const caretKept =
      !!beforeCaret && !!afterCaret &&
      Math.abs(beforeCaret.top - afterCaret.top) < 1 &&
      Math.abs(beforeCaret.left - afterCaret.left) < 1;
    const contentKept = beforeBlocks === afterBlocks;

    add(
      "theme-switch",
      "تبديل الثيم يحفظ المؤشر والتمرير والمحتوى",
      scrollKept && caretKept && contentKept && distinct === 5,
      `${distinct}/5 خلفيات متمايزة — تمرير ${beforeScroll}→${afterScroll}` +
        `${scrollWasReal ? "" : ` (لم يتحرّك — السلسلة: ${chain.join(" ← ")})`} — ` +
        `المؤشر ${caretKept ? "ثابت" : "تحرّك"} — المحتوى ${contentKept ? "مطابق" : "تغيّر"}`,
    );
  }

  // ── ٧ · دورة الحفظ الكاملة عبر النواة ──────────────────────
  if (invoke) {
    const id = `selftest-${Date.now().toString(36)}`;
    const blocks = [
      { id: "s1", role: "h1" as const, text: "في الهدوء", marks: [] },
      {
        id: "s2",
        role: "body" as const,
        text: "بِسْمِ اللَّهِ — كتبت hello «اقتباس» ١٢٣",
        marks: [],
      },
    ];

    try {
      await invoke("save_document", {
        payload: { id, title: null, blocks, createdAt: null },
      });
      const loaded = await invoke<{ blocks: typeof blocks; displayTitle: string }>(
        "load_document",
        { id },
      );
      const same =
        JSON.stringify(loaded.blocks.map((b) => [b.role, b.text])) ===
        JSON.stringify(blocks.map((b) => [b.role, b.text]));
      add(
        "persist-roundtrip",
        "الحفظ والقراءة يحفظان النص العربي كما هو",
        same && loaded.displayTitle === "في الهدوء",
        `العنوان المشتقّ: «${loaded.displayTitle}»`,
      );
    } catch (e) {
      add("persist-roundtrip", "الحفظ والقراءة", false, String(e));
    }

    // مساحة فارغة لا تُنشئ مستندًا — Luma.md §٢٠ مسألة ٣
    try {
      const emptyId = `selftest-empty-${Date.now().toString(36)}`;
      await invoke("save_document", {
        payload: {
          id: emptyId,
          title: null,
          blocks: [{ id: "e1", role: "body", text: "   ", marks: [] }],
          createdAt: null,
        },
      });
      const listing = await invoke<{ documents: Array<{ id: string }> }>(
        "list_documents",
      );
      const leaked = listing.documents.some((d) => d.id === emptyId);
      add(
        "empty-not-persisted",
        "مساحة فارغة لا تُحفظ ولا تظهر في المكتبة",
        !leaked,
        leaked ? "ظهر مستند فارغ" : "لا ضجيج في المكتبة",
      );
    } catch (e) {
      add("empty-not-persisted", "مساحة فارغة لا تُحفظ", false, String(e));
    }

    // الاستعادة تحفظ الحالة الحالية أولًا — §١٧ مبدأ ٥
    try {
      const rid = `selftest-rev-${Date.now().toString(36)}`;
      await invoke("save_document", {
        payload: {
          id: rid,
          title: null,
          blocks: [{ id: "r1", role: "body", text: "النسخة الأولى" }],
          createdAt: null,
        },
      });
      const revs1 = await invoke<Array<{ id: string }>>("list_revisions", {
        documentId: rid,
      });
      await invoke("save_document", {
        payload: {
          id: rid,
          title: null,
          blocks: [
            {
              id: "r1",
              role: "body",
              text: "نص ثانٍ مختلف تمامًا " + "ا".repeat(120),
            },
          ],
          createdAt: null,
        },
      });

      const target = revs1[0];
      if (!target) throw new Error("لا لقطة أولى");
      const restored = await invoke<{
        blocks: Array<{ text: string }>;
        guardRevisionId: string;
      }>("restore_revision", { documentId: rid, revisionId: target.id });

      const revsAfter = await invoke<Array<{ id: string; source: string }>>(
        "list_revisions",
        { documentId: rid },
      );
      const guardKept = revsAfter.some((r) => r.id === restored.guardRevisionId);
      add(
        "restore-guard",
        "الاستعادة تحفظ الحالة الحالية أولًا",
        guardKept && restored.blocks[0]?.text === "النسخة الأولى",
        `اللقطتان في السجل (${revsAfter.length}) وشبكة الأمان محفوظة`,
      );
    } catch (e) {
      add("restore-guard", "الاستعادة تحفظ الحالة الحالية", false, String(e));
    }
  }

  return checks;
}
