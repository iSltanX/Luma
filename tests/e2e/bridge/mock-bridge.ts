/**
 * جسر Tauri مُقلَّد داخل الصفحة — مرآةٌ لدلالات `src-tauri/src/storage`.
 *
 * **لماذا وُجد.** خارج `Luma.app` يرجع `App.svelte` عند فحص
 * `__TAURI_INTERNALS__` قبل أن يُنشئ الجلسة: لا حفظ، ولا مكتبة، ولا
 * سجل، ولا سلّة. فحزمة `tests/e2e` تفتح لوحاتٍ **فارغة دائمًا**،
 * ومسار التخزين كلّه خارج مرماها — وهو السبب الجذري لأربعة عشر بندًا
 * في `docs/audit/AUDIT-2026-08-27.md`. هذا الملف يفتحها كلها.
 *
 * **ما هو، وما ليس هو.** يعيد إنتاج **قواعد** النواة في JS كي تعمل
 * الواجهة على دلالاتٍ صادقة. فما يثبته اختبارٌ فوقه هو **الواجهة
 * ووصلُها** — لا النواة نفسها؛ تلك تحرسها اختبارات `cargo`. ولا يغني
 * عن الفحص الذاتي داخل `Luma.app` (`npm run selftest`) وهو البوابة.
 *
 * **ما نُقل حرفيًّا من Rust** — وكل بند منه يقابله سطرٌ هناك:
 * - `save_document`: الفارغ الجديد لا يُكتب · `createdAt` يُحفظ من
 *   الموجود · اللقطة **بعد** نجاح الحفظ لا قبله.
 * - `should_snapshot`: فارغ ⇒ لا · أول محتوى ⇒ نعم · وإلا فرقُ
 *   `MIN_CHANGE_CHARS` حرفًا فأكثر عن آخر لقطة.
 * - `delete_document`: الغياب **نجاحٌ صامت** · فارغ **وبلا أي لقطة**
 *   ⇒ محوٌ مباشر · وإلا ⇒ سلّة. والقرار هنا لا في `DocumentStore`،
 *   كما في `commands.rs` بالضبط.
 * - `restore_revision`: لقطة أمان قبل الاستبدال، و**لا شبكة لفراغ**
 *   (`create_guard` تُبلّغ `None`).
 * - `trash`/`restore`/`empty_trash`/`list_trash` تحت قفلٍ واحد —
 *   مرآة `Storage::trash_guard`.
 * - `list_trash` يكسح المنتهي **قبل** أن يعيد القائمة — الكسح الكسول.
 * - ترتيب المكتبة بـ`updatedAt` تنازليًّا، والسجل بـ`createdAt`.
 *
 * **الثابتان أدناه مرآةٌ بالقيمة لا بمرجعٍ مشترك** — يتطابقان مع
 * نظيريهما في Rust يدويًّا، **ويحرس تطابقهما** `tests/bridge-fidelity.test.ts`
 * الذي يقرأ مصدر Rust: انحراف أحدهما يُسقط البناء.
 */

import type { Page } from "@playwright/test";

/** مرآة `TRASH_RETENTION_MS` في `src-tauri/src/storage/document.rs`. */
export const MOCK_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** مرآة `MIN_CHANGE_CHARS` في `src-tauri/src/storage/revision.rs`. */
export const MOCK_MIN_CHANGE_CHARS = 80;

export interface MockBlock {
  id?: string;
  role: string;
  text: string;
  marks?: unknown[];
}

export interface MockDoc {
  id: string;
  title?: string | null;
  text?: string;
  blocks?: MockBlock[];
  createdAt?: number;
  updatedAt?: number;
  revisions?: MockRevision[];
}

export interface MockRevision {
  id: string;
  documentId: string;
  createdAt: number;
  source: "automatic" | "beforeRestore";
  wordCount: number;
  blocks: MockBlock[];
}

/** لقطة قابلة للتأكيد عليها من جانب الاختبار. */
export interface MockDump {
  docs: { id: string; title: string | null; text: string; updatedAt: number }[];
  trash: { id: string; title: string | null; text: string; deletedAt: number }[];
  revs: Record<string, number>;
}

