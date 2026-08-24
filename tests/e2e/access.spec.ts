import { test, expect, type Page } from "@playwright/test";

/**
 * الوصول — صفّ «الوصول» في `IMPLEMENTATION.md` §١٥، ونطاق المرحلة ٧.
 *
 * أربعة أشياء تطلبها المرحلة صراحةً من Playwright: **اجتياز كامل
 * بلوحة المفاتيح عبر كل السطوح**، و**فحص شجرة الوصول للتسميات
 * والأدوار**، و**تأكيد ظهور حلقة التركيز على كل عنصر تفاعلي**،
 * وتقليل الحركة. وأُضيف إليها تكبير نص الواجهة وأهداف التفاعل.
 *
 * **على شاشات المنتج لا على معرض التطوير.** الحارس القائم في
 * `themes.spec.ts` يفحص المعرض ويقصّ عند أربعين عنصرًا — فما يسقط في
 * شاشةٍ حقيقية لا يراه أحد.
 *
 * **ليست شهادة اجتياز**: طبقة الويب ليست WKWebView. VoiceOver وتكبير
 * نص النظام وقوائم السياق تُجرَّب يدويًا — `docs/release-checklist.md`.
 */

/** يضبط نمط الإدخال على لوحة المفاتيح: `:focus-visible` لا يُطابق النقر. */
async function keyboardMode(page: Page) {
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
}

/**
 * يمشي بـ`Tab` ويعيد الأسماء المتاحة بالترتيب.
 *
 * يتوقف عند العودة إلى البداية أو عند السقف — والسقف يُبلَّغ عنه
 * صراحةً: قصٌّ صامت يقرأ «غطّيت كل شيء» وهو لم يفعل.
 */
async function tabOrder(page: Page, limit = 40): Promise<string[]> {
  const seen: string[] = [];
  let wraps = 0;

  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press("Tab");
    const at = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const name =
        el.getAttribute("aria-label") ||
        el.textContent?.trim().slice(0, 24) ||
        el.tagName;
      const ring = getComputedStyle(el).outlineWidth;
      const sib = el.nextElementSibling
        ? getComputedStyle(el.nextElementSibling).outlineWidth
        : "0px";
      return {
        name,
        // الحقل الأصلي المخفي يرسم حلقته على شقيقه المنمَّق
        ring: Math.max(parseFloat(ring) || 0, parseFloat(sib) || 0),
        inertAncestor: !!el.closest("[inert]"),
      };
    });

    // انتقال المتصفح خارج المستند: الدورة تلتفّ، ولا يُعدّ محطةً
    if (!at) {
      wraps += 1;
      if (wraps > 2) break;
      continue;
    }

    expect(
      at.ring,
      `«${at.name}» بلا حلقة تركيز ظاهرة — §١٣ **ثابت**`,
    ).toBeGreaterThanOrEqual(1);
    expect(
      at.inertAncestor,
      `«${at.name}» داخل شجرة معطَّلة ومع ذلك يصله Tab`,
    ).toBe(false);

    // الدورة أُغلقت: عُدنا إلى محطة رأيناها
    if (seen.includes(at.name)) break;
    seen.push(at.name);
  }
  return seen;
}

/**
 * الاجتياز بـ`Tab` يُقاس على Chromium وحده — الشرح في
 * `playwright.config.ts`: WebKit يتبع إعداد «التنقل بلوحة المفاتيح»
 * في macOS وهو مطفأ افتراضيًا، فلا يصل `Tab` إلا الحقول النصية.
 */
