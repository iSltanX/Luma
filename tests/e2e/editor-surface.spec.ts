import { test, expect, type Page } from "@playwright/test";

/** مساحة الكتابة: استمرارية السطح، والتحديد، والتجاوب. */

const EDITOR = ".luma-editor";
const THEMES = ["paper", "mist", "sage", "lavender", "midnight"] as const;

async function longDoc(page: Page) {
  await page.goto("/");
  await page.waitForSelector(EDITOR);
  await page.locator(EDITOR).click();
  // مستند عربي طويل يتجاوز ارتفاع النافذة بكثير
  for (let i = 0; i < 14; i++) {
    await page.keyboard.type(
      "الكتابة فعل هادئ لا يحتمل الضجيج، وكل ما يزاحم النص يسرق منه شيئًا، " +
        "كتب المؤلف عن مفهوم flow ثم انتقل إلى الجانب العملي، بين ٥٢٠ و٨٠٠ بكسل.",
      { delay: 0 },
    );
    await page.keyboard.press("Enter");
  }
}

function boxes(page: Page) {
  return page.evaluate(() => {
    const sheet = document.querySelector(".sheet")!;
    const ed = document.querySelector(".luma-editor")!;
    const sc = document.querySelector(".scroller")!;
    return {
      sheetH: sheet.getBoundingClientRect().height,
      sheetScrollH: (sheet as HTMLElement).scrollHeight,
      edH: ed.getBoundingClientRect().height,
      scrollerH: sc.clientHeight,
      contentH: sc.scrollHeight,
      sheetTop: sheet.getBoundingClientRect().top,
      sheetBottom: sheet.getBoundingClientRect().bottom,
    };
  });
}

test("الورقة تحيط بالنص كاملًا ولا تنتهي قبله", async ({ page }) => {
  await longDoc(page);
  const b = await boxes(page);
  // ارتفاع الورقة يجب أن يشمل المحرر كاملًا — لا قصّ ولا فيض
  expect(b.sheetH).toBeGreaterThan(b.edH);
  // الورقة نفسها ليست حاوية تمرير: لا محتوى فائض داخلها
  expect(b.sheetScrollH).toBeLessThanOrEqual(Math.ceil(b.sheetH) + 2);
});

test("مسؤول تمرير واحد فقط", async ({ page }) => {
  await longDoc(page);
  const scrollers = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const cs = getComputedStyle(el);
      const oy = cs.overflowY;
      if (
        (oy === "auto" || oy === "scroll") &&
        el.scrollHeight > el.clientHeight + 4
      ) {
        out.push(el.className.toString().split(" ")[0]!);
      }
    }
    return out;
  });
  expect(scrollers).toEqual(["scroller"]);
});

test("خلفية الورقة مستمرة في بداية المستند ووسطه ونهايته", async ({ page }) => {
  await longDoc(page);
  const sc = page.locator(".scroller");
  const max = await sc.evaluate((e) => e.scrollHeight - e.clientHeight);

  for (const pos of [0, Math.round(max / 2), max]) {
    await sc.evaluate((e, p) => (e.scrollTop = p), pos);
    await page.waitForTimeout(60);
    // في كل موضع: النص المرئي يقع داخل حدود الورقة أفقيًا ورأسيًا
    const inside = await page.evaluate(() => {
      const sheet = document.querySelector(".sheet")!.getBoundingClientRect();
      const ps = Array.from(document.querySelectorAll(".luma-editor p"));
      const visible = ps
        .map((p) => p.getBoundingClientRect())
        .filter((r) => r.bottom > 0 && r.top < window.innerHeight);
      if (visible.length === 0) return true;
      return visible.every(
        (r) => r.top >= sheet.top - 1 && r.bottom <= sheet.bottom + 1,
      );
    });
    expect(inside, `عند التمرير ${pos}`).toBe(true);
  }
});

for (const theme of THEMES) {
  test(`ثيم ${theme} — الورقة متمايزة عن الخلفية`, async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(EDITOR);
    await page.evaluate((t) => {
      if (t === "paper") document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", t);
    }, theme);
    await page.waitForTimeout(80);
    // التمايز إمّا بفارق لون أو بحدّ ظاهر — لا يجوز أن يغيبا معًا
    const ok = await page.evaluate(() => {
      const sheet = document.querySelector(".sheet")!;
      const cs = getComputedStyle(sheet);
      const bw = parseFloat(cs.borderTopWidth);
      const bc = cs.borderTopColor;
      const bg = cs.backgroundColor;
      // الخلفية على الإطار لا على المُمرِّر — المُمرِّر شفاف
      const canvas = getComputedStyle(
        document.querySelector(".shell")!,
      ).backgroundColor;
      return { bw, differs: bg !== canvas, bc, bg, canvas };
    });
    expect(ok.bw, `حدّ الورقة في ${theme}`).toBeGreaterThanOrEqual(1);
    expect(ok.differs, `سطح الورقة يساوي الخلفية في ${theme}`).toBe(true);
  });
}

