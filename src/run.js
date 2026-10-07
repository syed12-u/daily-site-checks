#!/usr/bin/env node
// Daily orchestrator (scheduled 06:00).
//
//   1. Run the full Playwright suite for all sites.
//   2. Retry failed tests (RETRIES times, RETRY_DELAY_SECONDS apart) so a blip
//      does not page anyone.
//   3. Merge results, write runs/<date>/results.json + summary.json.
//   4. Publish the run folder (PUBLISH_DIR) so cards can link to it.
//   5. Post immediate alerts (Critical / High) and resolutions.
//   6. Post the daily summary card; on Mondays also the weekly roll-up.
//   7. Prune runs older than HISTORY_DAYS.
//
// Flags: --no-teams (write cards to runs/<date>/cards instead of posting)
//        --no-retry  --sites a,b  --grep <regex>  --run-dir <path>

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, RUNS_DIR, STATE_DIR, todayKey, readJson, writeJson, loadHistory, metricSeries, average, errorSummary } = require('./lib/results');
const { RANK } = require('./lib/severity');
const { reconcile } = require('./lib/alerts');
const { staleImageBaselines } = require('./lib/baselines');
const { runPlaywright, publishRun, publicUrl, createLogger, sleep, REPORT_BASE_URL } = require('./lib/runner');
const { activeSites } = require('../config/sites');
const teams = require('./teams');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
if (opt('--sites')) process.env.SITES = opt('--sites');

const RETRIES = flag('--no-retry') ? 0 : Number(process.env.RETRIES ?? 2);
const RETRY_DELAY = Number(process.env.RETRY_DELAY_SECONDS ?? 60);
const HISTORY_DAYS = Number(process.env.HISTORY_DAYS ?? 30);
const NO_TEAMS = flag('--no-teams');
const RUN_STATE = path.join(STATE_DIR, 'run.json');

const firstLine = (s) => errorSummary(s, 220);

function collectThumbnails(failed, runDir, date) {
  const out = [];
  for (const r of failed.filter((f) => f.scenario && f.scenario.startsWith('VR-'))) {
    const groups = {};
    for (const a of r.attachments || []) {
      const m = a.name.match(/^(.*)-(expected|actual|diff)\.png$/);
      if (!m) continue;
      (groups[m[1]] ||= {})[m[2]] = publicUrl(a.path, runDir, date);
    }
    for (const [label, g] of Object.entries(groups)) {
      if (g.diff || g.actual) out.push({ label: `${label}${r.project === 'mobile' ? ' (mobile)' : ''}`, baseline: g.expected, current: g.actual, diff: g.diff });
    }
  }
  return out.filter((t) => t.baseline || t.current || t.diff);
}

function summarize(final, date, runDir, history) {
  const rows = activeSites().map((site) => {
    const rs = final.results.filter((r) => r.site === site.key && r.status !== 'skipped');
    const failed = rs.filter((r) => r.status === 'failed');
    const worst = failed.reduce((w, r) => (RANK[r.severity] > RANK[w] ? r.severity : w), 'ok');
    const av = rs.find((r) => r.scenario === 'AV-01');
    return {
      site: site.domain,
      key: site.key,
      status: worst,
      failedIds: [...new Set(failed.map((r) => r.scenario + (r.project === 'mobile' ? ' (m)' : '')))],
      responseMs: av && av.metrics ? av.metrics.responseMs : null,
      avgMs: average(metricSeries(history, site.key, 'AV-01', 'responseMs')),
      diffs: failed.filter((r) => r.scenario.startsWith('VR-')).length,
      thumbnails: collectThumbnails(failed, runDir, date),
      failures: failed.map((r) => ({ scenario: r.scenario, name: r.name, severity: r.severity, project: r.project, summary: firstLine(r.error).slice(0, 220) })),
      passed: rs.length - failed.length,
      total: rs.length,
    };
  });
  const counted = final.results.filter((r) => r.status !== 'skipped');
  const anyHigh = rows.some((r) => r.status === 'critical' || r.status === 'high');
  const anyFail = rows.some((r) => r.status !== 'ok');
  return {
    date,
    overall: anyHigh ? 'red' : anyFail ? 'amber' : 'green',
    passed: counted.filter((r) => r.status === 'passed').length,
    total: counted.length,
    skipped: final.results.filter((r) => r.status === 'skipped').length,
    attempts: final.attempts,
    rows,
    notes: [],
    changeLog: [],
  };
}

function narrative(summary) {
  if (!/^true$/i.test(process.env.ANALYZE_WITH_CLAUDE || '')) return null;
  const failures = summary.rows.flatMap((r) => r.failures.map((f) => `${r.site} ${f.scenario} ${f.name} [${f.severity}]: ${f.summary}`));
  if (!failures.length) return null;
  const prompt =
    'You are summarising a daily website monitoring run for a non-technical team. In at most 3 short sentences, say what is broken, ' +
    'which site is most affected and what the first action should be. No markdown, no preamble.\n\nFailures:\n' + failures.join('\n');
  try {
    const r = spawnSync('claude', ['-p', prompt, '--output-format', 'text'], { shell: true, encoding: 'utf8', timeout: 180000 });
    const out = (r.stdout || '').trim();
    return out ? out.slice(0, 700) : null;
  } catch {
    return null;
  }
}

