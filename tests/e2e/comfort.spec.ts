import { test, expect, type Page } from "@playwright/test";

/**
 * المحرر المريح بطبقاته الثلاث — مخرَج المرحلة ٦.
 *
 * **ليست شهادة اجتياز**: الحكم داخل `Luma.app`. هذه تكشف الانحدار على
 * طبقة الويب، وتقيس ما لا يُقاس بالعين: تمركز السطر النشط، وتخفيت ما
 * حوله دون سواه، ومخرج Zen بلوحة المفاتيح.
 */

const EDITOR = ".luma-editor";
// المدخل في شريط الأسطح لا عائمًا فوق الورقة
const COMFORT = "[data-comfort-entry] button";

/** يكتب مستندًا من فقرات مرقّمة يسهل تمييز النشطة منها. */
async function longDoc(page: Page, paragraphs = 14) {
  await page.goto("/");
  await page.waitForSelector(EDITOR);
  await page.locator(EDITOR).click();
  for (let i = 0; i < paragraphs; i++) {
    await page.keyboard.type(
      `فقرة ${i} — الكتابة فعل هادئ لا يحتمل الضجيج، وكل ما يزاحم النص يسرق منه شيئًا.`,
      { delay: 0 },
    );
    await page.keyboard.press("Enter");
  }
}

async function enterComfort(page: Page) {
  await page.click(COMFORT);
  await expect(page.locator(".shell.comfort")).toBeVisible();
  await page.locator(EDITOR).click();
}

/** موضع منتصف السطر النشط بالنسبة إلى مركز نطاق الآلة الكاتبة. */
function offsetFromBand(page: Page) {
  return page.evaluate(() => {
    // **النطاق يُحسب ولا يُقرأ من عنصر**: لم يعد يُرسم مستطيلًا خلف
    // السطر (FEEL-PLAN M10)، ومرساته ٤٥٫٥٪ من مساحة الكتابة — وهي
    // المصدر نفسه الذي يقيس عليه `lib/typewriter.ts`.
    const area = document.querySelector(".writing");
    if (!area) return null;
    const a = area.getBoundingClientRect();
    const anchor = a.top + a.height * 0.455;
    const b = { top: anchor, height: 0 };
    const sel = getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const rects = sel.getRangeAt(0).getClientRects();
    // نطاق مطويّ: نأخذ مستطيل الفقرة النشطة وآخر سطر فيها
    const el =
      sel.focusNode?.nodeType === 3 ? sel.focusNode.parentElement : (sel.focusNode as Element);
    const r = rects.length > 0 ? rects[0]! : el!.getBoundingClientRect();
    const mid = rects.length > 0 ? r.top + r.height / 2 : r.bottom - 18;
    return Math.round(mid - (b.top + b.height / 2));
  });
}

// ── الغلاف ───────────────────────────────────────────────────

test("المحرر المريح غلاف واحد: تختفي الأشرطة واللوحات ويبقى النص", async ({
  page,
}) => {
  await longDoc(page, 3);
  await page.click('[data-surface="library"] button');
  await expect(page.locator("[data-panel]")).toHaveCount(1);

  await enterComfort(page);

  // **الأشرطة تنطوي ولا تُزال** — وهذا ما يجعل أكبر تحوّل في المنتج
  // متّصلًا لا قطعًا (FEEL-PLAN M2). والمقياس هو الغاية لا الوسيلة:
  // لا يُرى منها شيء، ولا يصلها تركيز، ولا تبلغ قارئ الشاشة.
  await expect(page.locator(".titlebar")).toHaveAttribute("inert", "");
  await expect(page.locator(".surfaces")).toHaveAttribute("inert", "");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.round(document.querySelector(".surfaces")!.getBoundingClientRect().height),
      ),
    )
    .toBe(0);
  const hidden = await page.evaluate(() => {
    const cs = (s: string) => getComputedStyle(document.querySelector(s)!);
    return {
      bar: cs(".surfaces").opacity,
      title: cs(".title").opacity,
      chrome: cs(".titlebar").backgroundColor,
    };
  });
  expect(hidden.bar, "شريط الأسطح").toBe("0");
  expect(hidden.title, "عنوان النافذة").toBe("0");
  expect(hidden.chrome, "سطح شريط النافذة").toBe("rgba(0, 0, 0, 0)");
  await expect(page.locator("[data-panel]")).toHaveCount(0);
  // ويبقى النص نفسه — «الخروج لا يغيّر حالة النص»، والدخول كذلك
  await expect(page.locator(EDITOR)).toContainText("فقرة 0");
});

