/**
 * مولّد صفحة «أين وصلت لوما».
 *
 * يقرأ مصادر الحقيقة في المستودع ويُخرج `docs/site/index.html` صفحةً واحدة
 * قائمة بذاتها. **لا حالة مكتوبة يدويًا هنا:** ما اكتمل يُشتق من سجل git،
 * والمراحل من `PLAN.md`، والقرارات من `docs/decisions/`، والمسائل المفتوحة
 * من جدولَي `Luma.md` §٢٠ و`IMPLEMENTATION.md` §١٨، والألوان من طبقة الرموز.
 *
 * التشغيل: `npm run site` — ثم يُنشر الملف كـArtifact.
 *
 * الأعلام:
 *   --fast   لا يشغّل اختبارات الوحدات (أسرع، ويُسقط عدّادها)
 *   --no-img لا يدمج اللقطات (مخرَج خفيف للتجربة)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CACHE = join(HERE, '.cache');
const ARGS = new Set(process.argv.slice(2));
const WANT_TESTS = !ARGS.has('--fast');
const WANT_IMAGES = !ARGS.has('--no-img');

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const has = (p) => existsSync(join(ROOT, p));

/* ————————————————————————————— أدوات نص ————————————————————————————— */

const AR = '٠١٢٣٤٥٦٧٨٩';
const toAr = (n) => String(n).replace(/[0-9]/g, (d) => AR[+d]);
const fromAr = (s) => Number(String(s).replace(/[٠-٩]/g, (d) => AR.indexOf(d)));

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * عزل المقاطع اللاتينية داخل جملة عربية — `IMPLEMENTATION.md` §٧ **ثابت**.
 * العبارة اللاتينية بمسافاتها عازلٌ واحد، وإلا رُسمت كلماتها في الترتيب المعكوس.
 */
const LATIN = /(?<![\u2066\w])([A-Za-z][A-Za-z0-9._/@+#=_-]*(?:[ \u00A0][A-Za-z0-9][A-Za-z0-9._/@+#=_-]*)*)/g;
const iso = (s) => String(s).replace(LATIN, '\u2066$1\u2069');

/**
 * عزل ما بين الوسوم في مستند كامل: يمسّ النص وحده، ولا يقترب من وسم ولا سمة
 * ولا من `style` و`script`. الكيانات (`&amp;`) تُقنَّع أولًا فلا يُكسر رمزها.
 */
function isoHtml(html) {
  const parts = html.split(/(<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>)/);
  return parts
    .map((part, i) => {
      if (i % 2) return part;
      return part.replace(/>([^<]+)</g, (_, text) => {
        const ents = [];
        const masked = text.replace(/&(?:[a-zA-Z]+|#\d+);/g, (e) => {
          ents.push(e);
          return `\u0000${ents.length - 1}\u0000`;
        });
        return '>' + iso(masked).replace(/\u0000(\d+)\u0000/g, (_m, k) => ents[+k]) + '<';
      });
    })
    .join('');
}

/** نص عربي فيه لاتيني، للعناوين والسمات. */
const escIso = (s) => esc(iso(s));

/** جزيرة لاتينية صريحة: تواريخ ومعرّفات وأرقام إصدار. */
const ltr = (s) => `<span class="ltr">${esc(s)}</span>`;

/** ماركداون سطري → HTML. الروابط تُعرض مراجعَ لا وصلات: وجهتها ملفات المستودع. */
function inline(s) {
  // ما بين العلامتين المائلتين نصّ حرفي: يعزله الـCSS، ولا يُقطَّع هنا.
  const parts = String(s).trim().split('`');
  const src = parts.map((part, i) => (i % 2 ? '`' + part + '`' : iso(part))).join('');
  return esc(src)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="ref">$1</span>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>');
}

/* ————————————————————————————— قراءة المصادر ————————————————————————————— */

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function gitLog() {
  const raw = git(['log', '--pretty=format:%h%x1f%ad%x1f%s', '--date=short']);
  if (!raw) return [];
  return raw.split('\n').map((line) => {
    const [hash, date, subject] = line.split('\u001f');
    return { hash, date, subject };
  });
}

/** المرحلة تُعدّ مكتملة إذا وُجد لها التزام في السجل. لا علم يدوي. */
function phaseCommit(commits, n) {
  const ar = toAr(n);
  return commits.find((c) => new RegExp(`^المرحلة ${ar}\\s*[:：]`).test(c.subject)) || null;
}

/** يفصل أقسام المرحلة في PLAN.md بوسومها العريضة. */
function splitFields(body) {
  const labels = ['الهدف', 'لماذا أولًا', 'النطاق', 'الاعتماديات', 'المخرجات', 'معيار الاكتمال'];
  const re = new RegExp(`\\*\\*(${labels.join('|')})\\.\\*\\*`, 'g');
  const hits = [...body.matchAll(re)];
  const out = {};
  hits.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < hits.length ? hits[i + 1].index : body.length;
    out[m[1]] = body.slice(start, end).trim();
  });
  return out;
}

/** أسطر القائمة فقط — تُتجاهل الجداول وأسطر الشرح. */
function bullets(chunk) {
  if (!chunk) return [];
  return chunk
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim());
}

function paragraph(chunk) {
  if (!chunk) return '';
  return chunk
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('-') && !l.startsWith('|') && !l.startsWith('**'))
    .join(' ')
    .trim();
}

