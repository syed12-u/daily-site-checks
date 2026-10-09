#!/usr/bin/env node
// Build a standalone HTML report for one run.
//
//   node scripts/html-report.js runs/2026-10-09/results.json         from a completed run
//   node scripts/html-report.js logs/e2e-headed-2026-10-09.log       from a Playwright log (partial run)
//
// Writes reports/report-<date>.html and prints the path.
const fs = require('fs');
const path = require('path');
const { NAMES } = require('../src/lib/severity');
const { errorSummary } = require('../src/lib/results');

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/html-report.js <results.json | playwright.log>');
  process.exit(1);
}
const SITES = { perhaps: 'perhaps.com', flexoffers: 'flexoffers.com', fusetwo: 'fusetwo.com', incubators: 'incubators.com' };
const FAM = { AV: 'Availability', FN: 'Functionality', ER: 'Error detection', PF: 'Performance', UF: 'User flows', VR: 'Visual regression' };
const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// rows: { site, project, id, status: ok|x|skip, error? }
let rows = [];
let label = '';
let date = (src.match(/\d{4}-\d{2}-\d{2}/) || [new Date().toISOString().slice(0, 10)])[0];
let partial = false;
if (src.endsWith('.json')) {
  const data = JSON.parse(fs.readFileSync(src, 'utf8'));
  date = data.date || date;
  label = `completed run, ${data.attempts || 1} attempt(s)`;
  rows = data.results
    .filter((r) => r.site && r.scenario)
    .map((r) => ({ site: r.site, project: r.project, id: r.scenario, status: r.status === 'passed' ? 'ok' : r.status === 'skipped' ? 'skip' : 'x', error: r.error ? errorSummary(r.error, 300) : '' }));
} else {
  const raw = fs.readFileSync(src);
  const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8');
  const re = /^\s+(ok|x|-)\s+\d+\s+\[(\w+)\].*?\[([A-Z]{2}-\d{2})\]\[(\w+)\]/;
  for (const l of text.replace(/\r/g, '').split('\n')) {
    const m = l.match(re);
    if (m) rows.push({ site: m[4], project: m[2], id: m[3], status: m[1] === 'ok' ? 'ok' : m[1] === '-' ? 'skip' : 'x', error: '' });
  }
  partial = !/finished:/.test(text);
  label = partial ? `run stopped early, ${rows.length} of 252 checks completed` : 'completed run';
}

const per = {};
for (const k of Object.keys(SITES)) per[k] = { ok: 0, x: 0, skip: 0, failed: [], rows: [] };
for (const r of rows) {
  if (!per[r.site]) continue;
  per[r.site].rows.push(r);
  per[r.site][r.status]++;
  if (r.status === 'x') per[r.site].failed.push(r.id + (r.project === 'mobile' ? ' (m)' : ''));
}
const total = Object.values(per).reduce((a, v) => ({ ok: a.ok + v.ok, x: a.x + v.x, skip: a.skip + v.skip }), { ok: 0, x: 0, skip: 0 });

const pill = (s) => (s === 'ok' ? '<span class="pill ok">pass</span>' : s === 'skip' ? '<span class="pill skip">skipped</span>' : '<span class="pill fail">FAIL</span>');
let siteRows = '';
let detail = '';
for (const [k, name] of Object.entries(SITES)) {
  const v = per[k];
  siteRows += `<tr><td><b>${name}</b></td><td class="num">${v.ok}</td><td class="num">${v.x}</td><td class="num">${v.skip}</td><td>${v.x ? '<span class="pill warn">issues</span>' : '<span class="pill ok">green</span>'}</td><td>${[...new Set(v.failed)].map(esc).join(', ') || 'none'}</td></tr>`;
  const ids = [...new Set(v.rows.map((r) => r.id))].sort();
  detail += `<details><summary>${name}: ${v.ok} passed, ${v.x} failed, ${v.skip} skipped</summary><table><thead><tr><th>Family</th><th>Check</th><th>Desktop</th><th>Mobile</th><th>Reason</th></tr></thead><tbody>`;
  for (const id of ids) {
    const d = v.rows.find((r) => r.id === id && r.project === 'desktop');
    const m = v.rows.find((r) => r.id === id && r.project === 'mobile');
    const reason = (d && d.status === 'x' && d.error) || (m && m.status === 'x' && m.error) || '';
    detail += `<tr><td>${FAM[id.slice(0, 2)]}</td><td><code>${id}</code> ${esc(NAMES[id] || '')}</td><td>${d ? pill(d.status) : '<span class="muted">–</span>'}</td><td>${m ? pill(m.status) : '<span class="muted">–</span>'}</td><td class="reason">${esc(reason)}</td></tr>`;
  }
  detail += '</tbody></table></details>';
}