/** الواجهة التي يراها الاختبار على `window.__luma`. */
export interface MockHandle {
  dump(): MockDump;
  seed(doc: MockDoc): void;
  /** يدفع مستندًا إلى السلّة مباشرةً — تجهيزُ حالة لا مسارُ منتج. */
  seedTrashed(doc: MockDoc): void;
  /**
   * يُقدّم ختمَ حذفِ عنصرٍ في السلّة إلى الماضي — لاختبار الكسح الكسول
   * بلا انتظار ثلاثين يومًا. مرآةُ `set_deleted_at` في اختبارات Rust.
   */
  ageTrashed(id: string, byMs: number): void;
  /** يبثّ حدث نواة — بند قائمة النظام مثلًا. يُبلّغ بعدد المستمعين. */
  emit(event: string, payload?: unknown): number;
  /** عدد نداءات أمرٍ بعينه **عند دخوله** — لإثبات أن شيئًا لم يُنادَ. */
  calls(cmd: string): number;
  /**
   * عدد ما **اكتمل** منه — غير `calls` عمدًا.
   *
   * مع تأخيرٍ صناعي يفترقان: `calls` تُحصى عند الدخول، فانتظارُها
   * يعني انتظار بدء الرحلة لا نهايتها. من ينتظر الأثر ينتظر هذه.
   */
  done(cmd: string): number;
  /** أسماء كل ما نُودي، بالترتيب. */
  log(): string[];
  /** تأخير صناعي على أمر — يفتح نوافذ تشابك لا يفتحها النقر البشري. */
  delay(cmd: string, ms: number): void;
  /** فشل صناعي على أمر. */
  fail(cmd: string, message: string): void;
  /** يرفع كل فشلٍ صناعي. */
  clearFailures(): void;
  /** آخر ما طُلب تصديره — المحتوى الذي بنته الواجهة، لا ملفٌ كُتب. */
  lastExport(): { contents: string; fileName: string; extension: string } | null;
}

declare global {
  interface Window {
    __luma: MockHandle;
  }
}

interface InstallConfig {
  retentionMs: number;
  minChangeChars: number;
  /** مستندات تُبذر قبل إقلاع التطبيق — لاختبار الإقلاع النظيف. */
  seed: MockDoc[];
  seedTrashed: MockDoc[];
  /**
   * مشهدٌ يُفتح عند الإقلاع — قيمة `demo_stage` التي يقرؤها
   * `App.svelte`. `"fonts"` وحدها تفتح ورقة الخط، ولا مدخل آخر لها
   * في وضع الويب.
   */
  stage: string;
}

/**
 * يركّب الجسر **قبل** أي سكربت في الصفحة.
 *
 * `page.addInitScript` يسلسل الدالة نصًّا، فكل ما تحتاجه يصل عبر
 * `config` — لا إغلاق على مستوردات.
 */
