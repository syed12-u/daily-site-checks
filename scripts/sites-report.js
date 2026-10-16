#!/usr/bin/env node
// Consolidated all-sites report: latest run per site, trend across every run in runs/,
// open site bugs and what is monitored. Writes reports/sites-report-<date>.html.
//
//   node scripts/sites-report.js
const fs = require('fs');
const path = require('path');
const { sites } = require('../config/sites');
const { NAMES } = require('../src/lib/severity');
const { errorSummary } = require('../src/lib/results');

const ROOT = path.resolve(__dirname, '..');
const RUNS = path.join(ROOT, 'runs');
const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const runs = fs
  .readdirSync(RUNS)
  .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && fs.existsSync(path.join(RUNS, d, 'summary.json')))
  .sort()
  .map((d) => ({
    date: d,
    summary: JSON.parse(fs.readFileSync(path.join(RUNS, d, 'summary.json'), 'utf8')),
    results: fs.existsSync(path.join(RUNS, d, 'results.json')) ? JSON.parse(fs.readFileSync(path.join(RUNS, d, 'results.json'), 'utf8')).results : [],
  }));
if (!runs.length) {
  console.error('no completed runs in runs/');
  process.exit(1);
}
const latest = runs[runs.length - 1];

// Open bugs on the sites (confirmed by hand; see bugs/BUG-REPORT.md).
const BUGS = {
  perhaps: [{ sev: 'Low', id: 'ER-06', text: 'Strict-Transport-Security and X-Content-Type-Options headers missing.' }],
  flexoffers: [
    { sev: 'Medium', id: 'ER-01', text: 'Uncaught JavaScript error "wp is not defined" on all 10 monitored pages (inline script wp-i18n-js-after runs before wp-i18n loads).' },
    { sev: 'Medium', id: 'ER-05', text: '/advertisers/ has no H1 heading; the page title is an H2.' },
    { sev: 'Medium', id: 'AV-08', text: '3 of 3,972 sitemap URLs broken: /affiliate-programs/100%-pure-affiliate-program/ (400), /affiliate-programs/linksys-affiliate-program/ (404), /affiliate-programs/bionatrol-llc-affiliate-program/ (no response).' },
    { sev: 'Low', id: 'ER-06', text: 'Strict-Transport-Security header missing.' },
    { sev: 'Resolved', id: 'FN-05', text: 'Searching "affiliate" returned HTTP 500 "critical error" on 13 Oct; working again since the same day.' },
  ],
  fusetwo: [
    { sev: 'Medium', id: 'ER-01', text: "Uncaught JavaScript error \"Cannot read properties of null (reading 'offsetHeight')\" on 9 pages." },
    { sev: 'Low', id: 'ER-06', text: 'Strict-Transport-Security, X-Content-Type-Options and frame protection headers missing.' },
  ],
  incubators: [
    { sev: 'Medium', id: 'ER-05', text: '/contact-us/ has no H1 heading.' },
    { sev: 'Low', id: 'ER-06', text: 'Strict-Transport-Security, X-Content-Type-Options and frame protection headers missing.' },
  ],
};

const SEV_CLASS = { High: 'crit', Medium: 'warn', Low: 'low', Resolved: 'ok' };
const statusPill = (st) => {
  const map = { ok: ['ok', 'All green'], low: ['low', 'Low issues'], medium: ['warn', 'Medium issues'], high: ['crit', 'High issues'], critical: ['crit', 'Critical'] };
  const [c, t] = map[st] || ['low', st];
  return `<span class="pill ${c}">${t}</span>`;
};

function sparkline(values, w = 220, h = 44) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return '';
  const min = Math.min(...v) * 0.9;
  const max = Math.max(...v) * 1.05;
  const x = (i) => 6 + (i * (w - 12)) / (values.length - 1);
  const y = (val) => h - 6 - ((val - min) / (max - min || 1)) * (h - 12);
  const pts = values.map((val, i) => (val == null ? null : `${x(i).toFixed(1)},${y(val).toFixed(1)}`)).filter(Boolean);
  const last = values[values.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="trend"><polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${pts.join(' ')}"/>${last != null ? `<circle cx="${x(values.length - 1)}" cy="${y(last)}" r="3.5" fill="var(--accent)"/>` : ''}</svg>`;
}