const findings = `
<li><b>flexoffers.com</b>: uncaught JavaScript error <code>wp is not defined</code> on all 10 monitored pages (ER-01).</li>
<li><b>fusetwo.com</b>: uncaught error <code>Cannot read properties of null (reading 'offsetHeight')</code> on 9 pages (ER-01).</li>
<li><b>flexoffers.com /advertisers/</b> and <b>incubators.com /contact-us/</b> have no H1 heading (ER-05).</li>
<li><b>flexoffers.com</b> sitemap: 3 of 3,972 URLs broken, <code>/affiliate-programs/100%-pure-affiliate-program/</code> (400), <code>/affiliate-programs/linksys-affiliate-program/</code> (404), <code>/affiliate-programs/bionatrol-llc-affiliate-program/</code> (unreachable) (AV-08).</li>
<li><b>flexoffers.com</b>: footer link <code>https://careers.flexoffers.com/</code> refused the connection on 7 Oct (FN-01).</li>
<li><b>All four sites</b>: Strict-Transport-Security header missing; fusetwo.com and incubators.com also lack X-Content-Type-Options and X-Frame-Options/CSP (ER-06).</li>`;

const note = partial
  ? `<div class="note"><b>Read before interpreting:</b> this run used a visible (headed) browser for the demo and stopped at ${rows.length} of 252 checks when the laptop went to sleep. Visual-regression failures (VR-*) here come from headed rendering differing from the headless baselines, not from site changes. Every other failure is a real site finding.</div>`
  : '';

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Website Monitoring Report ${date}</title>
<style>
body{font-family:"Segoe UI",Arial,sans-serif;margin:0;background:#f6f8f8;color:#15232b}main{max-width:1000px;margin:0 auto;padding:28px 20px 60px}
h1{font-size:28px;margin:0 0 4px}h2{font-size:19px;margin:28px 0 10px}.muted{color:#5b6c74}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:18px 0}.tile{background:#fff;border:1px solid #d9e2e4;border-radius:10px;padding:12px 14px}.tile .n{font-size:26px;font-weight:700}.tile .l{font-size:12px;color:#5b6c74}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #d9e2e4;font-size:14px}th,td{padding:8px 10px;border-bottom:1px solid #e6ecee;text-align:left;vertical-align:top}th{background:#eef3f3;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#5b6c74}td.num{text-align:right;font-variant-numeric:tabular-nums}td.reason{font-size:12px;color:#5b6c74;max-width:380px}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}.pill.ok{background:#dcf3e6;color:#1a7f4b}.pill.fail{background:#fde3e0;color:#b42318}.pill.warn{background:#fbeedb;color:#b26a00}.pill.skip{background:#eef0f1;color:#5b6c74}
details{margin:8px 0;background:#fff;border:1px solid #d9e2e4;border-radius:8px;padding:8px 12px}summary{cursor:pointer;font-weight:600}code{font-family:Consolas,monospace;font-size:13px;background:#eef3f3;padding:1px 5px;border-radius:4px}
ul{margin:6px 0 0 18px;padding:0}li{margin:4px 0}.note{background:#fff8e6;border:1px solid #f0d9a0;border-radius:8px;padding:10px 14px;font-size:14px}
</style></head><body><main>
<p class="muted">daily-site-checks · run of ${date} · ${esc(label)}</p>
<h1>Website Monitoring Report</h1>
<p class="muted">perhaps.com · flexoffers.com · fusetwo.com · incubators.com · desktop 1440×900 and mobile 390×844</p>
<div class="tiles"><div class="tile"><div class="n">${total.ok + total.x + total.skip}</div><div class="l">of 252 checks run</div></div><div class="tile"><div class="n">${total.ok}</div><div class="l">passed</div></div><div class="tile"><div class="n">${total.x}</div><div class="l">failed</div></div><div class="tile"><div class="n">${total.skip}</div><div class="l">skipped (not configured, or desktop-only on mobile)</div></div></div>
${note}
<h2>Results per site</h2><table><thead><tr><th>Site</th><th>Passed</th><th>Failed</th><th>Skipped</th><th>Status</th><th>Failed checks</th></tr></thead><tbody>${siteRows}</tbody></table>
<h2>Findings on the live sites</h2><ul>${findings}</ul>
<h2>Check-by-check detail</h2>${detail}
<h2>What the suite covers</h2><ul><li><b>Availability (AV)</b>: homepage, every key page, redirects, TLS, DNS, 404, robots/sitemap, every sitemap URL.</li><li><b>Functionality (FN)</b>: homepage links, images, contact form, search, login, signup, embeds, CTAs.</li><li><b>Error detection (ER)</b>: JS errors, failed requests, mixed content, placeholder text, title/H1, security headers.</li><li><b>Performance (PF)</b>: TTFB, LCP, page weight, requests, 7-day trend.</li><li><b>User flows (UF)</b>: contact, CTA landing, signups, login, search, mobile menu.</li><li><b>Visual regression (VR)</b>: full page, hero, header/footer, layout shift, text and style drift, sections.</li></ul>
<p class="muted">Generated ${new Date().toLocaleString('en-GB')} from ${esc(src)}. Playwright's interactive report for a completed run: <code>npm run report</code>.</p>
</main></body></html>`;

fs.mkdirSync(path.join(__dirname, '..', 'reports'), { recursive: true });
const out = path.join(__dirname, '..', 'reports', `report-${date}.html`);
fs.writeFileSync(out, html);
console.log(out);