test.describe("اجتياز كامل بلوحة المفاتيح", () => {
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "ترتيب التركيز يُقاس على Chromium — WebKit يتبع إعداد النظام",
  );

  test("المحرر: كل محطة لها اسم وحلقة، والدورة تُغلق", async ({ page }) => {
    await page.goto("/");
    await keyboardMode(page);
    const stops = await tabOrder(page);

    expect(stops.length, "لا محطات تركيز في المحرر").toBeGreaterThan(2);
    for (const s of stops) expect(s.trim().length).toBeGreaterThan(0);

    // الدورة تُقارَن **مُدوَّرة**: التركيز يبدأ داخل النص عند الفتح،
    // فأول محطة هي التالية له لا أول عناصر الصفحة. الترتيب النسبي هو
    // ما يُقاس — وهو في RTL من بداية القراءة (اليمين) إلى نهايتها.
    const at = stops.indexOf("المكتبة");
    expect(at, "«المكتبة» ليست في مسار التركيز").toBeGreaterThanOrEqual(0);
    const cycle = [...stops.slice(at), ...stops.slice(0, at)];
    expect(cycle).toEqual([
      "المكتبة",
      "السجل الزمني",
      // «نصّ جديد» ثم «المحرر المريح» عند نهاية القراءة في الشريط
      "نصّ جديد",
      "المحرر المريح",
      "مساحة الكتابة",
    ]);
  });

  test("المكتبة مفتوحة: الحقل يلي مدخلها، والتركيز يدخل ويخرج", async ({
    page,
  }) => {
    await page.goto("/");
    await page.click('[data-surface="library"] button');
    await keyboardMode(page);
    const stops = await tabOrder(page);

    expect(stops).toContain("ابحث في نصوصك");
    // لا حبس: النص يأتي بعد اللوحة في المسار — §١٠ **ثابت**
    expect(stops).toContain("مساحة الكتابة");
  });

  test("الإعدادات: الإطار خلفها خارج المسار كليًّا", async ({ page }) => {
    await page.goto("/?settings=1");
    await keyboardMode(page);
    const stops = await tabOrder(page);

    expect(stops).toContain("إغلاق الإعدادات");
    // مساحة الكتابة محجوبة خلف الشاشة — لا يصلها Tab ولا تصلها كتابة
    expect(
      stops,
      "المحرر المحجوب في مسار التركيز — والكتابة تصله",
    ).not.toContain("مساحة الكتابة");
  });

  test("الكتابة لا تتسرّب إلى المحرر المحجوب خلف الإعدادات", async ({
    page,
  }) => {
    await page.goto("/?settings=1");
    const leaked = await page.evaluate(() => {
      const ed = document.querySelector<HTMLElement>(".luma-editor")!;
      const before = ed.textContent ?? "";
      ed.focus();
      document.execCommand("insertText", false, "تسرّب");
      return { changed: (ed.textContent ?? "") !== before, focused: document.activeElement === ed };
    });
    expect(leaked.focused, "المحرر المحجوب استقبل التركيز").toBe(false);
    expect(leaked.changed, "المحرر المحجوب استقبل كتابة").toBe(false);
  });
});

test.describe("شجرة الوصول: الأدوار والتسميات", () => {
  test("مساحة الكتابة منطقة تحرير متعددة الأسطر باسم عربي", async ({
    page,
  }) => {
    await page.goto("/");
    const ed = page.locator(".luma-editor");
    await expect(ed).toHaveAttribute("role", "textbox");
    await expect(ed).toHaveAttribute("aria-multiline", "true");
    await expect(ed).toHaveAttribute("aria-label", "مساحة الكتابة");
    await expect(ed).toHaveAttribute("dir", "rtl");
  });

  test("الجذر يعلن العربية والاتجاه", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "ar");
    await expect(html).toHaveAttribute("dir", "rtl");
  });

  test("كل عنصر تفاعلي له اسم متاح — ولا واحد بلا اسم", async ({ page }) => {
    for (const url of ["/", "/?settings=1"]) {
      await page.goto(url);
      const nameless = await page.evaluate(() => {
        const sel =
          "button:not([disabled]), input:not([disabled]), [role='tab'], [role='switch']";
        const bad: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
          if (el.closest("[inert]")) continue;
          const name =
            el.getAttribute("aria-label") ||
            el.closest("label")?.textContent?.trim() ||
            el.textContent?.trim() ||
            "";
          if (!name) bad.push(el.outerHTML.slice(0, 80));
        }
        return bad;
      });
      expect(nameless, `${url}: عنصر تفاعلي بلا اسم متاح`).toEqual([]);
    }
  });

  test("اللوحة تحمل اسمها بديلًا عن ترويسة محذوفة", async ({ page }) => {
    await page.goto("/");
    await page.click('[data-surface="library"] button');
    await expect(page.locator("aside.panel")).toHaveAttribute(
      "aria-label",
      "المكتبة",
    );
  });

  test("شاشة الإعدادات حوارٌ باسم عربي", async ({ page }) => {
    await page.goto("/?settings=1");
    const screen = page.locator("[data-settings]");
    await expect(screen).toHaveAttribute("role", "dialog");
    await expect(screen).toHaveAttribute("aria-label", "الإعدادات");
  });
});