let siteSections = '';
let overviewRows = '';
for (const site of Object.values(sites)) {
  const row = latest.summary.rows.find((r) => r.key === site.key);
  if (!row) continue;
  const history = runs.map((r) => {
    const x = r.summary.rows.find((y) => y.key === site.key);
    return x ? { date: r.date, passed: x.passed, total: x.total, resp: x.responseMs } : { date: r.date };
  });
  const passPct = history.map((h) => (h.total ? Math.round((h.passed / h.total) * 100) : null));
  const resp = history.map((h) => h.resp || null);
  const bugs = BUGS[site.key] || [];
  const openBugs = bugs.filter((b) => b.sev !== 'Resolved').length;

  overviewRows += `<tr><td><b>${esc(site.domain)}</b></td><td>${statusPill(row.status)}</td><td class="num">${row.passed}/${row.total}</td><td class="num">${row.responseMs ?? '–'} ms</td><td class="num">${openBugs}</td><td class="num">${site.pages.length}</td></tr>`;

  const failures = row.failures
    .map((f) => {
      const r = latest.results.find((x) => x.site === site.key && x.scenario === f.scenario && x.project === f.project);
      const why = r && r.error ? errorSummary(r.error, 220) : f.summary;
      return `<tr><td><code>${f.scenario}</code> ${esc(NAMES[f.scenario] || f.name)}</td><td>${f.project}</td><td><span class="pill ${f.severity === 'critical' || f.severity === 'high' ? 'crit' : f.severity === 'medium' ? 'warn' : 'low'}">${f.severity}</span></td><td class="reason">${esc(why)}</td></tr>`;
    })
    .join('');

  const extras = [
    site.contact ? 'contact form' : null,
    site.search ? 'search' : null,
    site.login ? 'login' : null,
    site.signup ? 'publisher and advertiser signup' : null,
    site.embeds && site.embeds.length ? site.embeds.map((e) => e.name.split(' ')[0]).join(' and ') + ' embeds' : null,
  ].filter(Boolean);

  siteSections += `
  <section class="site" id="${site.key}">
    <div class="site-head">
      <div><h2>${esc(site.domain)}</h2><p class="muted">${esc(site.baseUrl)} · ${site.pages.length} key pages${extras.length ? ' · ' + extras.join(', ') : ''}</p></div>
      ${statusPill(row.status)}
    </div>
    <div class="grid3">
      <div class="card"><div class="lbl">Checks passed (${latest.date})</div><div class="big">${row.passed}<span class="of">/${row.total}</span></div><div class="lbl">Pass rate by run</div>${sparkline(passPct)}<div class="axis">${esc(history[0].date)} → ${esc(history[history.length - 1].date)}</div></div>
      <div class="card"><div class="lbl">Homepage response</div><div class="big">${row.responseMs ?? '–'}<span class="of"> ms</span></div><div class="lbl">By run</div>${sparkline(resp)}<div class="axis">${resp.filter(Boolean).map((v) => v + ' ms').join(' · ')}</div></div>
      <div class="card"><div class="lbl">Open site bugs</div><div class="big">${openBugs}</div><ul class="bugs">${bugs.map((b) => `<li><span class="pill ${SEV_CLASS[b.sev]}">${b.sev}</span> <code>${b.id}</code> ${esc(b.text)}</li>`).join('')}</ul></div>
    </div>
    <details ${row.failures.length ? 'open' : ''}><summary>Failed checks in the latest run (${row.failures.length})</summary>
      ${row.failures.length ? `<div class="tablewrap"><table><thead><tr><th>Check</th><th>Viewport</th><th>Severity</th><th>Reason</th></tr></thead><tbody>${failures}</tbody></table></div>` : '<p>None.</p>'}
    </details>
    <details><summary>Pages under watch (${site.pages.length})</summary><p class="pages">${site.pages.map((p) => `<code>${esc(p.path)}</code>`).join(' ')}</p></details>
  </section>`;
}

const trendRows = runs
  .map((r) => `<tr><td>${r.date}</td>${Object.values(sites).map((s) => { const x = r.summary.rows.find((y) => y.key === s.key); return `<td class="num">${x ? x.passed + '/' + x.total : '–'}</td>`; }).join('')}<td class="num"><b>${r.summary.passed}/${r.summary.total}</b></td></tr>`)
  .join('');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>All Sites Monitoring Report</title>