test("التحديد يتبع الأسطر ولا يصير مستطيلًا واحدًا", async ({ page }) => {
  await longDoc(page);
  // تحديد عدة أسطر داخل فقرة واحدة
  const rects = await page.evaluate(() => {
    const p = document.querySelector(".luma-editor p")!;
    const node = p.firstChild!;
    const r = document.createRange();
    r.setStart(node, 0);
    r.setEnd(node, node.textContent!.length);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    const list = Array.from(r.getClientRects());
    return list.map((x) => ({ t: Math.round(x.top), h: Math.round(x.height) }));
  });
  // فقرة ملفوفة على عدة أسطر تعطي مستطيلًا لكل سطر لا مستطيلًا واحدًا
  expect(rects.length).toBeGreaterThan(1);
  // ارتفاع كل مستطيل بحدود سطر واحد (٣٦px) لا كتلة كاملة
  for (const r of rects) expect(r.h).toBeLessThan(60);
});

test("لا سلف غير قابل للتحديد يحيط بالمحرر", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    let el: Element | null = document.querySelector(".luma-editor");
    while (el && el !== document.body) {
      const us = getComputedStyle(el).webkitUserSelect || getComputedStyle(el).userSelect;
      if (us === "none") out.push(el.className.toString().split(" ")[0]!);
      el = el.parentElement;
    }
    return out;
  });
  expect(bad, "سلف بـuser-select:none يفسد رسم التحديد في WebKit").toEqual([]);
});

/**
 * المقاسات الثابتة من التصميم — `IMPLEMENTATION.md` §٩:
 * ورقة ٨٨٠ بحشوة جانبية ٤٠، وعمود نص ٨٠٠.
 *
 * العمود يقف عند ٨٠٠ مهما اتسعت النافذة: هو أقصى ما توثّقه §٩ لعمود
 * النص العربي، وإطالة السطر بعده تضرّ القراءة الطويلة. والضبط ٥٢٠–٨٠٠
 * تفضيلُ مستخدمٍ يصل في المرحلة ٦ — والافتراضي عند سقفه.
 */
function measures(page: Page) {
  return page.evaluate(() => {
    const sheet = document.querySelector(".sheet")!.getBoundingClientRect();
    const sc = document.querySelector(".scroller")!.getBoundingClientRect();
    const cs = getComputedStyle(document.querySelector(".sheet")!);
    const pad = parseFloat(cs.paddingInlineStart);
    return {
      left: Math.round(sheet.left - sc.left),
      right: Math.round(sc.right - sheet.right),
      pad: Math.round(pad),
      measure: Math.round(sheet.width - pad * 2),
      sheetW: Math.round(sheet.width),
    };
  });
}

for (const [w, h] of [[1440, 900], [1680, 1000]] as const) {
  test(`عرض ${w} — الورقة ٨٨٠ والعمود ٨٠٠`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/");
    await page.waitForSelector(EDITOR);
    const m = await measures(page);

    expect(Math.abs(m.left - m.right), "هوامش متوازنة").toBeLessThanOrEqual(2);
    expect(m.sheetW).toBe(880);
    expect(m.pad).toBe(40);
    expect(m.measure).toBe(800);
  });
}

test("النافذة الضيّقة: يتقلّص العمود نحو ٥٢٠ قبل أن تتقلّص الورقة", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForSelector(EDITOR);

  // عرض متوسط: الحشوة ما زالت ٤٠ والعمود هو الذي أعطى
  await page.setViewportSize({ width: 700, height: 800 });
  const mid = await measures(page);
  expect(mid.pad, "الحشوة تصمد ما دام العمود فوق حدّه").toBe(40);
  expect(mid.measure).toBeLessThan(800);
  expect(mid.measure).toBeGreaterThanOrEqual(520);

  // عرض ضيّق: العمود بلغ حدّه، فأعطت الحشوة لتُبقيه عنده
  await page.setViewportSize({ width: 600, height: 800 });
  const tight = await measures(page);
  expect(tight.pad).toBeLessThan(40);
  expect(tight.measure).toBe(520);
});
