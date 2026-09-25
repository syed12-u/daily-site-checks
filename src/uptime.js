#!/usr/bin/env node
// Hourly lightweight uptime check (scheduled every hour).
//
//   - GET each homepage; HTTP 200 within 10 s counts as up. A failure is
//     retried RETRIES times, RETRY_DELAY_SECONDS apart, before alerting.
//   - Appends one line per site to runs/uptime.jsonl (used by the weekly card).
//   - Posts a Critical card while a site is down (each hour) and a resolved
//     card when it comes back.
//   - Re-checks any Critical alert still open from the daily run (e.g. login
//     broken) by re-running just those scenarios, and re-posts or resolves.
//
// Flags: --no-teams  --sites a,b

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { RUNS_DIR, todayKey } = require('./lib/results');
const { timedFetch } = require('./lib/http');
const { reconcile, openCritical, keyOf } = require('./lib/alerts');
const { runPlaywright, publicUrl, createLogger, sleep, REPORT_BASE_URL } = require('./lib/runner');
const { activeSites } = require('../config/sites');
const teams = require('./teams');

const argv = process.argv.slice(2);
const NO_TEAMS = argv.includes('--no-teams');
const si = argv.indexOf('--sites');
if (si >= 0) process.env.SITES = argv[si + 1];
const RETRIES = Number(process.env.RETRIES ?? 2);
const RETRY_DELAY = Number(process.env.RETRY_DELAY_SECONDS ?? 60);
const UPTIME_LOG = path.join(RUNS_DIR, 'uptime.jsonl');

async function ping(site) {
  let last;
  for (let attempt = 1; attempt <= RETRIES + 1; attempt++) {
    last = await timedFetch(site.baseUrl, { redirect: 'follow', timeout: 10000 });
    last.attempt = attempt;
    if (last.status === 200) return last;
    if (attempt <= RETRIES) await sleep(RETRY_DELAY * 1000);
  }
  return last;
}

async function main() {
  const sites = activeSites();
  const log = createLogger(path.join(RUNS_DIR, 'uptime.log'));
  const cardsDir = NO_TEAMS ? path.join(RUNS_DIR, todayKey(), 'cards') : undefined;
  const results = [];
  fs.mkdirSync(RUNS_DIR, { recursive: true });

  for (const site of sites) {
    const r = await ping(site);
    const ok = r.status === 200;
    fs.appendFileSync(UPTIME_LOG, JSON.stringify({ ts: new Date().toISOString(), site: site.key, status: r.status, ms: r.ms, ok, attempts: r.attempt }) + '\n');
    log(`${site.key}: ${ok ? 'up' : 'DOWN'} ${r.status || r.error} in ${r.ms} ms (attempt ${r.attempt})`);
    results.push({
      site: site.key,
      scenario: 'UP-01',
      name: 'Hourly uptime',
      project: 'hourly',
      status: ok ? 'passed' : 'failed',
      severity: 'critical',
      error: ok ? '' : `Homepage returned ${r.status || r.error} on ${r.attempt} attempt(s) ${RETRY_DELAY}s apart`,
      url: site.baseUrl,
      attachments: [],
    });
  }

  // Re-check open Critical alerts from the daily run (not the hourly ones).
  const open = openCritical().filter((a) => a.project !== 'hourly');
  let runDir = null;
  if (open.length) {
    const stamp = new Date().toISOString().slice(11, 16).replace(':', '');
    runDir = path.join(RUNS_DIR, todayKey(), `recheck-${stamp}`);
    const grep = open.map((a) => `\\[${a.scenario}\\]\\[${a.site}\\]`).join('|');
    log(`re-checking ${open.length} open critical alert(s): ${open.map((a) => a.key).join(', ')}`);
    try {
      const data = runPlaywright({ runDir, args: ['--grep', grep] });
      const wanted = new Set(open.map((a) => a.key));
      results.push(...data.results.filter((r) => wanted.has(keyOf(r))));
    } catch (e) {
      log(`re-check failed to run: ${e.message}`);
    }
  }

  const { post, resolved } = reconcile(results, { retries: RETRIES });
  for (const a of [...post, ...resolved]) {
    const site = sites.find((s) => s.key === a.site) || { domain: a.site };
    const shot = (a.attachments || [])[0];
    const c = teams.alertCard({
      ...a,
      site: site.domain,
      imageUrl: shot && runDir ? publicUrl(shot.path, runDir, `${todayKey()}/${path.basename(runDir)}`) : null,
      reportUrl: REPORT_BASE_URL ? `${REPORT_BASE_URL}/${todayKey()}/html/index.html` : null,
    });
    try {
      const r = await teams.postCard(c, { dryRunDir: cardsDir });
      log(`${a.resolved ? 'resolved' : 'alert'} ${a.key}: ${r.ok ? 'posted' : r.skipped}`);
    } catch (e) {
      log(`alert ${a.key}: failed to post (${e.message})`);
    }
  }
  const down = results.filter((r) => r.status === 'failed').length;
  process.exitCode = down ? 2 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(3);
});