function prune(log) {
  if (!fs.existsSync(RUNS_DIR)) return;
  const cutoff = todayKey(new Date(Date.now() - HISTORY_DAYS * 86400000));
  for (const d of fs.readdirSync(RUNS_DIR)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < cutoff) {
      fs.rmSync(path.join(RUNS_DIR, d), { recursive: true, force: true });
      log(`pruned runs/${d}`);
    }
  }
}

async function main() {
  const date = todayKey();
  const runDir = path.resolve(opt('--run-dir') || process.env.RUN_DIR || path.join(RUNS_DIR, date));
  fs.mkdirSync(runDir, { recursive: true });
  const log = createLogger(path.join(runDir, 'run.log'));
  const cardsDir = NO_TEAMS ? path.join(runDir, 'cards') : undefined;
  // Pass-through options for demos: --headed (visible browser), --workers N, --project name.
  const extra = [];
  if (opt('--grep')) extra.push('--grep', opt('--grep'));
  if (flag('--headed')) extra.push('--headed');
  if (opt('--workers')) extra.push('--workers', opt('--workers'));
  if (opt('--project')) extra.push('--project', opt('--project'));
  const startedAt = new Date();
  log(`daily run started; sites=${activeSites().map((s) => s.key).join(',')} retries=${RETRIES}`);

  // 1-2. Run + retries
  let data = runPlaywright({ runDir, resultsFile: 'results-attempt-1.json', htmlDir: path.join(runDir, 'html'), args: extra });
  const merged = new Map(data.results.map((r) => [r.key, r]));
  let attempts = 1;
  for (let i = 1; i <= RETRIES; i++) {
    const failed = [...merged.values()].filter((r) => r.status === 'failed');
    if (!failed.length) break;
    log(`${failed.length} failed check(s); retry ${i}/${RETRIES} in ${RETRY_DELAY}s`);
    await sleep(RETRY_DELAY * 1000);
    attempts += 1;
    const again = runPlaywright({ runDir, resultsFile: `results-attempt-${attempts}.json`, htmlDir: path.join(runDir, `html-retry-${i}`), args: [...extra, '--last-failed'] });
    for (const r of again.results) {
      if (r.status === 'skipped' && merged.has(r.key)) continue;
      r.retry = i;
      merged.set(r.key, r);
    }
  }

  // 3. Final results
  const final = {
    date,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    attempts,
    results: [...merged.values()],
  };
  writeJson(path.join(runDir, 'results.json'), final);
  const history = loadHistory(7);
  const summary = summarize(final, date, runDir, history);
  log(`finished: ${summary.passed}/${summary.total} passed, ${summary.skipped} skipped, overall ${summary.overall}`);

  // 4. Publish
  const published = publishRun(runDir, date);
  if (published) log(`published to ${published}`);
  summary.reportUrl = REPORT_BASE_URL ? `${REPORT_BASE_URL}/${date}/html/index.html` : null;
  summary.reportPath = path.join(runDir, 'html', 'index.html');

  // Notes + change log
  const stale = staleImageBaselines(90);
  if (stale.length) summary.notes.push(`${stale.length} image baseline(s) older than 90 days; re-capture with npm run approve <site> <page>`);
  if (summary.skipped) summary.notes.push(`${summary.skipped} check(s) skipped (not configured yet: login, search, signup or form submit)`);
  if (!process.env.TEAMS_WEBHOOK_URL) summary.notes.push('TEAMS_WEBHOOK_URL not set: cards were not posted');
  const runState = readJson(RUN_STATE, {});
  const since = runState.lastSummaryAt || '1970-01-01';
  summary.changeLog = readJson(path.join(STATE_DIR, 'approvals.json'), []).filter((a) => a.at > since);
  summary.narrative = narrative(summary);
  writeJson(path.join(runDir, 'summary.json'), summary);

  // 5. Alerts
  const { post, resolved } = reconcile(final.results, { retries: attempts - 1 });
  for (const a of [...post, ...resolved]) {
    const shot = (a.attachments || [])[0];
    const c = teams.alertCard({
      ...a,
      site: (activeSites().find((s) => s.key === a.site) || { domain: a.site }).domain,
      imageUrl: shot ? publicUrl(shot.path, runDir, date) : null,
      imagePath: shot && !REPORT_BASE_URL ? shot.path : null,
      reportUrl: summary.reportUrl,
    });
    try {
      const r = await teams.postCard(c, { dryRunDir: cardsDir });
      log(`${a.resolved ? 'resolved' : 'alert'} ${a.key}: ${r.ok ? 'posted' : r.skipped}`);
    } catch (e) {
      log(`alert ${a.key}: failed to post (${e.message})`);
    }
  }

  // 6. Daily summary (+ weekly on Monday)
  try {
    const r = await teams.postCard(teams.summaryCard(summary), { dryRunDir: cardsDir });
    log(`daily summary: ${r.ok ? 'posted' : r.skipped}`);
    if (r.ok) writeJson(RUN_STATE, { ...runState, lastSummaryAt: new Date().toISOString() });
  } catch (e) {
    log(`daily summary: failed to post (${e.message})`);
  }
  if (new Date().getDay() === 1 || flag('--weekly')) {
    try {
      await require('./weekly').run({ dryRunDir: cardsDir, log });
    } catch (e) {
      log(`weekly roll-up failed: ${e.message}`);
    }
  }

  // 7. Prune
  prune(log);
  log('done');
  process.exitCode = summary.overall === 'red' ? 2 : summary.overall === 'amber' ? 1 : 0;
}

module.exports = { summarize, narrative, prune };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(3);
  });
}
