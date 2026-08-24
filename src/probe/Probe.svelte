<script lang="ts">
  import { onDestroy } from "svelte";
  import { ProseMirrorCandidate } from "./candidates/prosemirror";
  import { LexicalCandidate } from "./candidates/lexical";
  import { RawCandidate } from "./candidates/raw";
  import { buildDocument, emptyDocument, wordCount } from "./corpus";
  import { measureCandidate, type CandidateMeasurement } from "./measure";
  import type { EditorCandidate } from "./types";

  const makeCandidates = (): EditorCandidate[] => [
    new ProseMirrorCandidate(),
    new LexicalCandidate(),
    new RawCandidate(),
  ];

  let hostEl = $state<HTMLDivElement | null>(null);
  let benchEl = $state<HTMLDivElement | null>(null);
  let warmEl = $state<HTMLDivElement | null>(null);
  let current = $state<EditorCandidate | null>(null);
  let activeId = $state<string>("prosemirror");
  let focusMode = $state(false);
  let typewriter = $state(false);
  let results = $state<CandidateMeasurement[]>([]);
  let running = $state(false);
  let dataDir = $state<string>("—");
  let bootMs = $state<number>(0);

  // زمن الفتح حتى مؤشر قابل للكتابة.
  const bootStart = performance.now();

  function mount(id: string, words: number) {
    current?.destroy();
    const c = makeCandidates().find((x) => x.id === id);
    if (!c || !hostEl) return;
    const doc = words === 0 ? emptyDocument() : buildDocument(words);
    c.mount(hostEl, doc);
    c.focus();
    current = c;
    activeId = id;
    focusMode = false;
    if (bootMs === 0) bootMs = Math.round(performance.now() - bootStart);
  }

  $effect(() => {
    if (hostEl && !current) mount("prosemirror", 0);
  });

  function toggleFocus() {
    focusMode = !focusMode;
    current?.setFocusMode(focusMode);
  }

  // وضع الآلة الكاتبة — يثبت أن القدرة ١ تكفي فعلًا لتنفيذه.
  function onKeyUp() {
    if (focusMode) current?.setFocusMode(true);
    if (!typewriter || !current || !hostEl) return;
    const rect = current.caretRect();
    if (!rect) return;
    const scroller = hostEl.parentElement;
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    const target = box.top + box.height * 0.42;
    const delta = rect.top - target;
    if (Math.abs(delta) > 1) {
      scroller.scrollBy({
        top: delta,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    }
  }

  async function runBenchmark(words: number) {
    running = true;
    results = [];
    const out: CandidateMeasurement[] = [];
    for (const c of makeCandidates()) {
      if (!benchEl || !warmEl) break;
      benchEl.innerHTML = "";
      const doc = buildDocument(words);
      try {
        out.push(await measureCandidate(c, benchEl, doc, wordCount(doc), warmEl));
      } catch (e) {
        out.push({
          id: c.id,
          name: c.name,
          words,
          mountMs: -1,
          insertCost: { p50: -1, p95: -1, max: -1, samples: 0 },
          keyToPaint: { p50: -1, p95: -1, max: -1, samples: 0 },
          undoBurstChars: -1,
          undoConfigurable: false,
          focusMutatesModel: true,
          caretRectAvailable: false,
          framesToCaret: -1,
          notes: [`سقط أثناء القياس: ${String(e)}`],
        });
      }
      results = [...out];
      await new Promise((r) => setTimeout(r, 50));
    }
    if (benchEl) benchEl.innerHTML = "";
    running = false;
    mount(activeId, 0);
  }

  let reportPath = $state<string>("");

  async function boot() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      dataDir = await invoke<string>("data_dir");

      if (await invoke<boolean>("demo_mode")) {
        mount("prosemirror", 5000);
        await new Promise((r) => setTimeout(r, 300));
        focusMode = true;
        typewriter = true;
        current?.setFocusMode(true);
      }

      // وضع القياس: يشتغل داخل Luma.app ويكتب الدليل إلى ملف.
      if (await invoke<boolean>("bench_mode")) {
        await new Promise((r) => setTimeout(r, 600));
        const all: CandidateMeasurement[] = [];
        for (const words of [5000, 20000]) {
          await runBenchmark(words);
          all.push(...results);
        }
        reportPath = await invoke<string>("write_probe_report", {
          json: JSON.stringify(
            {
              bootMs,
              userAgent: navigator.userAgent,
              measurements: all,
            },
            null,
            2,
          ),
        });
      }
    } catch {
      dataDir = "خارج Luma.app (متصفح)";
    }
  }
  boot();

  function copyReport() {
    navigator.clipboard.writeText(JSON.stringify(results, null, 2));
  }

  onDestroy(() => current?.destroy());
</script>

<div class="titlebar" data-tauri-drag-region>
  <span class="wordmark">Luma</span>
  <span class="phase">المرحلة ١ — بوابة القدرات</span>
</div>