test("لا ورقة في المحرر المريح — النص على السطح مباشرةً", async ({ page }) => {
  await longDoc(page, 3);
  const framed = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector(".sheet")!);
    return parseFloat(cs.borderTopWidth);
  });
  expect(framed, "الورقة مؤطَّرة في الوضع العادي").toBeGreaterThanOrEqual(1);

  await enterComfort(page);
  // الحدّ يبقى بعرضه ويفقد لونه: عرضٌ يتغيّر وسط الحركة يزيح التخطيط
  // بكسلين، ولونٌ يذوب لا يزيح شيئًا — FEEL-PLAN M2.
  await expect
    .poll(() =>
      page.evaluate(
        () => getComputedStyle(document.querySelector(".sheet")!).backgroundColor,
      ),
    )
    .toBe("rgba(0, 0, 0, 0)");
  const bare = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector(".sheet")!);
    return { borderColor: cs.borderTopColor, radius: cs.borderTopLeftRadius };
  });
  expect(bare.borderColor, "بلا إطار مرئي").toBe("rgba(0, 0, 0, 0)");
  expect(bare.radius, "بلا انحناء بطاقة").toBe("0px");
});

// ── الآلة الكاتبة ────────────────────────────────────────────

test("الآلة الكاتبة تُبقي السطر النشط في النطاق عند مواضع مختلفة", async ({
  page,
}) => {
  await longDoc(page, 18);
  await enterComfort(page);

  // النطاق كما يعرّفه `src/lib/typewriter.ts`: ٣٦٪–٥٦٪ من الارتفاع،
  // ومرساته ٤٥٫٥٪. الفارق المقبول عن المركز هو نصف النطاق.
  const tolerance = await page.evaluate(() => {
    const h = document.querySelector(".scroller")!.clientHeight;
    return Math.round(h * (0.56 - 0.36) * 0.5) + 4;
  });

  const seen: number[] = [];
  for (let i = 0; i < 10; i++) {
    await page.keyboard.type("سطر يُكتب الآن ليدفع ما قبله إلى الأعلى.", {
      delay: 0,
    });
    await page.keyboard.press("Enter");
    const off = await offsetFromBand(page);
    expect(off, `بعد السطر ${i}`).not.toBeNull();
    seen.push(off!);
  }

  for (const [i, off] of seen.entries()) {
    expect(Math.abs(off), `السطر ${i} خرج من النطاق (${off}px)`).toBeLessThanOrEqual(
      tolerance,
    );
  }
});

test("حشوة تكفي ليبلغ السطر الأول النطاق", async ({ page }) => {
  await longDoc(page, 6);
  await enterComfort(page);

  // إلى أول المستند
  await page.keyboard.press("Meta+ArrowUp");
  await page.waitForTimeout(120);

  const m = await page.evaluate(() => {
    const sc = document.querySelector(".scroller")!;
    const cs = getComputedStyle(document.querySelector(".sheet")!);
    return {
      padTop: parseFloat(cs.paddingTop),
      viewHeight: sc.clientHeight,
    };
  });
  // ٤٥٫٥٪ من الارتفاع: بدونها يقف السطر الأول أعلى الشاشة ولا ينزل
  expect(m.padTop).toBeGreaterThan(m.viewHeight * 0.4);
});