export async function installBridge(
  page: Page,
  opts: { seed?: MockDoc[]; seedTrashed?: MockDoc[]; stage?: string } = {},
): Promise<void> {
  const config: InstallConfig = {
    retentionMs: MOCK_TRASH_RETENTION_MS,
    minChangeChars: MOCK_MIN_CHANGE_CHARS,
    seed: opts.seed ?? [],
    seedTrashed: opts.seedTrashed ?? [],
    stage: opts.stage ?? "",
  };

  await page.addInitScript((cfg: InstallConfig) => {
    interface StoredDoc {
      schemaVersion: number;
      id: string;
      title: string | null;
      blocks: MockBlock[];
      createdAt: number;
      updatedAt: number;
      lastOpenedAt: number;
      deletedAt: number | null;
    }

    const docs = new Map<string, StoredDoc>();
    const trash = new Map<string, StoredDoc>();
    const revs = new Map<string, MockRevision[]>();
    let prefs: Record<string, unknown> = {};
    let lastExport: { contents: string; fileName: string; extension: string } | null =
      null;
    let revSeq = 0;

    const callLog: string[] = [];
    const doneLog: string[] = [];
    const delays: Record<string, number> = {};
    const failures: Record<string, string> = {};

    // ── مساعدات مرآة `storage::model` ───────────────────────
    const isEmpty = (d: { blocks: MockBlock[] }): boolean =>
      d.blocks.every((b) => (b.text || "").trim() === "");

    const wordCount = (d: { blocks: MockBlock[] }): number =>
      d.blocks.reduce(
        (n, b) => n + (b.text || "").split(/\s+/).filter(Boolean).length,
        0,
      );

    const charCount = (blocks: MockBlock[]): number =>
      blocks.reduce((n, b) => n + [...(b.text || "")].length, 0);

    const displayTitle = (d: StoredDoc): string => {
      if (d.title && d.title.trim()) return d.title.trim();
      for (const b of d.blocks) {
        const line = (b.text || "").trim();
        if (line) return line.length <= 60 ? line : line.slice(0, 60).trimEnd() + "…";
      }
      return "بدون عنوان";
    };

    const excerpt = (d: StoredDoc): string => {
      const parts = d.blocks.map((b) => (b.text || "").trim()).filter(Boolean);
      const rest = parts.slice(1).join(" ");
      return rest.length <= 120 ? rest : rest.slice(0, 120).trimEnd() + "…";
    };

    const summary = (d: StoredDoc) => ({
      id: d.id,
      title: displayTitle(d),
      excerpt: excerpt(d),
      wordCount: wordCount(d),
      updatedAt: d.updatedAt,
      lastOpenedAt: d.lastOpenedAt,
    });

    const trashSummary = (d: StoredDoc) => ({
      id: d.id,
      title: displayTitle(d),
      excerpt: excerpt(d),
      wordCount: wordCount(d),
      deletedAt: d.deletedAt ?? 0,
    });

    const revsOf = (id: string): MockRevision[] => {
      let list = revs.get(id);
      if (!list) {
        list = [];
        revs.set(id, list);
      }
      return list;
    };

    /** مرآة `RevisionStore::should_snapshot`. */
    const shouldSnapshot = (d: StoredDoc): boolean => {
      if (isEmpty(d)) return false;
      const list = revsOf(d.id);
      if (list.length === 0) return true;
      const latest = [...list].sort((a, b) => b.createdAt - a.createdAt)[0]!;
      return Math.abs(charCount(latest.blocks) - charCount(d.blocks)) >= cfg.minChangeChars;
    };

    const createRevision = (
      d: StoredDoc,
      source: "automatic" | "beforeRestore",
    ): MockRevision => {
      const createdAt = Date.now();
      // المعرّف من الطابع الزمني ليكون الترتيب المعجمي زمنيًّا — وعدّاد
      // يمنع التصادم داخل الميلّي الواحد (لا نظير له في Rust، فالقرص أبطأ)
      const rev: MockRevision = {
        id: `${String(createdAt).padStart(13, "0")}-${revSeq++}`,
        documentId: d.id,
        createdAt,
        source,
        wordCount: wordCount(d),
        blocks: JSON.parse(JSON.stringify(d.blocks)) as MockBlock[],
      };
      revsOf(d.id).push(rev);
      return rev;
    };

    /** مرآة `DocumentStore::sweep_expired` — الكسح الكسول. */
    const sweepExpired = (now: number): number => {
      let purged = 0;
      for (const [id, d] of [...trash.entries()]) {
        if (now - (d.deletedAt ?? 0) >= cfg.retentionMs) {
          trash.delete(id);
          revs.delete(id);
          purged++;
        }
      }
      return purged;
    };

    // ── قفل السلّة — مرآة `Storage::trash_guard` ─────────────
    let trashLock: Promise<unknown> = Promise.resolve();
    const underTrashLock = <T>(fn: () => T): Promise<T> => {
      const run = trashLock.then(fn, fn);
      trashLock = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    };

    const toStored = (d: MockDoc): StoredDoc => {
      const now = Date.now();
      return {
        schemaVersion: 1,
        id: d.id,
        title: d.title ?? null,
        blocks: d.blocks ?? [{ role: "body", text: d.text ?? "", marks: [] }],
        createdAt: d.createdAt ?? now,
        updatedAt: d.updatedAt ?? now,
        lastOpenedAt: now,
        deletedAt: null,
      };
    };

    // ── الأوامر ─────────────────────────────────────────────
    type Args = Record<string, unknown>;
    const handlers: Record<string, (a: Args) => unknown> = {
      save_document(a) {
        const p = a["payload"] as {
          id: string;
          title: string | null;
          blocks: MockBlock[];
          createdAt: number | null;
        };
        const now = Date.now();
        const existing = docs.get(p.id);
        const candidate: StoredDoc = {
          schemaVersion: 1,
          id: p.id,
          title: p.title ?? null,
          blocks: JSON.parse(JSON.stringify(p.blocks)) as MockBlock[],
          createdAt: p.createdAt ?? now,
          updatedAt: now,
          lastOpenedAt: now,
          deletedAt: null,
        };
        // «مستند بلا محتوى لا يُكتب أصلًا» — commands.rs
        if (isEmpty(candidate) && !existing) {
          return { id: p.id, updatedAt: now, snapshotCreated: false };
        }
        if (existing) candidate.createdAt = existing.createdAt;
        docs.set(candidate.id, candidate);
        // «اللقطة بعد نجاح الحفظ لا قبله»
        let snapshotCreated = false;
        if (shouldSnapshot(candidate)) {
          createRevision(candidate, "automatic");
          snapshotCreated = true;
        }
        return { id: candidate.id, updatedAt: candidate.updatedAt, snapshotCreated };
      },

      load_document(a) {
        const id = a["id"] as string;
        const d = docs.get(id);
        if (!d) throw new Error("المستند غير موجود");
        d.lastOpenedAt = Date.now();
        return {
          id: d.id,
          title: d.title,
          displayTitle: displayTitle(d),
          blocks: JSON.parse(JSON.stringify(d.blocks)) as MockBlock[],
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        };
      },

      list_documents() {
        const documents = [...docs.values()]
          .map(summary)
          .sort((x, y) => y.updatedAt - x.updatedAt);
        return { documents, damaged: [] };
      },

      delete_document(a) {
        const id = a["id"] as string;
        const d = docs.get(id);
        // «الغياب التام ليس خطأً» — نجاحٌ صامت
        if (!d) return null;
        // `has_any_snapshot` لا `list().is_empty()` — الشرح في commands.rs
        const hasHistory = revsOf(id).length > 0;
        if (isEmpty(d) && !hasHistory) {
          docs.delete(id);
          revs.delete(id);
          return null;
        }
        return underTrashLock(() => {
          docs.delete(id);
          d.deletedAt = Date.now();
          trash.set(id, d);
          return null;
        });
      },

      restore_document(a) {
        const id = a["id"] as string;
        return underTrashLock(() => {
          const d = trash.get(id);
          if (!d) throw new Error("المستند غير موجود");
          trash.delete(id);
          d.deletedAt = null;
          docs.set(id, d);
          return null;
        });
      },

      list_trash() {
        return underTrashLock(() => {
          sweepExpired(Date.now());
          const documents = [...trash.values()]
            .map(trashSummary)
            .sort((x, y) => y.deletedAt - x.deletedAt);
          return { documents, damaged: [] };
        });
      },

      empty_trash() {
        return underTrashLock(() => {
          const n = trash.size;
          for (const id of trash.keys()) revs.delete(id);
          trash.clear();
          return n;
        });
      },

      list_revisions(a) {
        const id = a["documentId"] as string;
        return revsOf(id)
          .map((r) => ({
            id: r.id,
            createdAt: r.createdAt,
            source: r.source,
            wordCount: r.wordCount,
          }))
          .sort((x, y) => y.createdAt - x.createdAt);
      },

      load_revision(a) {
        const docId = a["documentId"] as string;
        const revId = a["revisionId"] as string;
        const rev = revsOf(docId).find((r) => r.id === revId);
        if (!rev) throw new Error("اللقطة غير موجودة");
        return JSON.parse(JSON.stringify(rev)) as MockRevision;
      },

      restore_revision(a) {
        const docId = a["documentId"] as string;
        const revId = a["revisionId"] as string;
        const target = revsOf(docId).find((r) => r.id === revId);
        if (!target) throw new Error("اللقطة غير موجودة");
        const d = docs.get(docId);
        if (!d) throw new Error("المستند غير موجود");
        // «لا شبكة لفراغ» — `create_guard` تُبلّغ None
        const guard = isEmpty(d) ? null : createRevision(d, "beforeRestore");
        d.blocks = JSON.parse(JSON.stringify(target.blocks)) as MockBlock[];
        d.updatedAt = Date.now();
        return {
          blocks: JSON.parse(JSON.stringify(target.blocks)) as MockBlock[],
          guardRevisionId: guard ? guard.id : null,
        };
      },

      // ── تفضيلات وخطوط وأدوات ──────────────────────────────
      load_preferences: () => prefs,
      save_preferences: (a) => {
        prefs = a["value"] as Record<string, unknown>;
        return null;
      },
      list_fonts: () => [],
      pick_and_import_font: () => null,
      /**
       * التصدير — يُسجَّل ولا يكتب.
       *
       * لا لوحة نظام في المتصفح ولا قرص، فالمقلِّد يحفظ آخر ما طُلب
       * تصديره ليؤكّد عليه الاختبار: **المحتوى الذي بنته الواجهة**
       * هو الدعوى، والكتابةُ نفسها مسؤولية Rust وتُختبر هناك.
       */
      export_document: (a) => {
        lastExport = {
          contents: a["contents"] as string,
          fileName: a["fileName"] as string,
          extension: a["extension"] as string,
        };
        return "/tmp/luma-export/" + (a["fileName"] as string);
      },
      /** PDF: لا لوحة نظام في المتصفح — التسجيل عبر `calls()` العام يكفي. */
      print_document: () => null,
      open_project_page: () => null,
      ui_ready: () => null,
      close_declined: () => null,
      startup_elapsed_ms: () => 120,
      data_dir: () => "/tmp/luma-e2e",
      window_controls_x: () => 20,
      selftest_mode: () => false,
      selftest_phase: () => "0",
      demo_mode: () => false,
      demo_stage: () => cfg.stage,
      gallery_mode: () => false,
      write_report: () => null,
      seed_library: () => null,
      cleanup_selftest: () => 0,
    };

    // ── أحداث النواة ────────────────────────────────────────
    const callbacks = new Map<number, (e: unknown) => void>();
    let cbSeq = 0;
    const listeners: { id: number; event: string; cb: ((e: unknown) => void) | undefined }[] =
      [];
    let listenerSeq = 0;

    handlers["plugin:event|listen"] = (a) => {
      const id = ++listenerSeq;
      listeners.push({
        id,
        event: a["event"] as string,
        cb: callbacks.get(a["handler"] as number),
      });
      return id;
    };
    handlers["plugin:event|unlisten"] = (a) => {
      const i = listeners.findIndex((l) => l.id === (a["eventId"] as number));
      if (i >= 0) listeners.splice(i, 1);
      return null;
    };
    handlers["plugin:app|version"] = () => "1.0.0-e2e";
    handlers["plugin:window|destroy"] = () => null;

    (window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ =
      { unregisterListener: () => undefined };

    // ── البذر قبل الإقلاع ───────────────────────────────────
    const seedDoc = (d: MockDoc, intoTrash: boolean) => {
      const stored = toStored(d);
      if (intoTrash) {
        stored.deletedAt = Date.now();
        trash.set(stored.id, stored);
      } else {
        docs.set(stored.id, stored);
      }
      if (d.revisions) revs.set(stored.id, d.revisions);
    };
    for (const d of cfg.seed) seedDoc(d, false);
    for (const d of cfg.seedTrashed) seedDoc(d, true);

    // ── الواجهة التي يراها الاختبار ─────────────────────────
    window.__luma = {
      dump: () => ({
        docs: [...docs.values()].map((d) => ({
          id: d.id,
          title: d.title,
          text: d.blocks.map((b) => b.text).join("\n"),
          updatedAt: d.updatedAt,
        })),
        trash: [...trash.values()].map((d) => ({
          id: d.id,
          title: d.title,
          text: d.blocks.map((b) => b.text).join("\n"),
          deletedAt: d.deletedAt ?? 0,
        })),
        revs: Object.fromEntries([...revs.entries()].map(([k, v]) => [k, v.length])),
      }),
      seed: (d) => seedDoc(d, false),
      seedTrashed: (d) => seedDoc(d, true),
      ageTrashed: (id, byMs) => {
        const d = trash.get(id);
        if (!d) throw new Error("لا عنصر في السلّة بهذا المعرّف: " + id);
        d.deletedAt = (d.deletedAt ?? Date.now()) - byMs;
      },
      emit: (event, payload) => {
        let n = 0;
        for (const l of listeners) {
          if (l.event === event && l.cb) {
            l.cb({ event, id: l.id, payload });
            n++;
          }
        }
        return n;
      },
      calls: (cmd) => callLog.filter((c) => c === cmd).length,
      done: (cmd) => doneLog.filter((c) => c === cmd).length,
      log: () => [...callLog],
      delay: (cmd, ms) => {
        delays[cmd] = ms;
      },
      fail: (cmd, message) => {
        failures[cmd] = message;
      },
      clearFailures: () => {
        for (const k of Object.keys(failures)) delete failures[k];
      },
      lastExport: () => lastExport,
    };

    // ── الجسر نفسه ──────────────────────────────────────────
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      transformCallback(cb: (e: unknown) => void) {
        const id = ++cbSeq;
        callbacks.set(id, cb);
        return id;
      },
      unregisterCallback(id: number) {
        callbacks.delete(id);
      },
      convertFileSrc: (p: string) => p,
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      async invoke(cmd: string, args?: Args) {
        callLog.push(cmd);
        const h = handlers[cmd];
        if (!h) throw new Error("أمر غير معروف في المقلِّد: " + cmd);
        const ms = delays[cmd];
        if (ms) await new Promise((r) => setTimeout(r, ms));
        const failure = failures[cmd];
        if (failure) throw new Error(failure);
        const out = await h(args ?? {});
        doneLog.push(cmd);
        return out;
      },
    };
  }, config);
}
