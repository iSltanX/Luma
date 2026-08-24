/**
 * حرّاس الإصدار — المرحلة ٨.
 *
 * ما يُكتب مرة واحدة ولا يُراجَع بعدها هو أوّل ما ينحرف. هذه الحرّاس
 * تمنع الانحراف الصامت في ثلاثة أشياء يصعب اكتشاف خطئها بعد الإطلاق:
 * معرّف الحزمة، والاستحقاقات، وسطح الاتصال بالشبكة.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const SRC = join(process.cwd(), "src");

function files(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...files(p, exts));
    else if (exts.some((x) => e.endsWith(x))) out.push(p);
  }
  return out;
}

const ROOT = process.cwd();
const TAURI = join(ROOT, "src-tauri");
const CONF = JSON.parse(
  readFileSync(join(TAURI, "tauri.conf.json"), "utf8"),
) as {
  identifier: string;
  version: string;
  app: { security: { csp: string } };
  bundle: {
    targets: string[];
    macOS: {
      minimumSystemVersion: string;
      hardenedRuntime?: boolean;
      entitlements?: string;
      files?: Record<string, string>;
    };
  };
};

/** المعرّف النهائي — [ADR ٠٠١٤](../docs/decisions/0014-bundle-identifier.md). */
const IDENTIFIER = "com.sultanart.luma";

describe("معرّف الحزمة", () => {
  it("هو المعرّف النهائي لا المؤقت", () => {
    expect(
      CONF.identifier,
      "المعرّف يُثبَّت مرة واحدة ولا يتغيّر — تغييره يفقد ربط النظام بالتطبيق",
    ).toBe(IDENTIFIER);
  });

  it("لا أثر للمعرّف المؤقت في إعدادات الحزمة ولا في النواة", () => {
    const files = [
      join(TAURI, "tauri.conf.json"),
      join(TAURI, "entitlements.plist"),
      join(TAURI, "capabilities", "default.json"),
    ];
    for (const f of files) {
      if (!existsSync(f)) continue;
      expect(
        readFileSync(f, "utf8").includes("dev.luma.app"),
        `${f}: بقي المعرّف المؤقت`,
      ).toBe(false);
    }
  });

  it("مسار البيانات لا يُشتق من المعرّف — يحرسه اختبار في النواة أيضًا", () => {
    const lib = readFileSync(join(TAURI, "src", "lib.rs"), "utf8");
    expect(lib).toContain("Application Support");
    expect(lib).toContain('.join("Luma")');
  });
});

describe("التوقيع والاستحقاقات", () => {
  it("Hardened Runtime مفعَّل صراحةً", () => {
    // مُفعَّل افتراضًا في Tauri، والتصريح به يمنع أن يُطفأ سهوًا
    expect(
      CONF.bundle.macOS.hardenedRuntime,
      "التصديق يرفض حزمةً بلا Hardened Runtime",
    ).toBe(true);
  });

  it("ملف الاستحقاقات مُعلَن وموجود", () => {
    expect(CONF.bundle.macOS.entitlements).toBe("entitlements.plist");
    expect(existsSync(join(TAURI, "entitlements.plist"))).toBe(true);
  });

  it("لا استحقاق واحد مطلوب — والملف يقول ذلك صراحةً", () => {
    const plist = readFileSync(join(TAURI, "entitlements.plist"), "utf8");
    // `<dict/>` أو `<dict></dict>` فارغة: لا مفتاح واحد
    expect(
      /<key>/.test(plist),
      "أُضيف استحقاق — يحتاج سببًا مكتوبًا وADR (§١١ الخصوصية)",
    ).toBe(false);
    expect(plist).toContain("<dict/>");
  });

  it("أدنى إصدار macOS مطابق لـADR ٠٠١٢", () => {
    expect(CONF.bundle.macOS.minimumSystemVersion).toBe("13.0");
  });
});