test("إطفاء الآلة الكاتبة يوقف التمركز ولا يمسّ الطبقات الأخرى", async ({
  page,
}) => {
  await longDoc(page, 16);
  await enterComfort(page);
  await page.click('[data-chip="الآلة الكاتبة"]');
  // لا مؤشر مرسوم للطبقة بعد M10 — والدليل سلوكيّ: السطر لا يُنقل
  await expect(page.locator("[data-chip='الآلة الكاتبة']")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await page.locator(EDITOR).click();
  await page.keyboard.press("Meta+ArrowDown");
  const before = await page.evaluate(
    () => document.querySelector(".scroller")!.scrollTop,
  );
  await page.keyboard.type("بلا تمركز", { delay: 0 });
  const after = await page.evaluate(
    () => document.querySelector(".scroller")!.scrollTop,
  );
  // لا قفزة تمركز — التمرير الطبيعي وحده
  expect(Math.abs(after - before)).toBeLessThan(120);

  // والتركيز ما زال يعمل: طبقةٌ لا تُطفئ أختها
  const dimmed = await page.evaluate(
    () => document.querySelectorAll(".luma-dimmed").length,
  );
  expect(dimmed).toBeGreaterThan(0);
});

// ── التركيز ──────────────────────────────────────────────────

test("التركيز يخفت ما حول الفقرة النشطة دون سواها", async ({ page }) => {
  await longDoc(page, 8);
  await enterComfort(page);

  const m = await page.evaluate(() => {
    const all = [...document.querySelectorAll(".luma-editor p, .luma-editor h1")];
    const dimmed = all.filter((p) => p.classList.contains("luma-dimmed"));
    const active = all.filter((p) => !p.classList.contains("luma-dimmed"));
    return {
      total: all.length,
      dimmed: dimmed.length,
      active: active.length,
      dimColor: dimmed[0] ? getComputedStyle(dimmed[0]).color : null,
      inkColor: active[0] ? getComputedStyle(active[0]).color : null,
      muted: getComputedStyle(document.documentElement)
        .getPropertyValue("--text-muted")
        .trim(),
    };
  });

  expect(m.active, "الفقرة النشطة وحدها بحبر كامل").toBe(1);
  expect(m.dimmed).toBe(m.total - 1);
  // «لون رمز ثيم مقروء، لا شفافية عشوائية» — §٧ **ثابت**
  expect(m.dimColor).not.toBe(m.inkColor);
});

test("التركيز لا يغيّر بايتًا في المحتوى", async ({ page }) => {
  await longDoc(page, 5);
  const before = await page.evaluate(() =>
    [...document.querySelectorAll(".luma-editor p")].map((p) => p.textContent).join(" "),
  );

  await enterComfort(page);
  await page.click('[data-chip="التركيز"]'); // إطفاء
  await page.click('[data-chip="التركيز"]'); // وإشعال
  await page.keyboard.press("Escape");

  const after = await page.evaluate(() =>
    [...document.querySelectorAll(".luma-editor p")].map((p) => p.textContent).join(" "),
  );
  expect(after).toBe(before);
});

// ── Zen ──────────────────────────────────────────────────────

test("Zen يُراجع العناصر أثناء الكتابة ويعيدها، ومخرجه بلوحة المفاتيح", async ({
  page,
}) => {
  await longDoc(page, 4);
  await enterComfort(page);
  await page.click('[data-chip="Zen"]');

  await page.locator(EDITOR).click();
  await page.keyboard.type("أكتب الآن", { delay: 0 });
  // التراجع انتقالٌ زمني لا قفزة — يُنتظر انتهاؤه لا لحظته
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const el = document.querySelector(".comfort-bar");
          return el ? Number(getComputedStyle(el).opacity) : 1;
        }),
      { message: "تراجعت العناصر مع الكتابة" },
    )
    .toBeLessThan(0.05);

  // حركة المؤشر تعيدها — ومعها Esc، فلا يعتمد المخرج على الحركة وحدها
  await page.mouse.move(400, 300);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.querySelector(".comfort-bar");
        return el ? Number(getComputedStyle(el).opacity) : 0;
      }),
    )
    .toBeGreaterThan(0.95);
});

test("Esc يخرج من المحرر المريح ولا يغيّر النص", async ({ page }) => {
  await longDoc(page, 4);
  await enterComfort(page);
  const before = await page.evaluate(
    () => document.querySelector(".luma-editor")!.textContent,
  );

  await page.keyboard.press("Escape");
  await expect(page.locator(".shell.comfort")).toHaveCount(0);
  await expect(page.locator(".titlebar")).toHaveCount(1);

  const after = await page.evaluate(
    () => document.querySelector(".luma-editor")!.textContent,
  );
  expect(after).toBe(before);
  // ولا تخفيت باقٍ بعد الخروج
  await expect(page.locator(".luma-dimmed")).toHaveCount(0);
});

test("وسيلة الخروج ظاهرة ولا تعتمد على حركة المؤشر", async ({ page }) => {
  await longDoc(page, 3);
  await enterComfort(page);
  const exit = page.locator("[data-exit-comfort]");
  await expect(exit).toBeVisible();
  await exit.click();
  await expect(page.locator(".shell.comfort")).toHaveCount(0);
});

test("لكل طبقة تعطيل مستقل", async ({ page }) => {
  await longDoc(page, 3);
  await enterComfort(page);

  const state = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("[data-chip]")].map((c) => [
        (c as HTMLElement).dataset["chip"],
        c.getAttribute("aria-pressed"),
      ]),
    );

  // الافتراضي: الآلة الكاتبة والتركيز يعملان وZen مطفأ — §٧.
  // والترتيب هو ترتيب الإعدادات نفسه (الآلة الكاتبة ← التركيز ← Zen):
  // كان مقلوبًا في الشريط، فمن بنى خريطته في أحدهما وجدها معكوسة في
  // الآخر — FEEL-PLAN M6.
  expect(await state()).toEqual([
    ["الآلة الكاتبة", "true"],
    ["التركيز", "true"],
    ["Zen", "false"],
  ]);

  await page.click('[data-chip="التركيز"]');
  expect(await state()).toEqual([
    ["الآلة الكاتبة", "true"],
    ["التركيز", "false"],
    ["Zen", "false"],
  ]);
  await expect(page.locator(".luma-dimmed")).toHaveCount(0);
  // والآلة الكاتبة لم تتأثر
  await expect(page.locator("[data-chip='الآلة الكاتبة']")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