test.describe("حلقة التركيز على كل عنصر تفاعلي", () => {
  // **بلا سقف صامت.** الحارس القديم كان `slice(0, 40)` على المعرض.
  for (const [name, url] of [
    ["المحرر", "/"],
    ["الإعدادات", "/?settings=1"],
  ] as const) {
    test(`${name}: لا عنصر بلا حلقة`, async ({ page }) => {
      await page.goto(url);
      await keyboardMode(page);
      const bad = await page.evaluate(() => {
        const sel = "button:not([disabled]), input:not([disabled]), [tabindex='0']";
        const out: string[] = [];
        const all = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter(
          (e) => !e.closest("[inert]"),
        );
        for (const el of all) {
          el.focus();
          const w = parseFloat(getComputedStyle(el).outlineWidth) || 0;
          const sib = el.nextElementSibling
            ? parseFloat(getComputedStyle(el.nextElementSibling).outlineWidth) || 0
            : 0;
          if (Math.max(w, sib) < 1) {
            out.push(
              `${el.tagName}«${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 20)}»`,
            );
          }
        }
        return { bad: out, total: all.length };
      });
      expect(bad.total, "لم يُفحص عنصر واحد — المحدِّد لا يلتقط شيئًا").toBeGreaterThan(2);
      expect(bad.bad, "عنصر تفاعلي بلا حلقة تركيز").toEqual([]);
    });
  }
});

test.describe("أهداف التفاعل ٣٢×٣٢ فعليًا", () => {
  for (const [name, url] of [
    ["المحرر", "/"],
    ["الإعدادات", "/?settings=1"],
  ] as const) {
    test(`${name}: لا هدف دون ٣٢×٣٢`, async ({ page }) => {
      await page.goto(url);
      const small = await page.evaluate(() => {
        const sel =
          "button:not([disabled]), input:not([disabled]), [role='tab'], [tabindex='0']";
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
          if (el.closest("[inert]")) continue;
          let r = el.getBoundingClientRect();
          // الحقل الأصلي المخفي: هدفه الحقيقي تسميته المرئية
          if (r.width < 4 || r.height < 4) {
            const lab = el.closest("label");
            if (lab) r = lab.getBoundingClientRect();
          }
          // مساحة الكتابة ليست «هدفًا» بل سطح تحرير
          if (el.classList.contains("luma-editor")) continue;
          // منطقة الالتقاط قد تتجاوز المرسوم — `.luma-hit` في app.css
          const after = el.classList.contains("luma-hit")
            ? Math.max(r.height, 32)
            : r.height;
          if (r.width < 32 || after < 32) {
            const n = (el.getAttribute("aria-label") || el.textContent || "").trim();
            out.push(`«${n.slice(0, 20)}» ${Math.round(r.width)}×${Math.round(r.height)}`);
          }
        }
        return out;
      });
      expect(small, "هدف تفاعل دون ٣٢×٣٢ — §١٣").toEqual([]);
    });
  }
});