function parsePlan(md) {
  const parts = md.split(/\n## المرحلة /).slice(1);
  return parts.map((part) => {
    const head = part.slice(0, part.indexOf('\n'));
    const body = part.slice(part.indexOf('\n'));
    const m = head.match(/^([٠-٩]+)\s*—\s*(.+?)\s*·\s*`([^`]+)`/);
    const f = splitFields(body);
    return {
      n: m ? fromAr(m[1]) : 0,
      name: m ? m[2] : head.trim(),
      slug: m ? m[3] : '',
      goal: paragraph(f['الهدف']),
      why: paragraph(f['لماذا أولًا']),
      scope: bullets(f['النطاق']),
      deps: paragraph(f['الاعتماديات']),
      outputs: bullets(f['المخرجات']),
      criteria: bullets(f['معيار الاكتمال']),
    };
  });
}

function parseDecisions() {
  const dir = join(ROOT, 'docs', 'decisions');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file) => {
      const md = readFileSync(join(dir, file), 'utf8');
      const title = (md.match(/^#\s+(.+)$/m) || [, file])[1];
      const meta = (md.match(/^\*\*الحالة:\*\*.*$/m) || [''])[0];
      const phase = meta.match(/\*\*المرحلة:\*\*\s*([٠-٩]+)/);
      const state = (meta.match(/\*\*الحالة:\*\*\s*([^·]+)/) || [, ''])[1]
        .replace(/[*✅]/g, '')
        .trim();
      const decision = md.split(/^## القرار.*$/m)[1] || md.split(/^## الاكتشاف.*$/m)[1] || '';
      const summary = decision
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('|') && !l.startsWith('#') && !l.startsWith('>'))
        .slice(0, 2)
        .join(' ');
      const num = (title.match(/^([٠-٩]+)/) || [, ''])[1];
      // الصفر العربي الهندي «٠» نقطة: «٠٠٠١» تُقرأ نقاطًا. يُعرض الرقم بلا أصفار.
      const short = num.replace(/^٠+(?=[٠-٩])/, '');
      return {
        file,
        num,
        short,
        title: title.replace(/^[٠-٩]+\s*—\s*/, ''),
        state,
        phase: phase ? fromAr(phase[1]) : null,
        summary,
      };
    });
}

/** جدول مسائل: يُقرأ ما بين عنوانه والعنوان التالي. المشطوب = محسوم. */
function parseIssueTable(md, heading) {
  const at = md.indexOf(heading);
  if (at < 0) return [];
  const rest = md.slice(at);
  const end = rest.indexOf('\n## ', 1);
  const block = end > 0 ? rest.slice(0, end) : rest;
  const rows = block
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .map((l) => l.trim().slice(1, -1).split('|').map((c) => c.trim()));
  return rows
    .filter((c) => c.length >= 2 && !/^-+$/.test(c[0]) && !/^:?-{2,}/.test(c[1] || ''))
    .filter((c) => /[٠-٩]/.test(c[0]))
    .map((c) => ({
      id: c[0].replace(/~/g, '').trim(),
      resolved: c[0].includes('~~'),
      text: c[1] || '',
      note: c[2] || '',
    }));
}

function parseSelftests() {
  const dir = join(ROOT, 'docs', 'evidence');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^phase(\d+)-selftest\.json$/.test(f))
    .map((f) => {
      const phase = Number(f.match(/^phase(\d+)/)[1]);
      const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const checks = Array.isArray(data.checks) ? data.checks : [];
      return { phase, file: f, checks, passed: checks.filter((c) => c.passed).length };
    })
    .sort((a, b) => a.phase - b.phase);
}

/* ————————————————————————————— اللقطات ————————————————————————————— */

function captions() {
  const p = join(HERE, 'captions.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}

/** تصغير وتحويل عبر `sips` مع ذاكرة مؤقتة بحسب زمن التعديل والحجم. */
function optimize(src) {
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
  const st = statSync(src);
  const key = `${basename(src, '.png')}-${st.size}-${Math.round(st.mtimeMs)}.jpg`;
  const out = join(CACHE, key);
  if (!existsSync(out)) {
    execSync(
      `sips -Z 1280 -s format jpeg -s formatOptions 66 ${JSON.stringify(src)} --out ${JSON.stringify(out)}`,
      { stdio: 'ignore' },
    );
  }
  return `data:image/jpeg;base64,${readFileSync(out).toString('base64')}`;
}

function shots() {
  const dir = join(ROOT, 'docs', 'evidence');
  if (!existsSync(dir) || !WANT_IMAGES) return [];
  const caps = captions();
  return readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .sort()
    .map((f, i) => {
      const phase = Number((f.match(/^phase(\d+)/) || [, 0])[1]);
      let src = '';
      try {
        src = optimize(join(dir, f));
      } catch {
        src = '';
      }
      return { id: `s${i}`, file: f, phase, cap: iso(caps[f] || f.replace(/\.png$/, '')), src };
    })
    .filter((s) => s.src);
}

/* ————————————————————————————— إحصاءات ————————————————————————————— */

function countMatches(dir, exts, re) {
  let n = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (exts.some((x) => e.name.endsWith(x))) {
        n += (readFileSync(p, 'utf8').match(re) || []).length;
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return n;
}

function countLines(dirs, exts) {
  let files = 0;
  let lines = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (exts.some((x) => e.name.endsWith(x))) {
        files += 1;
        lines += readFileSync(p, 'utf8').split('\n').length;
      }
    }
  };
  for (const d of dirs) if (existsSync(join(ROOT, d))) walk(join(ROOT, d));
  return { files, lines };
}

function unitTests() {
  if (!WANT_TESTS) return null;
  try {
    // المخرَج يخرج على قناتَي الإخراج معًا بحسب البيئة، فيُدمجا قبل القراءة.
    const out = execSync('npx vitest run 2>&1', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300000,
    });
    const m = out.match(/Tests\s+(\d+)\s+passed\s+\((\d+)\)/);
    return m ? { passed: Number(m[1]), total: Number(m[2]) } : null;
  } catch (e) {
    const out = String(e.stdout || '');
    const m = out.match(/Tests\s+(\d+)\s+passed\s+\|\s+(\d+)\s+failed/);
    if (m) return { passed: Number(m[1]), total: Number(m[1]) + Number(m[2]) };
    return null;
  }
}

/* ————————————————————————————— الرموز ————————————————————————————— */

const TOKEN_VARS = {
  'surface/paper': '--paper',
  'surface/canvas': '--canvas',
  'surface/raised': '--raised',
  'surface/sunken': '--sunken',
  'border/subtle': '--line',
  'border/strong': '--line-strong',
  'border/control': '--line-control',
  'text/primary': '--ink',
  'text/secondary': '--ink-2',
  'text/muted': '--ink-3',
  'text/on-accent': '--on-accent',
  'editor/ink': '--editor-ink',
  'accent/graphic': '--accent',
  'accent/text': '--accent-text',
  'accent/subtle': '--accent-subtle',
  'accent/selection': '--accent-sel',
  'state/positive': '--ok',
  'state/positive-bg': '--ok-bg',
  'state/caution': '--warn',
  'state/caution-bg': '--warn-bg',
  'state/critical': '--bad',
  'state/critical-bg': '--bad-bg',
  'state/info': '--info',
  'state/info-bg': '--info-bg',
};

function themeVars(colors, mode) {
  return Object.entries(TOKEN_VARS)
    .map(([token, v]) => `${v}: ${colors[token][mode]};`)
    .join('\n      ');
}

/** أيقونات التطبيق نفسها — تُقرأ من `src/components/icons.ts` ولا تُرسم هنا. */
function icons() {
  const src = read('src/components/icons.ts');
  const out = {};
  const re = /"([a-z-]+)":\s*\{\s*label:\s*"([^"]*)",\s*viewBox:\s*"([^"]*)",\s*path:\s*"([^"]*)",\s*round:\s*(true|false)/g;
  let m;
  while ((m = re.exec(src))) out[m[1]] = { label: m[2], viewBox: m[3], path: m[4], round: m[5] === 'true' };
  return out;
}

function icon(set, name, cls = '') {
  const i = set[name];
  if (!i) return '';
  const cap = i.round ? ' stroke-linecap="round" stroke-linejoin="round"' : '';
  return `<svg class="i ${cls}" viewBox="${i.viewBox}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4"${cap}><path d="${i.path}"/></svg>`;
}

/* ————————————————————————————— البناء ————————————————————————————— */

const plan = parsePlan(read('PLAN.md'));
const commits = gitLog();
const decisions = parseDecisions();
const productIssues = parseIssueTable(read('Luma.md'), '## 20. المسائل المفتوحة');
const techIssues = parseIssueTable(read('IMPLEMENTATION.md'), '## 18. مسائل تقنية مفتوحة');
const selftests = parseSelftests();
const gallery = shots();
const pkg = JSON.parse(read('package.json'));
const tokens = JSON.parse(read('src/tokens/source.json'));
const ICONS = icons();

const phases = plan.map((p) => {
  const commit = phaseCommit(commits, p.n);
  return { ...p, commit, done: Boolean(commit), adrs: decisions.filter((d) => d.phase === p.n) };
});
const doneCount = phases.filter((p) => p.done).length;
const next = phases.find((p) => !p.done) || null;
const after = next ? phases.filter((p) => !p.done && p.n > next.n) : [];

const latest = selftests[selftests.length - 1] || null;
const openProduct = productIssues.filter((i) => !i.resolved);
const openTech = techIssues.filter((i) => !i.resolved);

const code = countLines(['src', 'src-tauri/src'], ['.ts', '.svelte', '.rs', '.mjs']);
const rustTests = countMatches(join(ROOT, 'src-tauri', 'src'), ['.rs'], /#\[test\]/g);
const e2eTests = countMatches(join(ROOT, 'tests', 'e2e'), ['.ts'], /^\s*test\(/gm);
const units = unitTests();
const components = existsSync(join(ROOT, 'src/components'))
  ? readdirSync(join(ROOT, 'src/components')).filter((f) => f.endsWith('.svelte')).length
  : 0;
const iconCount = Object.keys(ICONS).length;

const head = commits[0] || { hash: '—', date: '—', subject: '—' };
const builtAt = new Date().toISOString().slice(0, 10);

/* ————————————————————————————— قوالب ————————————————————————————— */

const stat = (value, label, sub = '') => `
      <div class="stat">
        <div class="stat-v">${value}</div>
        <div class="stat-l">${label}</div>
        ${sub ? `<div class="stat-s">${sub}</div>` : ''}
      </div>`;

/**
 * ثماني بطاقات دائمًا: الشبكة أربعة أعمدة، وخانة ناقصة تترك فجوة بلون الحد.
 * حين يتعذّر تشغيل اختبارات الوحدة يحلّ محلّها حجم الكود.
 */
const tiles = [
  stat(`${toAr(doneCount)}<span class="frac">/${toAr(phases.length)}</span>`, 'المراحل', 'مشتقّة من سجل git'),
  latest
    ? stat(
        `${toAr(latest.passed)}<span class="frac">/${toAr(latest.checks.length)}</span>`,
        'فحص داخل التطبيق',
        'آخر تقرير ذاتي',
      )
    : stat('—', 'فحص داخل التطبيق', 'لا تقرير'),
  units
    ? stat(toAr(units.passed), 'اختبار وحدة', 'vitest')
    : stat(toAr(code.lines), 'سطر كود', `${toAr(code.files)} ملفًا`),
  stat(toAr(rustTests), 'اختبار Rust', 'النواة الأصلية'),
  stat(toAr(e2eTests), 'اختبار Playwright', 'طبقة الويب'),
  stat(toAr(decisions.length), 'قرار مسجَّل', 'ADR'),
  stat(toAr(openProduct.length + openTech.length), 'مسألة مفتوحة', 'منتج وتقني'),
  stat(toAr(components), 'مكوّن واجهة', `${toAr(iconCount)} أيقونة`),
];

const li = (items, cls = '') => items.map((t) => `<li class="${cls}">${inline(t)}</li>`).join('\n');

function phaseCard(p) {
  const state = p.done ? 'done' : p === next ? 'next' : 'later';
  const label = p.done ? 'مكتملة' : p === next ? 'التالية' : 'لاحقًا';
  const mark = p.done ? icon(ICONS, 'check') : '';
  const shotsHere = gallery.filter((s) => s.phase === p.n);
  const test = selftests.find((s) => s.phase === p.n);

  return `
    <article class="phase ${state}" id="phase-${p.n}">
      <div class="spine" aria-hidden="true">
        <span class="node">${mark || toAr(p.n)}</span>
      </div>
      <div class="phase-body">
        <header class="phase-head">
          <div>
            <h3>${escIso(p.name)}</h3>
            <p class="slug">${esc(p.slug)}</p>
          </div>
          <span class="pill ${state}">${label}</span>
        </header>
        <p class="goal">${inline(p.goal)}</p>
        <div class="meta">
          <span>الاعتماديات: ${inline(p.deps || 'لا شيء')}</span>
          ${p.commit ? `<span class="mono">${esc(p.commit.hash)}</span><span class="mono">${esc(p.commit.date)}</span>` : ''}
        </div>
        ${
          p.adrs.length
            ? `<div class="adr-chips">${p.adrs
                .map((d) => `<a class="chip" href="#adr-${d.num}">قرار ${esc(d.short)}</a>`)
                .join('')}</div>`
            : ''
        }
        <details>
          <summary>معيار الاكتمال — ${toAr(p.criteria.length)} بنود</summary>
          <ul class="criteria ${state}">${li(p.criteria)}</ul>
        </details>
        <details>
          <summary>النطاق — ${toAr(p.scope.length)} بندًا</summary>
          <ul class="scope">${li(p.scope)}</ul>
        </details>
        ${
          test || shotsHere.length
            ? `<div class="evidence-strip">
                ${
                  test
                    ? `<span class="tag ok">${icon(ICONS, 'check')} فحص ذاتي ${toAr(test.passed)}/${toAr(
                        test.checks.length,
                      )}</span>`
                    : ''
                }
                ${shotsHere.length ? `<div class="thumbs" data-phase="${p.n}"></div>` : ''}
              </div>`
            : ''
        }
      </div>
    </article>`;
}

function issueRow(i) {
  return `
      <li class="issue">
        <span class="issue-n">${esc(i.id)}</span>
        <div>
          <p class="issue-t">${inline(i.text)}</p>
          ${i.note ? `<p class="issue-note">${inline(i.note)}</p>` : ''}
        </div>
      </li>`;
}

const swatchKeys = ['surface/paper', 'surface/canvas', 'surface/raised', 'text/primary', 'text/muted', 'accent/graphic', 'accent/text', 'border/subtle'];

const html = `<meta charset="utf-8">
<title>أين وصلت لوما</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Almarai:wght@400;700;800&family=Cairo:wght@400;500;600;700&display=swap">
<style>
  :root {
    ${themeVars(tokens.colors, 'paper')}
    --ui: "Cairo", "SF Arabic", system-ui, sans-serif;
    --display: "Almarai", "Cairo", serif;
    --sheet: 760px;
    --r-xs: ${tokens.radius.xs}px;
    --r-sm: ${tokens.radius.sm}px;
    --r-md: ${tokens.radius.md}px;
    --shadow: 0 1px 2px rgb(0 0 0 / .04), 0 8px 24px -16px rgb(0 0 0 / .18);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      ${themeVars(tokens.colors, 'midnight')}
      --shadow: 0 1px 2px rgb(0 0 0 / .3), 0 8px 24px -14px rgb(0 0 0 / .6);
    }
  }
  :root[data-theme="dark"] {
    ${themeVars(tokens.colors, 'midnight')}
    --shadow: 0 1px 2px rgb(0 0 0 / .3), 0 8px 24px -14px rgb(0 0 0 / .6);
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--canvas);
    color: var(--ink);
    font-family: var(--ui);
    font-size: 15px;
    line-height: 1.75;
    letter-spacing: 0;
    direction: rtl;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: var(--sheet); margin: 0 auto; padding: 0 24px 96px; }
  h1, h2, h3 { font-family: var(--display); font-weight: 700; text-wrap: balance; margin: 0; line-height: 1.4; }
  p { margin: 0; }
  code, .mono, .ltr, .slug { direction: ltr; unicode-bidi: isolate; }
  code, .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: .82em; letter-spacing: 0; }
  code { background: var(--sunken); border: 1px solid var(--line); border-radius: var(--r-xs); padding: .05em .35em; }
  s { color: var(--ink-3); }
  .ref { color: var(--accent-text); font-weight: 600; }
  b { font-weight: 700; }
  ::selection { background: var(--accent-sel); color: var(--ink); }
  :focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; border-radius: var(--r-xs); }
  .i { width: 1em; height: 1em; flex: none; vertical-align: -.12em; }

  /* ————— الترويسة ————— */
  .masthead { padding: 72px 0 40px; border-bottom: 1px solid var(--line); }
  .eyebrow {
    font-size: 12px; font-weight: 600; letter-spacing: .14em;
    color: var(--ink-3); text-transform: uppercase;
  }
  .wordmark { font-family: var(--display); font-weight: 800; font-size: clamp(44px, 9vw, 68px); line-height: 1.1; margin: 10px 0 6px; }
  .tagline { color: var(--ink-2); font-size: 17px; max-width: 46ch; }
  .built { margin-top: 18px; color: var(--ink-3); font-size: 13px; display: flex; flex-wrap: wrap; gap: 6px 14px; }

  /* ————— شريط المراحل ————— */
  .ladder { display: flex; gap: 4px; margin: 32px 0 24px; }
  .rung {
    flex: 1; height: 46px; border: 1px solid var(--line-strong); border-radius: var(--r-xs);
    background: var(--raised); color: var(--ink-3);
    font-family: var(--display); font-weight: 700; font-size: 15px;
    display: grid; place-items: center; cursor: pointer;
    transition: transform .15s ease, background .15s ease;
  }
  .rung:hover { transform: translateY(-2px); }
  .rung.done { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .rung.next { background: var(--accent-subtle); border-color: var(--accent-text); color: var(--accent-text); }
  .ladder-cap { display: flex; justify-content: space-between; color: var(--ink-3); font-size: 13px; }

  /* ————— الإحصاءات ————— */
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: var(--r-sm); overflow: hidden; margin-top: 28px; }
  .stat { background: var(--paper); padding: 16px 14px; }
  .stat-v { font-family: var(--display); font-weight: 800; font-size: 26px; line-height: 1.2; font-variant-numeric: tabular-nums; }
  .stat-l { font-size: 12px; color: var(--ink-2); margin-top: 2px; }
  .stat-s { font-size: 11px; color: var(--ink-3); }
  .frac { color: var(--ink-3); }

  /* ————— الأقسام ————— */
  section { padding-top: 64px; }
  .sec-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 6px; }
  .sec-head h2 { font-size: 26px; }
  .sec-head .count { color: var(--ink-3); font-size: 13px; font-variant-numeric: tabular-nums; }
  .sec-sub { color: var(--ink-2); font-size: 14px; margin-bottom: 24px; max-width: 62ch; }

  /* ————— بطاقة التالي ————— */
  .now {
    border: 1px solid var(--accent-text); border-radius: var(--r-md);
    background: var(--paper); box-shadow: var(--shadow); overflow: hidden;
  }
  .now-top { background: var(--accent-subtle); color: var(--accent-text); padding: 10px 20px; font-size: 12px; font-weight: 700; letter-spacing: .1em; display: flex; justify-content: space-between; }
  .now-body { padding: 22px 24px 24px; display: grid; gap: 14px; }
  .now-body h3 { font-size: 24px; }
  .now-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px 24px; }
  .now-grid ul { margin: 0; padding-inline-start: 1.1em; }
  .now-grid li { margin-bottom: 4px; }
  .col-t { font-size: 12px; font-weight: 700; color: var(--ink-3); letter-spacing: .08em; margin-bottom: 6px; }
  .later-row { display: flex; gap: 12px; align-items: center; padding: 14px 20px; border: 1px dashed var(--line-strong); border-radius: var(--r-sm); margin-top: 14px; color: var(--ink-2); font-size: 14px; }
  .later-row b { color: var(--ink); }

  /* ————— المراحل ————— */
  .phase { display: grid; grid-template-columns: 52px 1fr; gap: 0; }
  .spine { display: flex; flex-direction: column; align-items: center; }
  .node {
    width: 34px; height: 34px; border-radius: 999px; display: grid; place-items: center;
    font-family: var(--display); font-weight: 700; font-size: 14px;
    background: var(--raised); border: 1px solid var(--line-strong); color: var(--ink-3);
    margin-top: 22px; flex: none;
  }
  .phase.done .node { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .phase.done .node .i { width: 14px; height: 14px; }
  .phase.next .node { background: var(--paper); border: 2px solid var(--accent-text); color: var(--accent-text); }
  .spine::after { content: ""; flex: 1; width: 1px; background: var(--line-strong); margin: 8px 0; }
  .phase:last-of-type .spine::after { background: transparent; }
  .phase-body { padding: 18px 0 34px 0; min-width: 0; }
  .phase-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .phase-head h3 { font-size: 21px; }
  .slug { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: var(--ink-3); letter-spacing: .04em; }
  .pill { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 999px; flex: none; }
  .pill.done { background: var(--ok-bg); color: var(--ok); }
  .pill.next { background: var(--warn-bg); color: var(--warn); }
  .pill.later { background: var(--sunken); color: var(--ink-3); }
  .goal { margin-top: 8px; color: var(--ink-2); }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 10px; font-size: 12px; color: var(--ink-3); }
  .adr-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .chip { font-size: 12px; text-decoration: none; padding: 3px 10px; border-radius: var(--r-xs); border: 1px solid var(--line-strong); color: var(--accent-text); background: var(--paper); }
  .chip:hover { background: var(--accent-subtle); }

  details { margin-top: 12px; border-top: 1px solid var(--line); }
  summary { cursor: pointer; padding: 9px 0; font-size: 13px; font-weight: 600; color: var(--ink-2); list-style: none; display: flex; align-items: center; gap: 8px; }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: "+"; font-family: ui-monospace, monospace; color: var(--accent-text); font-weight: 700; }
  details[open] summary::before { content: "−"; }
  details ul { margin: 2px 0 16px; padding-inline-start: 0; list-style: none; display: grid; gap: 7px; }
  details li { position: relative; padding-inline-start: 22px; font-size: 14px; color: var(--ink-2); }
  details li::before { content: ""; position: absolute; inset-inline-start: 6px; top: .62em; width: 5px; height: 5px; border-radius: 999px; background: var(--line-control); }
  .criteria.done li::before { background: var(--ok); }
  .criteria.next li::before { background: var(--warn); }

  .evidence-strip { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 14px; }
  .tag { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: var(--r-xs); }
  .tag.ok { background: var(--ok-bg); color: var(--ok); }
  .thumbs { display: flex; gap: 6px; flex-wrap: wrap; }
  .thumb { width: 74px; height: 46px; border-radius: var(--r-xs); border: 1px solid var(--line-strong); overflow: hidden; padding: 0; background: var(--sunken); cursor: zoom-in; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }

  /* ————— المسائل ————— */
  .issues { display: grid; gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: var(--r-sm); overflow: hidden; list-style: none; padding: 0; margin: 0; }
  .issue { display: grid; grid-template-columns: 42px 1fr; gap: 12px; background: var(--paper); padding: 14px 16px; }
  .issue-n { font-family: var(--display); font-weight: 700; color: var(--warn); font-size: 15px; }
  .issue-t { font-size: 14px; }
  .issue-note { font-size: 12.5px; color: var(--ink-3); margin-top: 3px; }
  .resolved-note { margin-top: 14px; font-size: 13px; color: var(--ink-3); display: flex; align-items: center; gap: 8px; }

  /* ————— القرارات ————— */
  .adrs { display: grid; gap: 10px; }
  .adr { border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--paper); padding: 16px 18px; display: grid; grid-template-columns: 46px 1fr; gap: 14px; }
  .adr-n { font-family: var(--display); font-weight: 800; font-size: 18px; color: var(--accent-text); }
  .adr h4 { margin: 0; font-size: 16px; font-family: var(--display); }
  .adr p { font-size: 13.5px; color: var(--ink-2); margin-top: 5px; }
  .adr-meta { font-size: 11.5px; color: var(--ink-3); margin-top: 8px; display: flex; gap: 12px; flex-wrap: wrap; }

  /* ————— المعرض ————— */
  .filters { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
  .filter { font-size: 12.5px; font-weight: 600; padding: 5px 12px; border-radius: 999px; border: 1px solid var(--line-strong); background: var(--paper); color: var(--ink-2); cursor: pointer; font-family: var(--ui); }
  .filter[aria-pressed="true"] { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
  .shot { border: 1px solid var(--line); border-radius: var(--r-sm); overflow: hidden; background: var(--paper); padding: 0; text-align: start; cursor: zoom-in; font-family: var(--ui); }
  .shot img { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; display: block; background: var(--sunken); }
  .shot figcaption { padding: 9px 11px; font-size: 12.5px; color: var(--ink-2); border-top: 1px solid var(--line); }

  /* ————— الفحص الذاتي ————— */
  .checks { display: grid; gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: var(--r-sm); overflow: hidden; }
  .check { background: var(--paper); padding: 11px 14px; display: grid; grid-template-columns: 20px 1fr; gap: 10px; align-items: start; }
  .check .i { color: var(--ok); width: 14px; height: 14px; margin-top: .35em; }
  .check-n { font-size: 13.5px; font-weight: 600; }
  .check-d { font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
  .runs { display: flex; align-items: flex-end; gap: 8px; height: 88px; margin-bottom: 18px; }
  .run { flex: 1; display: grid; gap: 5px; justify-items: center; }
  .run-bar { width: 100%; background: var(--accent); border-radius: var(--r-xs) var(--r-xs) 0 0; }
  .run-l { font-size: 12px; color: var(--ink-2); font-weight: 600; }
  .run-p { font-size: 10.5px; color: var(--ink-3); }

  /* ————— الثيمات ————— */
  .themes { display: grid; gap: 8px; }
  .theme-row { display: grid; grid-template-columns: 132px 1fr; gap: 12px; align-items: center; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--paper); padding: 10px 14px; }
  .theme-name { font-size: 13.5px; font-weight: 600; }
  .sw { display: flex; gap: 4px; }
  .sw span { width: 100%; height: 26px; border-radius: var(--r-xs); border: 1px solid var(--line); }

  /* ————— البنية ————— */
  .map { display: grid; gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: var(--r-sm); overflow: hidden; }
  .map-row { background: var(--paper); padding: 11px 14px; display: grid; grid-template-columns: 190px 1fr; gap: 12px; font-size: 13.5px; }
  .map-row span:first-child { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: var(--accent-text); direction: ltr; unicode-bidi: isolate; text-align: start; }
  .map-row span:last-child { color: var(--ink-2); }
  .cmds { display: grid; gap: 8px; margin-top: 16px; }
  .cmd { display: grid; grid-template-columns: 190px 1fr; gap: 12px; align-items: baseline; font-size: 13.5px; }
  .cmd code { background: var(--sunken); }
  .cmd span { color: var(--ink-2); }

  .out { display: grid; gap: 8px; }
  .out-row { border: 1px solid var(--line); border-radius: var(--r-sm); padding: 12px 15px; background: var(--paper); }
  .out-row .col-t { margin-bottom: 4px; }
  .out-row p { font-size: 13.5px; color: var(--ink-2); }

  footer { margin-top: 72px; padding-top: 22px; border-top: 1px solid var(--line); color: var(--ink-3); font-size: 12.5px; display: grid; gap: 6px; }

  /* ————— العدسة ————— */
  dialog { border: none; background: transparent; padding: 0; max-width: 96vw; max-height: 96vh; }
  dialog::backdrop { background: rgb(10 10 12 / .82); }
  dialog img { max-width: 92vw; max-height: 82vh; border-radius: var(--r-sm); display: block; box-shadow: 0 24px 70px -20px rgb(0 0 0 / .7); }
  .lens-cap { color: #f2efe9; text-align: center; font-size: 13px; margin-top: 12px; font-family: var(--ui); }

  @media (max-width: 620px) {
    .phase { grid-template-columns: 38px 1fr; }
    .now-grid, .map-row, .cmd, .theme-row { grid-template-columns: 1fr; }
    .stats { grid-template-columns: repeat(2, 1fr); }
    .ladder { flex-wrap: wrap; }
    .rung { min-width: 40px; }
  }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>

<div class="wrap">

  <header class="masthead">
    <p class="eyebrow">حالة المشروع — ${ltr(builtAt)}</p>
    <h1 class="wordmark">لوما</h1>
    <p class="tagline">محرر كتابة هادئ للكاتب العربي على macOS. «افتح واكتب، والباقي يختفي.»</p>
    <div class="built">
      <span>الإصدار ${ltr(pkg.version)}</span>
      <span>آخر التزام: <span class="mono">${esc(head.hash)}</span> — ${inline(head.subject)}</span>
      <span>${ltr(head.date)}</span>
    </div>

    <div class="ladder" role="group" aria-label="المراحل الثماني">
      ${phases
        .map(
          (p) =>
            `<button class="rung ${p.done ? 'done' : p === next ? 'next' : ''}" data-go="phase-${p.n}" title="${escIso(
              p.name,
            )}">${toAr(p.n)}</button>`,
        )
        .join('\n      ')}
    </div>
    <div class="ladder-cap">
      <span>${toAr(doneCount)} مراحل مكتملة من ${toAr(phases.length)}</span>
      <span>${next ? `التالية: ${escIso(next.name)}` : 'كل المراحل مكتملة'}</span>
    </div>

    <div class="stats">
      ${tiles.join('\n      ')}
    </div>
  </header>

  ${
    next
      ? `<section id="next">
    <div class="sec-head"><h2>ما تبقّى</h2><span class="count">مرحلتان</span></div>
    <p class="sec-sub">المرحلة التالية بنطاقها ومعيار اكتمالها كما هما في <code>PLAN.md</code> — لا تُعلَن مكتملة قبل تجربتها داخل <code>Luma.app</code> مبنية.</p>
    <article class="now">
      <div class="now-top"><span>المرحلة ${toAr(next.n)} — التالية</span><span class="mono">${esc(next.slug)}</span></div>
      <div class="now-body">
        <h3>${escIso(next.name)}</h3>
        <p>${inline(next.goal)}</p>
        <div class="now-grid">
          <div>
            <p class="col-t">معيار الاكتمال</p>
            <ul>${next.criteria.map((c) => `<li>${inline(c)}</li>`).join('')}</ul>
          </div>
          <div>
            <p class="col-t">أبرز النطاق</p>
            <ul>${next.scope.slice(0, 7).map((c) => `<li>${inline(c)}</li>`).join('')}</ul>
          </div>
        </div>
      </div>
    </article>
    ${after
      .map(
        (p) => `<div class="later-row">
      ${icon(ICONS, 'back')}
      <span>ثم <b>المرحلة ${toAr(p.n)} — ${escIso(p.name)}</b>: ${inline(p.goal)}</span>
    </div>`,
      )
      .join('')}
  </section>`
      : ''
  }

  <section id="phases">
    <div class="sec-head"><h2>المراحل</h2><span class="count">${toAr(phases.length)} مراحل</span></div>
    <p class="sec-sub">لكل مرحلة رقم واسم ثابتان. الاكتمال هنا مشتقّ من التزام موجود في السجل، لا من علامة تُوضع يدويًا.</p>
    ${phases.map(phaseCard).join('\n')}
  </section>

  ${
    latest
      ? `<section id="selftest">
    <div class="sec-head"><h2>الفحص داخل التطبيق</h2><span class="count">${toAr(latest.passed)} من ${toAr(latest.checks.length)}</span></div>
    <p class="sec-sub">لا WebDriver لـWKWebView على macOS، فالفحص يجري داخل <code>Luma.app</code> نفسها ويكتب تقريره. هذا آخر تقرير — ونموّه عبر المراحل أدناه.</p>
    <div class="runs">
      ${selftests
        .map((s) => {
          const max = Math.max(...selftests.map((x) => x.checks.length));
          const h = Math.round((s.checks.length / max) * 46) + 6;
          return `<div class="run"><div class="run-bar" style="height:${h}px"></div><div class="run-l">${toAr(
            s.checks.length,
          )}</div><div class="run-p">م${toAr(s.phase)}</div></div>`;
        })
        .join('')}
    </div>
    <div class="checks">
      ${latest.checks
        .map(
          (c) => `<div class="check">
        ${icon(ICONS, c.passed ? 'check' : 'error')}
        <div>
          <p class="check-n">${escIso(c.name)}</p>
          <p class="check-d">${escIso(c.detail || '')}</p>
        </div>
      </div>`,
        )
        .join('')}
    </div>
  </section>`
      : ''
  }

  ${
    gallery.length
      ? `<section id="evidence">
    <div class="sec-head"><h2>الأدلة</h2><span class="count">${toAr(gallery.length)} لقطة</span></div>
    <p class="sec-sub">لقطات مُلتقطة داخل التطبيق المبني عند كل مرحلة. انقر أي لقطة لتكبيرها.</p>
    <div class="filters" id="filters"></div>
    <div class="grid" id="gallery"></div>
  </section>`
      : ''
  }

  <section id="decisions">
    <div class="sec-head"><h2>القرارات</h2><span class="count">${toAr(decisions.length)} قرارات</span></div>
    <p class="sec-sub">كل مسألة حُسمت لها ملف واحد في <code>docs/decisions/</code> فيه القرار وسياقه والبدائل المرفوضة.</p>
    <div class="adrs">
      ${decisions
        .map(
          (d) => `<article class="adr" id="adr-${esc(d.num)}">
        <div class="adr-n">${esc(d.short)}</div>
        <div>
          <h4>${escIso(d.title)}</h4>
          <p>${inline(d.summary)}</p>
          <div class="adr-meta">
            <span>${escIso(d.state)}</span>
            ${d.phase ? `<span>المرحلة ${toAr(d.phase)}</span>` : ''}
            <span class="mono">${esc(d.file)}</span>
          </div>
        </div>
      </article>`,
        )
        .join('')}
    </div>
  </section>

  <section id="open">
    <div class="sec-head"><h2>المسائل المفتوحة</h2><span class="count">${toAr(openProduct.length + openTech.length)} مسألة</span></div>
    <p class="sec-sub">مسائل تغيّر سلوكًا يراه المستخدم أو تحتاج قياسًا. لا تُملأ بافتراض صامت.</p>

    <p class="col-t" style="margin-bottom:8px">منتج — <code>Luma.md</code> §٢٠</p>
    <ul class="issues">${openProduct.map(issueRow).join('')}</ul>
    <p class="resolved-note">${icon(ICONS, 'check')} حُسمت ${toAr(
      productIssues.length - openProduct.length,
    )} مسائل بقرارات مسجَّلة.</p>

    <p class="col-t" style="margin:26px 0 8px">تقني — <code>IMPLEMENTATION.md</code> §١٨</p>
    <ul class="issues">${openTech.map(issueRow).join('')}</ul>
    <p class="resolved-note">${icon(ICONS, 'check')} حُسمت ${toAr(
      techIssues.length - openTech.length,
    )} مسائل بقرارات مسجَّلة.</p>
  </section>

  <section id="themes">
    <div class="sec-head"><h2>الثيمات</h2><span class="count">${toAr(tokens.themes.length)} أوضاع</span></div>
    <p class="sec-sub">${toAr(Object.keys(tokens.colors).length)} لونًا في ${toAr(
      tokens.themes.length,
    )} أوضاع، مصدرها <code>src/tokens/source.json</code> — وهي ألوان هذه الصفحة نفسها.</p>
    <div class="themes">
      ${tokens.themes
        .map(
          (t) => `<div class="theme-row">
        <span class="theme-name">${escIso(t.name)}</span>
        <div class="sw">${swatchKeys
          .map((k) => `<span style="background:${tokens.colors[k][t.id]}" title="${esc(k)}"></span>`)
          .join('')}</div>
      </div>`,
        )
        .join('')}
    </div>
  </section>

  <section id="stack">
    <div class="sec-head"><h2>البنية</h2><span class="count">${toAr(code.files)} ملفًا — ${toAr(code.lines)} سطرًا</span></div>
    <p class="sec-sub">Tauri 2 — نواة Rust وWKWebView — مع Vite وSvelte 5 وTypeScript وProseMirror.</p>
    <div class="map">
      <div class="map-row"><span>src/editor/</span><span>نواة المحرر — لا تحفظ ولا تعرف المكتبة</span></div>
      <div class="map-row"><span>src/lib/</span><span>الحفظ والجلسة والاتجاه والمكتبة والأسطح والتفضيلات والآلة الكاتبة والخطوط</span></div>
      <div class="map-row"><span>src/components/</span><span>مكتبة المكونات والأيقونات — و<code>EditorShell</code> إطار كل شاشة</span></div>
      <div class="map-row"><span>src/tokens/</span><span>مولَّد: <code>source.json</code> ← <code>tokens.css</code> و<code>themes.ts</code></span></div>
      <div class="map-row"><span>src-tauri/</span><span>النواة الأصلية — التخزين والنافذة والقائمة والأوامر</span></div>
      <div class="map-row"><span>tests/</span><span>وحدات وحارس حدود و<code>e2e/</code> لـPlaywright</span></div>
      <div class="map-row"><span>docs/</span><span>الخريطة والقرارات والأدلة وبطارية العربية</span></div>
    </div>
    <div class="cmds">
      <div class="cmd"><code>npm run app</code><span>تشغيل التطبيق للتطوير</span></div>
      <div class="cmd"><code>npm run app:build</code><span>بناء <code>Luma.app</code></span></div>
      <div class="cmd"><code>npm run verify</code><span>فحص الأنواع وclippy والاختبارات</span></div>
      <div class="cmd"><code>LUMA_SELFTEST=1</code><span>الفحص داخل التطبيق المبني</span></div>
      <div class="cmd"><code>npm run site</code><span>إعادة توليد هذه الصفحة</span></div>
    </div>
  </section>

  <section id="outside">
    <div class="sec-head"><h2>خارج النطاق</h2></div>
    <p class="sec-sub">مكتوب هنا لأن أخطر ما يهدد الخطة ليس نقص العمل بل توسّعه.</p>
    <div class="out">
      <div class="out-row">
        <p class="col-t">مؤجَّل إلى ما بعد الإطلاق</p>
        <p>مساحة الأفكار — الإملاء الصوتي — الأصوات الثلاثة — البحث في المكتبة — الواجهة الإنجليزية. بنيتها في التصميم ونقاط ارتباطها محجوزة، ولا يُبنى منها شيء قبل الإطلاق.</p>
      </div>
      <div class="out-row">
        <p class="col-t">مستبعد من فكرة المنتج</p>
        <p>محرر مستندات كثيف — لوحة إنتاجية — المكتبة كشاشة رئيسية — تنسيق غني — حفظ يدوي — الضغط الإنتاجي.</p>
      </div>
      <div class="out-row">
        <p class="col-t">غير معتمد في النطاق الحالي</p>
        <p>ذكاء اصطناعي للكتابة — تعاون لحظي — حسابات — نشر — وسوم ومجلدات — مزامنة سحابية — تصدير PDF — أهداف كلمات وإحصاءات جلسات.</p>
      </div>
    </div>
  </section>

  <footer>
    <p>هذه الصفحة مولَّدة من المستودع بـ<code>npm run site</code>، ولا تُحرَّر يدويًا.</p>
    <p>مصادرها: <code>PLAN.md</code> — <code>Luma.md</code> §٢٠ — <code>IMPLEMENTATION.md</code> §١٨ — <code>docs/decisions/</code> — <code>docs/evidence/</code> — <code>src/tokens/source.json</code> — سجل git.</p>
    <p>بُنيت في ${esc(builtAt)} على الالتزام <span class="mono">${esc(head.hash)}</span>.</p>
  </footer>
</div>

<dialog id="lens">
  <form method="dialog"><button style="position:absolute;inset:0;width:100%;height:100%;opacity:0;border:0;cursor:zoom-out" aria-label="إغلاق"></button></form>
  <img id="lens-img" alt="">
  <p class="lens-cap" id="lens-cap"></p>
</dialog>

<script>
  const SHOTS = ${JSON.stringify(gallery.map((s) => ({ id: s.id, phase: s.phase, cap: s.cap, src: s.src })))};

  document.querySelectorAll("[data-go]").forEach(function (b) {
    b.addEventListener("click", function () {
      var el = document.getElementById(b.dataset.go);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  var lens = document.getElementById("lens");
  var lensImg = document.getElementById("lens-img");
  var lensCap = document.getElementById("lens-cap");
  function open(shot) {
    lensImg.src = shot.src;
    lensImg.alt = shot.cap;
    lensCap.textContent = shot.cap;
    lens.showModal();
  }

  var gallery = document.getElementById("gallery");
  if (gallery) {
    var phases = [];
    SHOTS.forEach(function (s) { if (phases.indexOf(s.phase) < 0) phases.push(s.phase); });
    phases.sort(function (a, b) { return a - b; });
    var ar = "٠١٢٣٤٥٦٧٨٩";
    var toAr = function (n) { return String(n).replace(/[0-9]/g, function (d) { return ar[+d]; }); };

    var filters = document.getElementById("filters");
    var all = [{ v: 0, l: "الكل" }].concat(phases.map(function (p) { return { v: p, l: "المرحلة " + toAr(p) }; }));
    all.forEach(function (f) {
      var b = document.createElement("button");
      b.className = "filter";
      b.textContent = f.l;
      b.setAttribute("aria-pressed", f.v === 0 ? "true" : "false");
      b.addEventListener("click", function () {
        filters.querySelectorAll(".filter").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
        render(f.v);
      });
      filters.appendChild(b);
    });

    function render(phase) {
      gallery.innerHTML = "";
      SHOTS.filter(function (s) { return !phase || s.phase === phase; }).forEach(function (s) {
        var fig = document.createElement("figure");
        fig.className = "shot";
        fig.style.margin = "0";
        var img = document.createElement("img");
        img.src = s.src;
        img.alt = s.cap;
        img.loading = "lazy";
        var cap = document.createElement("figcaption");
        cap.textContent = s.cap;
        fig.appendChild(img);
        fig.appendChild(cap);
        fig.tabIndex = 0;
        fig.addEventListener("click", function () { open(s); });
        fig.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(s); } });
        gallery.appendChild(fig);
      });
    }
    render(0);
  }

  document.querySelectorAll(".thumbs").forEach(function (box) {
    var p = Number(box.dataset.phase);
    SHOTS.filter(function (s) { return s.phase === p; }).forEach(function (s) {
      var b = document.createElement("button");
      b.className = "thumb";
      b.title = s.cap;
      b.setAttribute("aria-label", s.cap);
      var img = document.createElement("img");
      img.src = s.src;
      img.alt = "";
      img.loading = "lazy";
      b.appendChild(img);
      b.addEventListener("click", function () { open(s); });
      box.appendChild(b);
    });
  });
</script>
`;

const outPath = join(HERE, 'index.html');
writeFileSync(outPath, isoHtml(html), 'utf8');

const kb = Math.round(Buffer.byteLength(html) / 1024);
console.log(`✓ docs/site/index.html — ${kb}KB`);
console.log(
  `  ${doneCount}/${phases.length} مراحل · ${decisions.length} قرارًا · ${gallery.length} لقطة · ` +
    `${openProduct.length + openTech.length} مسألة مفتوحة` +
    (units ? ` · ${units.passed} اختبار وحدة` : ''),
);