<style>
:root{--bg:#f5f7f7;--surface:#fff;--fg:#14222a;--muted:#5a6b73;--line:#d8e1e3;--accent:#0f766e;--ok:#1a7f4b;--ok-s:#dcf3e6;--warn:#a86400;--warn-s:#fbeedb;--crit:#b42318;--crit-s:#fde3e0;--low:#2a5db0;--low-s:#e0e9f8}
@media (prefers-color-scheme:dark){:root{--bg:#0f1a1e;--surface:#15242a;--fg:#e6eef0;--muted:#94a7ae;--line:#27393f;--accent:#3fb8ac;--ok:#4cc77f;--ok-s:#173627;--warn:#e5a23c;--warn-s:#3b2c12;--crit:#f0776b;--crit-s:#3d1c19;--low:#7aa6ea;--low-s:#1b2d4a}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 "Segoe UI",Arial,sans-serif}
main{max-width:1080px;margin:0 auto;padding:28px 20px 60px}
h1{font-size:30px;margin:4px 0}h2{font-size:21px;margin:0}h3{font-size:16px}
.muted{color:var(--muted)}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);font-weight:600}
table{border-collapse:collapse;width:100%;background:var(--surface);font-size:14px}th,td{padding:9px 11px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}td.num{text-align:right;font-variant-numeric:tabular-nums}td.reason{font-size:13px;color:var(--muted)}
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.pill.ok{background:var(--ok-s);color:var(--ok)}.pill.warn{background:var(--warn-s);color:var(--warn)}.pill.crit{background:var(--crit-s);color:var(--crit)}.pill.low{background:var(--low-s);color:var(--low)}
section{margin-top:30px}.site{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px 20px}
.site-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:14px}
.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
.card{border:1px solid var(--line);border-radius:10px;padding:12px 14px;min-width:0}
.lbl{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}.big{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums;margin:2px 0 8px}.of{font-size:16px;color:var(--muted);font-weight:500}
.axis{font-size:11px;color:var(--muted)}
ul.bugs{list-style:none;margin:0;padding:0;display:grid;gap:8px;font-size:13px}
details{margin-top:12px}summary{cursor:pointer;font-weight:600}.pages{line-height:2}
code{font-family:Consolas,monospace;font-size:12.5px;background:var(--bg);padding:1px 5px;border-radius:4px}
nav{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}nav a{color:var(--accent);text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:3px 12px;background:var(--surface)}
footer{margin-top:40px;font-size:13px;color:var(--muted)}
</style></head><body><main>
<p class="eyebrow">Website monitoring · all sites · latest run ${latest.date}</p>
<h1>All Sites Monitoring Report</h1>
<p class="muted">43 automated checks per site, desktop 1440×900 and mobile 390×844, run with two retries. ${runs.length} runs between ${runs[0].date} and ${latest.date}.</p>
<nav>${Object.values(sites).map((s) => `<a href="#${s.key}">${esc(s.domain)}</a>`).join('')}</nav>

<section><h3>Overview, ${latest.date}</h3><div class="tablewrap"><table><thead><tr><th>Site</th><th>Status</th><th>Checks passed</th><th>Homepage response</th><th>Open bugs</th><th>Pages watched</th></tr></thead><tbody>${overviewRows}</tbody></table></div>
<p class="muted">${latest.summary.passed} of ${latest.summary.total} checks passed overall; ${latest.summary.skipped} skipped (not configured for a site, or desktop-only on the mobile viewport).</p></section>

${siteSections}

<section><h3>Checks passed per run</h3><div class="tablewrap"><table><thead><tr><th>Run</th>${Object.values(sites).map((s) => `<th>${esc(s.domain)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${trendRows}</tbody></table></div>
<p class="muted">5–9 Oct include selector tuning and laptop sleep interruptions; 13 Oct onwards uses the tuned suite. Visual differences on 14 Oct come from content edits on the sites (perhaps.com services copy, flexoffers.com directory and ranking lists).</p></section>

<footer>Generated ${new Date().toLocaleString('en-GB')} from runs/ in the daily-site-checks repo. Bug details and screenshots: bugs/BUG-REPORT.md.</footer>
</main></body></html>`;

fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
const out = path.join(ROOT, 'reports', `sites-report-${latest.date}.html`);
fs.writeFileSync(out, html);
console.log(out);
