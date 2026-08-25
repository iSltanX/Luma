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
import { BUDGETS, LARGE_LIBRARY, LARGE_DOCUMENT, type Budget } from "./budgets";

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
  /**
   * علامات الإقلاع الحقيقية بالمللي منذ بدء العملية.
   *
   * تُلتقط في `App.svelte` أثناء الإقلاع نفسه — لا هنا. قياسها من
   * داخل الفحص يقرأ الساعة بعد ثلاثين بندًا سبقته، فيعطي رقمًا لا
   * علاقة له بما ينتظره المستخدم (قِيس: ٣٤٧٧ms مقابل الحقيقة).
   */
  startup: Record<string, number> = {},
): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (id: string, name: string, passed: boolean, detail: string) =>
    checks.push({ id, name, passed, detail });

  /**
   * يقارن قياسًا بميزانيته ويُسقط الفحص عند التجاوز.
   *
   * هذا هو الفرق بين ميزانية «مثبتة» وميزانية «محققة» — معيار اكتمال
   * المرحلة ٧. الرقم المطبوع في تقرير لا يقرؤه أحد ليس بوابة.
   */
  const budget = (b: Budget, value: number, extra = "") =>
    add(
      b.id,
      b.what,
      value <= b.max,
      `${round(value)}${b.unit} من ${b.max}${b.unit}` +
        (extra ? ` — ${extra}` : "") +
        (value <= b.max ? "" : "  ⚠️ تجاوز الميزانية"),
    );

  /**
   * بصمة مكتبة المستخدم قبل الفحص.
   *
   * الفحص يكتب عبر مسار الإدخال الحقيقي، وكان ذلك المسار يمرّ بالحفظ
   * التلقائي فيكتب فوق المستند المستأنف. أُصلح بفصل الجلسة، وهذه
   * البصمة تحرس الإصلاح: أداةٌ تفحص لا تُتلف ما تفحصه.
   */
  type DocFingerprint = { id: string; updatedAt: number };
  const fingerprint = async (): Promise<DocFingerprint[]> => {
    if (!invoke) return [];
    try {
      const listing = await invoke<{ documents: DocFingerprint[] }>(
        "list_documents",
      );
      return listing.documents
        .filter((d) => !d.id.startsWith("selftest-"))
        .map((d) => ({ id: d.id, updatedAt: d.updatedAt }))
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch {
      return [];
    }
  };
  const libraryBefore = await fingerprint();

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

  // ── ٦ج · سطح الكتابة: استمرارية وتحديد وتجاوب ──────────────
  {
    editor.setBlocks(buildLongDocument(4000));
    await paint();

    const sheet = document.querySelector(".sheet");
    const scroller = document.querySelector(".scroller");
    const ed = host.querySelector(".luma-editor");

    if (sheet && scroller && ed) {
      // ١ · الورقة تحيط بالنص كاملًا ولا تنتهي قبله
      const sh = sheet.getBoundingClientRect().height;
      const eh = ed.getBoundingClientRect().height;
      const sheetOverflows = sheet.scrollHeight > Math.ceil(sh) + 2;
      add(
        "sheet-continuous",
        "الورقة تحيط بالنص كاملًا",
        sh > eh && !sheetOverflows,
        `الورقة ${Math.round(sh)}px والمحرر ${Math.round(eh)}px — ` +
          `${sheetOverflows ? "المحتوى يفيض منها" : "لا فيض"}`,
      );

      // ٢ · مسؤول تمرير واحد
      const many: string[] = [];
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const oy = getComputedStyle(el).overflowY;
        if (
          (oy === "auto" || oy === "scroll") &&
          el.scrollHeight > el.clientHeight + 4
        ) {
          many.push(String(el.className).split(" ")[0] ?? el.tagName);
        }
      }
      add(
        "single-scroller",
        "مسؤول تمرير واحد لا طبقات مكررة",
        many.length === 1,
        many.length ? many.join(" + ") : "لا مُمرِّر",
      );

      // ٣ · النص داخل الورقة عند البداية والوسط والنهاية
      const max = scroller.scrollHeight - scroller.clientHeight;
      const spots: string[] = [];
      for (const pos of [0, Math.round(max / 2), max]) {
        scroller.scrollTop = pos;
        await paint();
        const box = sheet.getBoundingClientRect();
        const outside = Array.from(host.querySelectorAll(".luma-editor p"))
          .map((n) => n.getBoundingClientRect())
          .filter((r) => r.bottom > 0 && r.top < window.innerHeight)
          .some((r) => r.top < box.top - 1 || r.bottom > box.bottom + 1);
        if (outside) spots.push(String(pos));
      }
      scroller.scrollTop = 0;
      await paint();
      add(
        "sheet-scroll",
        "النص يبقى داخل الورقة عند التمرير",
        spots.length === 0,
        spots.length ? `خرج عند: ${spots.join(", ")}` : "البداية والوسط والنهاية سليمة",
      );

      // ٤ · لا سلف غير قابل للتحديد يحيط بالمحرر
      const blockers: string[] = [];
      let el: Element | null = ed;
      while (el && el !== document.body) {
        const cs = getComputedStyle(el);
        if ((cs.webkitUserSelect || cs.userSelect) === "none") {
          blockers.push(String(el.className).split(" ")[0] ?? el.tagName);
        }
        el = el.parentElement;
      }
      add(
        "selection-ancestors",
        "لا سلف بـuser-select:none يحيط بالمحرر",
        blockers.length === 0,
        blockers.length ? blockers.join(" ← ") : "السلسلة نظيفة",
      );

      // ٥ · التحديد يتبع الأسطر لا كتلة واحدة
      const para = host.querySelector(".luma-editor p");
      const node = para?.firstChild;
      let rectInfo = "لا فقرة";
      let follows = false;
      if (node && node.textContent) {
        const r = document.createRange();
        r.setStart(node, 0);
        r.setEnd(node, node.textContent.length);
        const rects = Array.from(r.getClientRects());
        const tallest = Math.max(...rects.map((x) => x.height));
        follows = rects.length > 1 && tallest < 60;
        rectInfo = `${rects.length} مستطيلًا، أطولها ${Math.round(tallest)}px`;
      }
      add("selection-lines", "التحديد يتبع الأسطر", follows, rectInfo);

      // ٦ · الورقة متمايزة عن الخلفية في الثيمات الخمسة
      const flat: string[] = [];
      const originalTheme = theme.id;
      for (const id of THEME_IDS) {
        theme.apply(id);
        await paint();
        const cs = getComputedStyle(sheet);
        const sameBg =
          cs.backgroundColor ===
          getComputedStyle(scroller).backgroundColor;
        const noBorder = parseFloat(cs.borderTopWidth) < 1;
        if (sameBg && noBorder) flat.push(id);
      }
      theme.apply(originalTheme);
      await paint();
      add(
        "sheet-visible",
        "الورقة متمايزة عن الخلفية في الثيمات الخمسة",
        flat.length === 0,
        flat.length ? `تذوب في: ${flat.join(", ")}` : "متمايزة في الخمسة",
      );

      // ٧ · عمود الكتابة داخل المدى الموثَّق ويستفيد من العرض
      const cs = getComputedStyle(sheet);
      const pad = parseFloat(cs.paddingInlineStart);
      const measure = Math.round(sheet.getBoundingClientRect().width - pad * 2);
      const ratio =
        sheet.getBoundingClientRect().width / scroller.clientWidth;
      add(
        "measure",
        "عمود الكتابة داخل ٥٢٠–٨٠٠ ويستفيد من العرض",
        measure >= 500 && measure <= 800 && ratio > 0.6,
        `العمود ${measure}px ويشغل ${Math.round(ratio * 100)}٪ من العرض`,
      );
    }
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

    // ملاحظة: كان هنا بندٌ اسمه «المُفرَغ يُحذف عند مغادرته» — أُزيل.
    // الجلسة مفصولة في وضع الفحص (`session.dispose()`)، فأيّ بند هنا
    // ينادي `delete_document` مباشرةً يقيس `remove_dir_all` — وهو
    // مقيسٌ في `document.rs` — لا يقيس القرار. بوابةٌ خضراء لا تحرس
    // شيئًا أسوأ من غياب البوابة: تكذب على من يقرؤها.

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

  // ── ٨ · الإطار واللوحات ────────────────────────────────────
  // معيار اكتمال المرحلة ٥: «فتح أي لوحة لا يزيح الورقة ولا يفقد
  // المؤشر ولا التحديد ولا موضع التمرير»، و«كل لوحة تعمل بالماوس
  // وبلوحة المفاتيح معًا».
  {
    const entry = (id: string) =>
      document.querySelector<HTMLButtonElement>(`[data-surface="${id}"] button`);
    const panel = () => document.querySelector("[data-panel]");

    // ٨أ · طرف أزرار النظام محجوز، وحالة الحفظ في الطرف المقابل
    {
      const side = document.documentElement.dataset["windowControls"];
      const bar = document.querySelector(".titlebar")?.getBoundingClientRect();
      const save = document.querySelector(".save")?.getBoundingClientRect();
      if (side && bar && save) {
        const fromLeft = Math.round(save.left - bar.left);
        const fromRight = Math.round(bar.right - save.right);
        const opposite = side === "left" ? fromRight < fromLeft : fromLeft < fromRight;
        add(
          "window-controls",
          "حالة الحفظ في الطرف المقابل لأزرار النظام",
          opposite,
          `الأزرار ${side === "left" ? "يسارًا" : "يمينًا"} — ` +
            `حالة الحفظ على بُعد ${fromLeft}px من اليسار و${fromRight}px من اليمين`,
        );
      } else {
        add(
          "window-controls",
          "حالة الحفظ في الطرف المقابل لأزرار النظام",
          false,
          `تعذّر القياس — الجانب: ${side ?? "غير مضبوط"}`,
        );
      }
    }

    // ٨ب · فتح لوحة لا يمسّ الورقة ولا التمرير ولا المؤشر
    editor.setBlocks(buildLongDocument(4000));
    editor.focus();
    editor.caretToEnd();
    await paint();

    const scroller = document.querySelector(".scroller");
    if (scroller) scroller.scrollTop = 400;
    await paint();

    const sheetOf = () =>
      document.querySelector(".sheet")?.getBoundingClientRect().width ?? 0;
    const before = {
      sheet: Math.round(sheetOf()),
      content: scroller?.scrollHeight ?? 0,
      scroll: scroller?.scrollTop ?? -1,
      caret: editor.caretRect(),
    };

    entry("library")?.click();
    await wait(120);
    await paint();

    const opened = {
      sheet: Math.round(sheetOf()),
      content: scroller?.scrollHeight ?? 0,
      scroll: scroller?.scrollTop ?? -2,
      caret: editor.caretRect(),
    };
    const panelBox = panel()?.getBoundingClientRect();

    const sameSheet = before.sheet === opened.sheet;
    const sameContent = before.content === opened.content;
    const sameScroll = before.scroll > 0 && before.scroll === opened.scroll;
    // المؤشر يتحرّك أفقيًا مع إعادة تمركز الورقة، ولا يتحرّك رأسيًا:
    // موضعه في النص هو ما يجب أن يبقى، وقد بقي إن ثبت السطر.
    const sameCaretLine =
      !!before.caret &&
      !!opened.caret &&
      Math.abs(before.caret.top - opened.caret.top) < 1;

    add(
      "panel-open",
      "فتح لوحة لا يمسّ الورقة ولا التمرير ولا سطر المؤشر",
      !!panelBox &&
        Math.round(panelBox.width) === 320 &&
        sameSheet &&
        sameContent &&
        sameScroll &&
        sameCaretLine,
      `اللوحة ${panelBox ? Math.round(panelBox.width) : 0}px — ` +
        `الورقة ${before.sheet}→${opened.sheet} — ` +
        `ارتفاع المحتوى ${before.content}→${opened.content} — ` +
        `التمرير ${before.scroll}→${opened.scroll} — ` +
        `سطر المؤشر ${sameCaretLine ? "ثابت" : "تحرّك"}`,
    );

    // ٨ج · Esc يغلق، والتركيز يعود إلى النص
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    // خروج اللوحة صار حركة ٣٠٠ms (اللغة البصرية §١١ — FEEL-PLAN M0)،
    // فالإغلاق يُقاس بعد سقف الحركة لا لحظة Esc.
    await wait(360);
    await paint();
    add(
      "panel-escape",
      "Esc يغلق اللوحة ويعيد التركيز إلى النص",
      panel() === null && editor.hasFocus,
      panel() === null
        ? `أُغلقت، والتركيز ${editor.hasFocus ? "في النص" : "خارجه"}`
        : "بقيت مفتوحة",
    );

    // ٨د · مدخل واحد لكل لوحة، ولوحة واحدة في كل وقت
    entry("library")?.click();
    await wait(120);
    entry("history")?.click();
    await wait(120);
    await paint();
    const openPanels = document.querySelectorAll("[data-panel]").length;
    const which = panel()?.getAttribute("data-panel") ?? "لا شيء";
    entry("history")?.click();
    await wait(80);
    add(
      "single-panel",
      "لوحة واحدة مفتوحة في كل وقت",
      openPanels === 1 && which === "history",
      `عدد اللوحات ${openPanels} — المفتوحة: ${which}`,
    );

    // ٨هـ · المعاينة قراءة فقط: لا حرف يدخل النص
    editor.setBlocks([
      { id: "p1", role: "body", text: "نص المعاينة", marks: [] },
    ]);
    editor.focus();
    editor.caretToEnd();
    await paint();
    const beforeReadonly = JSON.stringify(editor.getBlocks());
    editor.setEditable(false);
    await paint();
    type("محاولة كتابة");
    await paint();
    const afterReadonly = JSON.stringify(editor.getBlocks());
    editor.setEditable(true);
    add(
      "preview-readonly",
      "المعاينة قراءة فقط لا تقبل حرفًا",
      beforeReadonly === afterReadonly,
      beforeReadonly === afterReadonly ? "النص لم يتغيّر" : "تسرّبت كتابة",
    );
  }

  // ── ٩ · المحرر المريح والتخصيص ─────────────────────────────
  // ما لا يُقاس إلا داخل التطبيق: خطوط النظام الحقيقية، وتغطيتها،
  // وأن تغيير العرض لا يمسّ الملف المحفوظ.
  {
    // ٩أ · التركيز طبقة عرض: لا يغيّر بايتًا في المحتوى
    editor.setBlocks(buildLongDocument(600));
    await paint();
    const beforeFocus = JSON.stringify(editor.getBlocks());
    editor.setFocusMode(true);
    await paint();
    const dimmed = document.querySelectorAll(".luma-dimmed").length;
    const duringFocus = JSON.stringify(editor.getBlocks());
    editor.setFocusMode(false);
    await paint();
    add(
      "comfort-focus",
      "التركيز يخفت المحيط ولا يغيّر بايتًا",
      dimmed > 0 && beforeFocus === duringFocus,
      `خُفِّتت ${dimmed} فقرة، والمحتوى ${beforeFocus === duringFocus ? "مطابق" : "تغيّر"}`,
    );

    // ٩ب · تفضيلات العرض متغيّرات على الجذر لا سمات على الكتل
    //
    // وبند بطارية العربية: «تغيير الثيم أو الخط أو الحجم يحفظ موضع
    // المؤشر والتمرير».
    const root = document.documentElement;
    const savedSize = root.style.getPropertyValue("--luma-editor-size");
    const savedMeasure = root.style.getPropertyValue("--editor-measure");
    const beforePrefs = JSON.stringify(editor.getBlocks());

    const scroller = document.querySelector(".scroller");
    editor.focus();
    editor.caretToEnd();
    if (scroller) scroller.scrollTop = 300;
    await paint();
    const caretBefore = editor.caretRect();
    const scrollBefore = scroller?.scrollTop ?? -1;

    root.style.setProperty("--luma-editor-size", "26px");
    root.style.setProperty("--editor-measure", "560px");
    await paint();
    const ed = host.querySelector<HTMLElement>(".luma-editor");
    const applied = ed ? getComputedStyle(ed).fontSize : "";
    const sheetNow = document.querySelector(".sheet");
    const measured = sheetNow
      ? Math.round(
          sheetNow.getBoundingClientRect().width -
            parseFloat(getComputedStyle(sheetNow).paddingInlineStart) * 2,
        )
      : -1;
    const afterPrefs = JSON.stringify(editor.getBlocks());
    const caretAfter = editor.caretRect();
    const scrollAfter = scroller?.scrollTop ?? -2;

    root.style.setProperty("--luma-editor-size", savedSize || "");
    root.style.setProperty("--editor-measure", savedMeasure || "");
    await paint();

    add(
      "prefs-display-only",
      "تغيير الحجم والعرض يظهر فورًا ولا يمسّ المحتوى",
      applied === "26px" && measured === 560 && beforePrefs === afterPrefs,
      `الحجم ${applied} والعمود ${measured}px — المحتوى ${beforePrefs === afterPrefs ? "مطابق" : "تغيّر"}`,
    );

    // المؤشر يبقى موجودًا والتمرير لا يُصفَّر. الموضع بالبكسل يتغيّر
    // حتمًا لأن النص أُعيد لفّه بمقاس أكبر — المصون هو ألّا يضيع.
    add(
      "prefs-keep-caret",
      "تغيير الحجم والعرض يحفظ المؤشر والتمرير",
      !!caretBefore && !!caretAfter && scrollBefore > 0 && scrollAfter > 0,
      `المؤشر ${caretAfter ? "باقٍ" : "فُقد"} — التمرير ${Math.round(scrollBefore)}→${Math.round(scrollAfter)}`,
    );
  }

  // ── ٩ج · الخطوط من مصادرها الثلاثة، بلا شبكة ────────────────
  if (invoke) {
    try {
      type Font = {
        id: string;
        familyName: string;
        source: string;
        arabicCoverage: string;
      };
      const fonts = await invoke<Font[]>("list_fonts");
      const system = fonts.filter((f) => f.source === "system");
      const bundled = fonts.filter((f) => f.source === "bundled");
      const arabic = system.filter((f) => f.arabicCoverage === "full").length;
      const latinOnly = system.filter((f) => f.arabicCoverage === "none").length;

      add(
        "fonts-enumerated",
        "خطوط النظام تُعدَّد بأسمائها وتُقرأ تغطيتها",
        system.length > 20 && bundled.length === 1 && arabic > 0 && latinOnly > 0,
        `${system.length} عائلة نظام — ${arabic} بتغطية عربية كاملة و${latinOnly} بلا عربية`,
      );

      // إتاحة فعلية لطبقة العرض: يُقاس عرض النص بخط عربي من النظام
      const probe = document.createElement("span");
      probe.textContent = "بسم الله الرحمن الرحيم";
      probe.style.cssText =
        "position:absolute;visibility:hidden;font-size:40px;white-space:nowrap";
      document.body.appendChild(probe);
      probe.style.fontFamily = '"Almarai", sans-serif';
      const wAlmarai = probe.getBoundingClientRect().width;
      const target = system.find((f) => f.arabicCoverage === "full");
      probe.style.fontFamily = `"${target?.familyName ?? "Geeza Pro"}", sans-serif`;
      const wSystem = probe.getBoundingClientRect().width;
      probe.remove();

      add(
        "fonts-usable",
        "خط النظام يصل طبقة العرض فعلًا",
        wAlmarai > 0 && wSystem > 0 && Math.abs(wAlmarai - wSystem) > 1,
        `«${target?.familyName ?? "?"}» يرسم النص بعرض ${Math.round(wSystem)}px مقابل ${Math.round(wAlmarai)}px لـAlmarai`,
      );
    } catch (e) {
      add("fonts-enumerated", "خطوط النظام تُعدَّد", false, String(e));
    }
  }

  // ── ٩د · الخط المستورد يصل نافذة العرض ──────────────────────
  //
  // **السؤال الحاسم في المسألة ٨.** نافذة العرض في WebKit عملية
  // مستقلة عن عملية التطبيق، وتسجيل الخط في «نطاق العملية» قد لا
  // يعبر إليها. لا يُفترض الجواب: يُقاس عرض نصّ بالخط المسجَّل ويُقارن
  // ببديله. تساويهما يعني أن الخط لم يصل.
  //
  // يعمل هذا الفحص إن وُجد خط مستورد اسم عائلته `LumaProbeFont`
  // (يزرعه سكربت التحقق)؛ وإلا يُتخطّى بلا ادّعاء.
  if (invoke) {
    try {
      type Font = { familyName: string; source: string };
      const fonts = await invoke<Font[]>("list_fonts");
      const probe = fonts.find(
        (f) => f.source === "imported" && f.familyName === "LumaProbeFont",
      );
      if (probe) {
        // خط `@font-face` يُحمَّل عند أول استعمال، والقياس قبل تحميله
        // يعطي مقاسات البديل. يُنتظر التحميل صراحةً.
        let loaded = false;
        try {
          await document.fonts.load('40px "LumaProbeFont"', "بسم الله");
          loaded = document.fonts.check('40px "LumaProbeFont"');
        } catch {
          loaded = false;
        }

        const span = document.createElement("span");
        span.textContent = "بسم الله الرحمن الرحيم";
        span.style.cssText =
          "position:absolute;visibility:hidden;font-size:40px;white-space:nowrap";
        document.body.appendChild(span);
        span.style.fontFamily = "serif";
        const wFallback = span.getBoundingClientRect().width;
        span.style.fontFamily = '"LumaProbeFont", serif';
        const wProbe = span.getBoundingClientRect().width;
        span.remove();

        const faces = document.getElementById("luma-imported-fonts");
        add(
          "fonts-imported-usable",
          "الخط المستورد يصل نافذة العرض",
          loaded && wProbe > 0 && Math.abs(wProbe - wFallback) > 1,
          `تحميل: ${loaded ? "نجح" : "فشل"} — ${Math.round(wProbe)}px مقابل ${Math.round(wFallback)}px للبديل` +
            ` — إعلان: ${faces?.textContent?.slice(0, 120) ?? "لا يوجد"}`,
        );
      }
    } catch (e) {
      add("fonts-imported-usable", "الخط المستورد يصل نافذة العرض", false, String(e));
    }
  }


  // ══ ١٠ · ميزانيات الأداء — المسألة ١٠ في §١٨ ═══════════════
  //
  // ستّ ميزانيات تطلبها المرحلة ٧. كل واحدة تُقاس هنا **داخل
  // `Luma.app`** وتُقارَن بسقفها في `budgets.ts`، ويسقط الفحص عند
  // التجاوز. أرقام Lighthouse ليست هذه الأرقام — تلك تقيس صفحة ويب.
  {
    // ── (أ) زمن الفتح حتى مؤشر قابل للكتابة ─────────────────
    //
    // من **بدء العملية** لا من تحميل نافذة العرض: المستخدم ينتظر من
    // النقر على الأيقونة. العلامات من الإقلاع الحقيقي، ويُتحقَّق هنا
    // أن المؤشر يقبل حرفًا فعلًا — رقمٌ عن مؤشر لا يكتب لا معنى له.
    {
      editor.setBlocks([{ id: "b0", role: "body", text: "", marks: [] }]);
      editor.focus();
      await paint();
      const before = editor.getBlocks()[0]?.text ?? "";
      type("ح");
      await paint();
      const writable = (editor.getBlocks()[0]?.text ?? "") !== before;
      // كانت `restored` في أدلة المرحلتين ٧ و٨ — سُمّيت `caret` منذ
      // إلغاء الاستئناف: لا شيء يُستعاد، والعلامة جاهزية المؤشر.
      const caret = startup["caret"] ?? -1;

      if (!writable) {
        add(BUDGETS.openToCaret.id, BUDGETS.openToCaret.what, false, "المؤشر لا يقبل حرفًا");
      } else if (caret < 0) {
        add(BUDGETS.openToCaret.id, BUDGETS.openToCaret.what, false, "لم تُلتقط علامات الإقلاع");
      } else {
        const stages = ["surface", "prefs", "fonts", "caret"]
          .filter((k) => k in startup)
          .map((k) => `${k} ${round(startup[k]!)}ms`)
          .join(" · ");
        // الإقلاع الحقيقي بلا استئناف منذ ADR ٠٠١٧ — كل تشغيل مساحة
        // نظيفة، فالقياس هنا مطابق للمنتج لا تحفّظًا عليه.
        budget(BUDGETS.openToCaret, caret, stages);
      }
    }

    // ── (ب) زمن ظهور الحرف — في أثقل تشكيلة لا أرخصها ────────
    //
    // كان يُقاس والمحرر عاريًا. والمستخدم الذي فعّل الآلة الكاتبة
    // والتركيز يدفع ثمنهما مع **كل حرف**: إعادة حساب مستطيل المؤشر،
    // وقرار تمرير، وإعادة طلاء طبقة التخفيت. تلك هي حالته لا تلك.
    const heavy = buildLongDocument(LARGE_DOCUMENT);
    const t0 = performance.now();
    editor.setBlocks(heavy);
    host.getBoundingClientRect();
    const buildMs = round(performance.now() - t0);

    const measureKeystrokes = async (): Promise<{ p50: number; p95: number }> => {
      editor.focus();
      editor.caretToEnd();
      await paint();
      const s: number[] = [];
      for (const ch of "الكتابة فعل هادئ لا يحتمل الضجيج") {
        const a = performance.now();
        document.execCommand("insertText", false, ch);
        host.getBoundingClientRect();
        s.push(performance.now() - a);
        await paint();
      }
      s.sort((a, b) => a - b);
      return {
        p50: round(s[Math.floor(s.length / 2)] ?? 0),
        p95: round(s[Math.floor(s.length * 0.95)] ?? 0),
      };
    };

    const plain = await measureKeystrokes();
    budget(BUDGETS.keystrokeP95, plain.p95, `p50 ${plain.p50}ms`);
    // البناء يُؤكَّد عليه ولا يُطبع وحده: انحدر ٤٫٧× بين المرحلتين ٢ و٦
    // (٦٥ms ← ٣١١ms) بلا إنذار، لأنه كان رقمًا في تقرير لا سقفًا.
    budget(BUDGETS.documentBuild, buildMs, `${LARGE_DOCUMENT} كلمة`);

    // التشكيلة الثقيلة: التركيز مفعَّل، والتمرير يتبع المؤشر
    editor.setFocusMode(true);
    await paint();
    const comfort = await measureKeystrokes();
    editor.setFocusMode(false);
    await paint();
    budget(BUDGETS.keystrokeComfortP95, comfort.p95, `p50 ${comfort.p50}ms`);

    // ── (و-١) حدّ حجم المستند ────────────────────────────────
    // الحدّ ليس رقمًا يُعلن بل رقمٌ **يُحتمَل**: المستند عند الحدّ
    // يُبنى ويُكتب فيه ضمن ميزانية الحرف. البند أعلاه أثبت ذلك، وهذا
    // يثبّت العدد نفسه.
    const words = heavy.reduce(
      (n, b) => n + b.text.split(/\s+/).filter(Boolean).length,
      0,
    );
    add(
      BUDGETS.documentWords.id,
      BUDGETS.documentWords.what,
      words >= BUDGETS.documentWords.max && plain.p95 <= BUDGETS.keystrokeP95.max,
      `${words} كلمة — الكتابة عندها p95 ${plain.p95}ms`,
    );

    // ── (ج) زمن حفظ تعديل نموذجي ─────────────────────────────
    //
    // المسار كاملًا كما تسلكه الجلسة: تسلسل + كتابة ذرّية + قرار
    // لقطة. لا `write_atomic` وحدها — تلك ليست ما ينتظره المستخدم.
    if (invoke) {
      try {
        const id = "selftest-budget-save";
        const blocks = heavy.slice(0, 60);
        // أول حفظ يُنشئ الملف؛ الميزانية على **التعديل** لا الإنشاء
        await invoke("save_document", {
          payload: { id, title: null, blocks, createdAt: null },
        });
        const times: number[] = [];
        for (let i = 0; i < 5; i += 1) {
          const edited = blocks.map((b, n) =>
            n === 0 ? { ...b, text: `${b.text} ${i}` } : b,
          );
          const a = performance.now();
          await invoke("save_document", {
            payload: { id, title: null, blocks: edited, createdAt: null },
          });
          times.push(performance.now() - a);
        }
        times.sort((a, b) => a - b);
        const median = times[Math.floor(times.length / 2)] ?? 0;
        budget(
          BUDGETS.saveTypicalEdit,
          median,
          `وسيط ٥ حفظات على ${blocks.length} كتلة`,
        );
      } catch (e) {
        add(BUDGETS.saveTypicalEdit.id, BUDGETS.saveTypicalEdit.what, false, String(e));
      }
    }

    // ── (هـ) و(و-٢) مكتبة كبيرة: التعداد والفتح ──────────────
    if (invoke) {
      try {
        const seeded = await invoke<number>("seed_library", {
          count: LARGE_LIBRARY,
          words: 400,
        });

        const l0 = performance.now();
        const listing = await invoke<{ documents: { id: string }[] }>(
          "list_documents",
        );
        const listMs = performance.now() - l0;

        // الفتح: آخر مستند في الترتيب — أبعد ما يكون عن المخبَّأ
        const target = listing.documents[listing.documents.length - 1]?.id;
        let openMs = -1;
        if (target) {
          const o0 = performance.now();
          await invoke("load_document", { id: target });
          openMs = performance.now() - o0;
        }

        budget(
          BUDGETS.openFromLargeLibrary,
          Math.max(listMs, openMs),
          `تعداد ${round(listMs)}ms وفتح ${round(openMs)}ms من ${listing.documents.length} مستندًا`,
        );
        add(
          BUDGETS.libraryDocuments.id,
          BUDGETS.libraryDocuments.what,
          seeded >= LARGE_LIBRARY &&
            listMs <= BUDGETS.openFromLargeLibrary.max,
          `${seeded} مستندًا مبذورًا — التعداد عندها ${round(listMs)}ms`,
        );
      } catch (e) {
        add(
          BUDGETS.openFromLargeLibrary.id,
          BUDGETS.openFromLargeLibrary.what,
          false,
          String(e),
        );
      }
    }

    // ── (د) الذاكرة في جلسة ممتدة ────────────────────────────
    //
    // `performance.memory` غير موجود في WebKit ولا يقيس عملية النواة
    // أصلًا، فتُقرأ الذاكرة المقيمة من النظام. والجلسة الممتدة تُحاكى
    // بما يفعله الكاتب فعلًا: كتابة، وفتح لوحات، وتبديل ثيمات،
    // ومستندات تُبنى وتُهدم — مرارًا.
    if (invoke) {
      try {
        const rssMb = async (): Promise<number> => {
          const kb = await invoke<number | null>("memory_rss_kb");
          return kb === null ? -1 : kb / 1024;
        };
        const before = await rssMb();
        for (let round_ = 0; round_ < 12; round_ += 1) {
          editor.setBlocks(buildLongDocument(4000));
          editor.focus();
          editor.caretToEnd();
          type("جلسة ممتدة ");
          theme.apply(THEME_IDS[round_ % THEME_IDS.length]!);
          editor.setFocusMode(round_ % 2 === 0);
          await paint();
        }
        editor.setFocusMode(false);
        theme.apply(THEME_IDS[0]!);
        editor.setBlocks([{ id: "b0", role: "body", text: "", marks: [] }]);
        await paint();
        const after = await rssMb();

        if (before < 0 || after < 0) {
          add(BUDGETS.memoryGrowth.id, BUDGETS.memoryGrowth.what, false, "تعذّر قياس الذاكرة");
        } else {
          budget(
            BUDGETS.memoryGrowth,
            after - before,
            `${round(before)}MB ← ${round(after)}MB بعد ١٢ دورة`,
          );
        }
      } catch (e) {
        add(BUDGETS.memoryGrowth.id, BUDGETS.memoryGrowth.what, false, String(e));
      }
    }
  }

  // ══ ١١ · قدرات المنصة التي تقوم عليها سلامة النص ═══════════
  //
  // ما يحمي النص خلف الشاشات هو `inert`، وما يمنع الشريط من الانكسار
  // هو صفٌّ صريح. كلاهما مُختبَر في Playwright — **وذاك متصفح آخر**.
  // WKWebView هي التي تشحن، وفيها يُقاس ما يُعتمد عليه. ADR ٠٠١٢ سمّى
  // دعم `inert` خطرًا مفتوحًا لأن جرده من مصفوفة دعم لا من قياس.
  {
    const probe = document.createElement("div");
    probe.innerHTML =
      '<button type="button" id="luma-inert-probe">مسبار</button>' +
      '<div id="luma-inert-edit" contenteditable="true"></div>';
    document.body.appendChild(probe);
    const btn = probe.querySelector<HTMLElement>("#luma-inert-probe")!;
    const edit = probe.querySelector<HTMLElement>("#luma-inert-edit")!;

    // ١١أ · `inert` يمنع التركيز الجديد
    //
    // **الترتيب هنا ليس تفصيلًا.** التركيز يُرفع عن المسبار قبل تعطيل
    // الشجرة: قياسُ «هل يبقى مركَّزًا» يقيس شيئًا آخر — ذاك سؤال ١١ب.
    btn.focus();
    const focusableBefore = document.activeElement === btn;
    btn.blur();

    probe.setAttribute("inert", "");
    await paint();
    btn.focus();
    const focusableAfter = document.activeElement === btn;

    add(
      "inert-supported",
      "`inert` يمنع التركيز الجديد في WKWebView",
      focusableBefore && !focusableAfter,
      focusableBefore
        ? focusableAfter
          ? "⚠️ السمة غير مدعومة — الكتابة تصل ما تحت الشاشات"
          : "قابل للتركيز قبلها، ممتنع بعدها"
        : "المسبار لم يقبل التركيز أصلًا — الفحص بلا معنى",
    );

    // ١١ب · وماذا عن عنصرٍ **كان مركَّزًا** حين عُطِّلت شجرته؟
    //
    // هذا هو حال Luma بالضبط: المحرر مركَّز حين تُفتح الإعدادات فوقه.
    // ولا يُعتمد على أن `inert` يُسقط التركيز القائم — الإجابة تختلف
    // بين المحركات. ولذلك في `App.svelte` حاجزان: نقلُ التركيز إلى
    // الحوار عند فتحه، ورفضُ المحرر للتحرير ما دامت الشاشة قائمة.
    // هذا الفحص يسجّل سلوك المنصة ولا يبني عليه.
    probe.removeAttribute("inert");
    await paint();
    edit.focus();
    const editFocused = document.activeElement === edit;
    probe.setAttribute("inert", "");
    await paint();
    const stillFocused = document.activeElement === edit;
    document.execCommand("insertText", false, "تسرّب");
    const wrote = edit.textContent !== "";
    probe.remove();

    add(
      "inert-existing-focus",
      "سلوك المنصة مع تركيزٍ قائم عند التعطيل — مسجَّل لا معتمَد عليه",
      editFocused,
      editFocused
        ? `بعد التعطيل: التركيز ${stillFocused ? "باقٍ" : "أُسقط"} والكتابة ${wrote ? "مرّت" : "رُفضت"}` +
          " — ولذلك حاجزٌ ثانٍ في `App.svelte` لا يعتمد على هذا"
        : "المسبار لم يقبل التركيز أصلًا — الفحص بلا معنى",
    );

    // ١١ج · شريط النافذة صفٌّ واحد
    //
    // كان صفّين: الشبكة تضع العناصر بالترتيب ولا تعود إلى الوراء،
    // فالعنوان في العمود ٢ يدفع حالةَ الحفظ في العمود ١ إلى صفٍّ ثانٍ
    // داخل ارتفاع ثابت. قيس في المتصفح ٣٥٫٥px + ١١٫٥px.
    const bar = document.querySelector<HTMLElement>(".titlebar");
    if (bar) {
      const rows = getComputedStyle(bar).gridTemplateRows.trim().split(/\s+/);
      const box = bar.getBoundingClientRect();
      const kids = Array.from(bar.children).map((c) => c.getBoundingClientRect());
      const outside = kids.filter(
        (r) => r.height > 0 && (r.top < box.top - 1 || r.bottom > box.bottom + 1),
      ).length;
      add(
        "titlebar-single-row",
        "شريط النافذة صفٌّ واحد ولا يتدلّى منه شيء",
        rows.length === 1 && outside === 0,
        `صفوف: ${rows.join(" · ")} — خارج الشريط: ${outside}`,
      );
    }
  }

  // ── ٨ز · الفحص لا يمسّ مستندات المستخدم ────────────────────
  if (invoke) {
    const after = await fingerprint();
    const same = JSON.stringify(libraryBefore) === JSON.stringify(after);
    add(
      "selftest-isolation",
      "الفحص لا يكتب فوق مستندات المستخدم",
      same,
      same
        ? `${libraryBefore.length} مستندًا كما هي`
        : `تغيّرت: ${JSON.stringify(libraryBefore)} ← ${JSON.stringify(after)}`,
    );
  }

  // ── ٩ · تنظيف ما خلّفه الفحص ───────────────────────────────
  // الفحص يكتب مستندات حقيقية ليختبر المسار الحقيقي، فيجب ألّا
  // يتركها: مكتبة المستخدم ليست مكان ضجيج أداة.
  if (invoke) {
    try {
      const removed = await invoke<number>("cleanup_selftest");
      add(
        "selftest-cleanup",
        "الفحص لا يترك أثرًا في مكتبة المستخدم",
        true,
        `أُزيل ${removed} مستند فحص`,
      );
    } catch (e) {
      add("selftest-cleanup", "الفحص لا يترك أثرًا", false, String(e));
    }
  }

  return checks;
}