<div class="bar">
  <div class="group">
    <span class="label">الأساس</span>
    {#each makeCandidates() as c (c.id)}
      <button
        class="chip"
        class:on={activeId === c.id}
        onclick={() => mount(c.id, 0)}>{c.name}</button
      >
    {/each}
  </div>
  <div class="group">
    <span class="label">المستند</span>
    <button class="chip" onclick={() => mount(activeId, 0)}>فارغ</button>
    <button class="chip" onclick={() => mount(activeId, 5000)}>٥ آلاف</button>
    <button class="chip" onclick={() => mount(activeId, 20000)}>٢٠ ألفًا</button>
  </div>
  <div class="group">
    <button class="chip" class:on={focusMode} onclick={toggleFocus}>تركيز</button>
    <button
      class="chip"
      class:on={typewriter}
      onclick={() => (typewriter = !typewriter)}>آلة كاتبة</button
    >
  </div>
  <div class="group">
    <button class="chip run" disabled={running} onclick={() => runBenchmark(5000)}>
      {running ? "يقيس…" : "قياس ٥ آلاف"}
    </button>
    <button class="chip run" disabled={running} onclick={() => runBenchmark(20000)}>
      قياس ٢٠ ألفًا
    </button>
  </div>
</div>

<div class="scroller" onkeyup={onKeyUp} role="none">
  <div class="sheet"><div class="host" bind:this={hostEl}></div></div>
</div>

<div class="bench" bind:this={benchEl}></div>
<div class="bench" bind:this={warmEl}></div>

{#if results.length}
  <div class="report">
    <div class="report-head">
      <strong>نتيجة القياس</strong>
      <button class="chip" onclick={copyReport}>نسخ JSON</button>
    </div>
    <table>
      <thead>
        <tr>
          <th>الأساس</th><th>بناء</th><th>إدراج p50</th><th>إدراج p95</th>
          <th>تراجع</th><th>نقاء التركيز</th><th>مؤشر</th>
        </tr>
      </thead>
      <tbody>
        {#each results as r (r.id)}
          <tr>
            <td>{r.name}</td>
            <td>{r.mountMs}ms</td>
            <td>{r.insertCost.p50}ms</td>
            <td>{r.insertCost.p95}ms</td>
            <td class:bad={r.undoBurstChars <= 1}>{r.undoBurstChars} حرفًا</td>
            <td class:bad={r.focusMutatesModel}>
              {r.focusMutatesModel ? "لمس النموذج" : "سليم"}
            </td>
            <td class:bad={!r.caretRectAvailable}>
              {r.caretRectAvailable ? "متاح" : "غائب"}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#each results.filter((r) => r.notes.length) as r (r.id)}
      <p class="note"><strong>{r.name}:</strong> {r.notes.join(" — ")}</p>
    {/each}
  </div>
{/if}

<div class="foot">
  <span>مجلد البيانات: <code>{dataDir}</code></span>
  <span>الفتح حتى مؤشر قابل للكتابة: <strong>{bootMs}ms</strong></span>
  {#if reportPath}<span>التقرير: <code>{reportPath}</code></span>{/if}
</div>

<style>
  .titlebar {
    height: var(--titlebar-h);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: var(--surface-raised);
    border-block-end: 1px solid var(--border-subtle);
    position: relative;
  }
  .wordmark {
    font-weight: 700;
    letter-spacing: 0;
  }
  .phase {
    color: var(--text-muted);
    font-size: 12px;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    padding: 10px 20px;
    background: var(--surface-raised);
    border-block-end: 1px solid var(--border-subtle);
  }
  .group {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .label {
    font-size: 12px;
    color: var(--text-muted);
  }
  .chip {
    font: inherit;
    font-size: 13px;
    padding: 6px 12px;
    min-height: 28px;
    border-radius: 8px;
    border: 1px solid var(--border-strong);
    background: var(--surface-paper);
    color: var(--text-primary);
    cursor: pointer;
  }
  .chip.on {
    background: var(--accent-text);
    border-color: var(--accent-text);
    color: #fff;
  }
  .chip.run {
    border-color: var(--accent-graphic);
    color: var(--accent-text);
  }
  .chip:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .scroller {
    flex: 1;
    overflow-y: auto;
    display: flex;
    justify-content: center;
    padding-block: 25vh;
  }
  .sheet {
    width: var(--sheet-w);
    padding-inline: var(--sheet-pad);
    background: var(--surface-paper);
  }
  .host {
    max-width: var(--column-w);
    margin-inline: auto;
  }
  .bench {
    position: absolute;
    inset-block-start: -10000px;
    inline-size: var(--column-w);
    block-size: 600px;
    overflow: hidden;
  }
  .report {
    border-block-start: 1px solid var(--border-strong);
    background: var(--surface-raised);
    padding: 12px 20px;
    max-height: 34vh;
    overflow: auto;
  }
  .report-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-block-end: 8px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th,
  td {
    text-align: start;
    padding: 6px 10px;
    border-block-end: 1px solid var(--border-subtle);
  }
  th {
    color: var(--text-muted);
    font-weight: 600;
  }
  td.bad {
    color: #a3341f;
    font-weight: 700;
  }
  .note {
    font-size: 12px;
    color: var(--text-secondary);
    margin: 6px 0 0;
  }
  .foot {
    display: flex;
    gap: 24px;
    padding: 8px 20px;
    font-size: 12px;
    color: var(--text-muted);
    background: var(--surface-raised);
    border-block-start: 1px solid var(--border-subtle);
  }
  code {
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }
</style>