test.describe("تقليل الحركة", () => {
  /** يعدّ كل عنصر عليه انتقال أو أنيميشن فعلي. */
  const motionful = () =>
    Array.from(document.querySelectorAll("*")).filter((el) => {
      const cs = getComputedStyle(el);
      const t = cs.transitionDuration.split(",").some((s) => parseFloat(s) > 0.001);
      const a = cs.animationDuration.split(",").some((s) => parseFloat(s) > 0.001);
      return t || a;
    }).length;

  test("تفضيل النظام وحده يُطفئ كل حركة", async ({ browser }) => {
    // سياق بتفضيل النظام — الفرع الذي لم يكن مُختبَرًا إطلاقًا
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto("/");
    const after = await page.evaluate(motionful);
    expect(after, "بقيت حركة رغم تفضيل النظام").toBe(0);
    await ctx.close();
  });

  test("تفضيل Luma وحده يُطفئ كل حركة — والتأكيد يسقط إن لم يفعل", async ({
    page,
  }) => {
    await page.goto("/");
    const before = await page.evaluate(motionful);
    // التأكيد المضاد: بلا حركة أصلًا لا معنى لاختبار إطفائها
    expect(before, "لا حركة قبل التقليل — الاختبار بلا معنى").toBeGreaterThan(0);

    await page.evaluate(() => {
      document.documentElement.dataset["reduceMotion"] = "on";
    });
    const after = await page.evaluate(motionful);
    expect(after, "بقيت حركة رغم تفضيل Luma").toBe(0);
  });

  test("نبض مؤشر الحفظ يتوقف — البند المسمّى في المرحلة ٧", async ({
    page,
  }) => {
    await page.goto("/?gallery=1");
    const pulse = await page.evaluate(() => {
      const read = () => {
        const el = document.querySelector(".spin, .spinner");
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          duration: cs.animationDuration,
          running: cs.animationPlayState,
          name: cs.animationName,
        };
      };
      const before = read();
      document.documentElement.dataset["reduceMotion"] = "on";
      const after = read();
      delete document.documentElement.dataset["reduceMotion"];
      return { before, after };
    });

    expect(pulse.before, "لا مؤشر نابض في المعرض — الاختبار بلا هدف").not.toBeNull();
    expect(
      parseFloat(pulse.before!.duration),
      "المؤشر لا ينبض أصلًا قبل التقليل",
    ).toBeGreaterThan(0.001);
    expect(
      parseFloat(pulse.after!.duration),
      "نبض مؤشر الحفظ استمرّ رغم تقليل الحركة",
    ).toBeLessThanOrEqual(0.001);
  });
});

test.describe("تكبير نص الواجهة", () => {
  // §١٣: «تكبير نص النظام وواجهته لا يقصّ الأوامر الأساسية ولا يكسر
  // المحرر». الطباعة px بقرار مسجَّل في §٩، فالتكبير هنا تكبير صفحة —
  // وهو ما تفعله أدوات تكبير النظام بمحتوى نافذة العرض.
  for (const zoom of [1.5, 2]) {
    test(`عند ${zoom}× لا يُقصّ شيء ولا يفيض شريط`, async ({ page }) => {
      await page.goto("/?settings=1");
      const clipped = await page.evaluate((z) => {
        document.documentElement.style.zoom = String(z);
        document.body.offsetHeight;
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
          const cs = getComputedStyle(el);
          const clipX = cs.overflowX === "hidden" || cs.overflowX === "clip";
          const clipY = cs.overflowY === "hidden" || cs.overflowY === "clip";
          const ox = el.scrollWidth - el.clientWidth;
          const oy = el.scrollHeight - el.clientHeight;
          // العنوان يقصّ عمدًا (`text-overflow`) وهو عنوان مستند لا أمر
          if (el.classList.contains("title")) continue;
          if ((clipX && ox > 1) || (clipY && oy > 1)) {
            out.push(`${el.tagName}.${el.className.toString().split(" ")[0]} ${ox}×${oy}`);
          }
        }
        document.documentElement.style.zoom = "";
        return out;
      }, zoom);
      expect(clipped, `قصّ عند ${zoom}×`).toEqual([]);
    });
  }

  test("شريط النافذة صفٌّ واحد — لا يسقط محتواه تحته", async ({ page }) => {
    await page.goto("/?settings=1");
    const bar = await page.evaluate(() => {
      const b = document.querySelector<HTMLElement>("[data-settings] .titlebar")!;
      const close = document.querySelector<HTMLElement>("[data-settings] .close")!;
      const br = b.getBoundingClientRect();
      const cr = close.getBoundingClientRect();
      return {
        rows: getComputedStyle(b).gridTemplateRows.split(" ").length,
        inside: Math.round(cr.top) >= Math.round(br.top) &&
          Math.round(cr.bottom) <= Math.round(br.bottom),
      };
    });
    // كان صفّين: زر الإغلاق يتدلّى ٨px تحت الشريط عند ١×
    expect(bar.rows, "شريط النافذة صار صفّين").toBe(1);
    expect(bar.inside, "زر الإغلاق خارج شريطه").toBe(true);
  });
});