describe("الصلاحيات تغطّي ما تستدعيه الواجهة فعلًا", () => {
  /**
   * صلاحية ناقصة **لا تُصدر خطأ ظاهرًا**: الاستدعاء يُرفض، والنتيجة
   * سطرٌ فارغ أو زرٌّ لا يفعل شيئًا. وقد وقع الاثنان معًا: رقم
   * الإصدار في «حول» كان فارغًا لأن `core:app:allow-version` ناقصة،
   * وزر إغلاق النافذة كان يفشل صامتًا في أول ضغطة ثم يغلق **بلا
   * حفظ** في الثانية لأن `core:window:allow-destroy` ناقصة.
   *
   * الحارس يربط ما يستدعيه الكود بما يمنحه الملف: استدعاءٌ بلا منح
   * يُسقط البناء بدل أن يُكتشف عند المستخدم.
   */
  const CAP = JSON.parse(
    readFileSync(join(TAURI, "capabilities", "default.json"), "utf8"),
  ) as { permissions: string[] };

  /** ما يستدعيه الكود ← الصلاحية التي يحتاجها. */
  const NEEDS: ReadonlyArray<[RegExp, string, string]> = [
    [/getCurrentWindow\(\)\s*\.\s*destroy\(/, "core:window:allow-destroy", "هدم النافذة بعد نجاح الحفظ"],
    [/\bgetVersion\(\)/, "core:app:allow-version", "رقم الإصدار في «حول»"],
    [/\blisten\s*\(/, "core:event:default", "استقبال أحداث النواة"],
  ];

  const src = files(SRC, [".ts", ".svelte"])
    .filter((f) => !f.includes(`${sep}dev${sep}`))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  it.each(NEEDS.map(([re, perm, what]) => [what, re, perm] as const))(
    "%s ← الصلاحية ممنوحة",
    (_what, re, perm) => {
      if (!re.test(src)) return; // لا يُستدعى، فلا يُشترط
      expect(
        CAP.permissions,
        `الكود يستدعيه والصلاحية «${perm}» غير ممنوحة — يُرفض صامتًا`,
      ).toContain(perm);
    },
  );

  it("لا صلاحية ممنوحة بلا مستدعٍ — أقلّ ما يكفي", () => {
    const granted = new Set(CAP.permissions);
    const justified = new Set(NEEDS.map(([, p]) => p));
    const extra = [...granted].filter((p) => !justified.has(p));
    expect(
      extra,
      "صلاحية بلا استدعاء يقابلها — تُحذف أو يُكتب سببها هنا",
    ).toEqual([]);
  });
});

describe("سطح الشبكة", () => {
  // §١١ **ثابت**: «تخزين على الجهاز، بلا حساب وبلا مزامنة»، ولا قياس
  // تشخيصي. القاعدة تُفرض في ثلاث طبقات، وهذا يحرس اثنتين منها.
  it("سياسة CSP تمنع أي اتصال خارج جسر النواة", () => {
    const csp = CONF.app.security.csp;
    const connect = csp.match(/connect-src ([^;]+)/)?.[1] ?? "";
    for (const src of connect.trim().split(/\s+/)) {
      expect(
        /^(ipc:|http:\/\/ipc\.localhost)$/.test(src),
        `connect-src يسمح بـ«${src}» — وLuma بلا شبكة`,
      ).toBe(true);
    }
  });

  it("لا اعتمادية شبكة في النواة", () => {
    const cargo = readFileSync(join(TAURI, "Cargo.toml"), "utf8");
    for (const crate of ["reqwest", "hyper", "ureq", "tokio-tungstenite"]) {
      expect(cargo.includes(`\n${crate}`), `${crate} في الاعتماديات`).toBe(
        false,
      );
    }
  });

  it("لا إضافة تحديث تلقائي — القرار مؤجَّل بـADR ٠٠١٣", () => {
    const cargo = readFileSync(join(TAURI, "Cargo.toml"), "utf8");
    expect(
      cargo.includes("tauri-plugin-updater"),
      "أُضيفت إضافة التحديث — راجِع ADR ٠٠١٣ قبل ذلك",
    ).toBe(false);
  });
});

describe("تراخيص الخطوط", () => {
  // `Luma.md` §١١: «سياسة الترخيص للخطوط المستوردة بيانٌ قانوني يُكتب
  // قبل الإطلاق». وOFL 1.1 توجب أن ترافق النسخةَ حقوقُ النشر ونصُّ
  // الرخصة — والخطّان المدمجان تحتها.
  it("نصّ الرخصة والبيان موجودان مع الخطوط", () => {
    for (const f of ["OFL.txt", "NOTICE.md"]) {
      expect(
        existsSync(join(ROOT, "public", "fonts", f)),
        `${f} مفقود — إعادة توزيع خط OFL بلا رخصته مخالفة`,
      ).toBe(true);
    }
    const ofl = readFileSync(join(ROOT, "public", "fonts", "OFL.txt"), "utf8");
    expect(ofl).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(ofl).toContain("PERMISSION & CONDITIONS");
  });

  it("حقوق النشر منقولة من ملفات الخطوط لا من موقع", () => {
    const notice = readFileSync(join(ROOT, "public", "fonts", "NOTICE.md"), "utf8");
    // السطران كما يقرؤهما جدول `name` في الملفين المشحونين
    expect(notice).toContain("Copyright (c) 2019 by Almarai");
    expect(notice).toContain("Copyright 2009 The Cairo Project Authors");
  });

  it("يُشحنان **ملفين حقيقيين** في الحزمة لا مضمَّنين في الثنائي", () => {
    // Tauri يضمّن `dist` داخل الثنائي، فالرخصة هناك لا يقرؤها أحد.
    const files = CONF.bundle.macOS.files ?? {};
    expect(files["Resources/fonts/OFL.txt"]).toBeTruthy();
    expect(files["Resources/fonts/NOTICE.md"]).toBeTruthy();
  });
});

describe("التوزيع يغطّي كل جهاز مدعوم", () => {
  // [ADR ٠٠١٦](../docs/decisions/0016-universal-binary.md): الدعم
  // المُعلَن macOS 13 يشمل أجهزة Intel، وحزمة arm64 وحدها لا تفتح عندهم.
  it("مسار الإصدار يبني هدفًا عالميًا", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["app:build:universal"]).toContain(
      "universal-apple-darwin",
    );
    const sh = readFileSync(join(ROOT, "scripts", "release.sh"), "utf8");
    expect(sh).toContain("app:build:universal");
    // ويتحقق بـ`lipo` بدل أن يفترض
    expect(sh).toContain("lipo -archs");
    expect(sh, "لا حارس يمنع شحن حزمة ناقصة المعمارية").toContain(
      "ليست عالمية",
    );
  });
});

describe("الإصدار وسجل التغييرات", () => {
  it("النسخة في package.json و tauri.conf.json واحدة", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      version: string;
    };
    expect(
      CONF.version,
      "نسختان مختلفتان: المستخدم يرى واحدة والحزمة تحمل أخرى",
    ).toBe(pkg.version);
  });

  it("سجل التغييرات يذكر النسخة الحالية", () => {
    const log = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
    expect(log, `النسخة ${CONF.version} ليست في CHANGELOG`).toContain(
      CONF.version,
    );
  });

  it("DMG هدفٌ في البناء", () => {
    expect(CONF.bundle.targets).toContain("dmg");
  });
});
