#!/usr/bin/env node
// Weekly roll-up (Monday): 7-day uptime percentage and response-time trend
// per site, from runs/uptime.jsonl (hourly pings) and the daily results.
// Called by src/run.js on Mondays; can be run manually: npm run run:weekly

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { RUNS_DIR, todayKey, loadHistory, metricSeries, average, writeJson } = require('./lib/results');
const { REPORT_BASE_URL } = require('./lib/runner');
const { activeSites } = require('../config/sites');
const teams = require('./teams');

const BARS = '▁▂▃▄▅▆▇█';

function spark(series) {
  if (series.length < 2) return '';
  const min = Math.min(...series);
  const max = Math.max(...series);
  return series.map((v) => BARS[max === min ? 3 : Math.round(((v - min) / (max - min)) * (BARS.length - 1))]).join('');
}

function readUptime(days = 7) {
  const file = path.join(RUNS_DIR, 'uptime.jsonl');
  if (!fs.existsSync(file)) return [];
  const cutoff = Date.now() - days * 86400000;
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((e) => e && new Date(e.ts).getTime() >= cutoff);
}

async function run({ dryRunDir, log = console.log } = {}) {
  const history = loadHistory(7);
  const pings = readUptime(7);
  const notes = [];
  const rows = activeSites().map((site) => {
    const mine = pings.filter((p) => p.site === site.key);
    let uptimePct = null;
    let avgMs = null;
    if (mine.length) {
      uptimePct = (mine.filter((p) => p.ok).length / mine.length) * 100;
      avgMs = average(mine.filter((p) => p.ok).map((p) => p.ms));
    } else {
      // Fall back to the daily AV-01 result when the hourly job has no data yet.
      const daily = history.flatMap((h) => h.results.filter((r) => r.site === site.key && r.scenario === 'AV-01'));
      if (daily.length) uptimePct = (daily.filter((r) => r.status === 'passed').length / daily.length) * 100;
      avgMs = average(metricSeries(history, site.key, 'AV-01', 'responseMs'));
    }
    const series = metricSeries(history, site.key, 'AV-01', 'responseMs');
    const failedChecks = history.reduce((n, h) => n + h.results.filter((r) => r.site === site.key && r.status === 'failed').length, 0);
    return { site: site.domain, key: site.key, uptimePct, avgMs, spark: spark(series), series, failedChecks, samples: mine.length, days: history.length };
  });
  if (!pings.length) notes.push('No hourly uptime data yet; uptime is derived from the daily homepage check.');
  if (history.length < 7) notes.push(`${history.length} daily run(s) in the window.`);

  const weekEnding = todayKey();
  const w = { weekEnding, rows, notes, reportUrl: REPORT_BASE_URL || null };
  writeJson(path.join(RUNS_DIR, `weekly-${weekEnding}.json`), w);
  const r = await teams.postCard(teams.weeklyCard(w), { dryRunDir });
  log(`weekly roll-up: ${r.ok ? 'posted' : r.skipped}`);
  return w;
}

module.exports = { run };

if (require.main === module) {
  const noTeams = process.argv.includes('--no-teams');
  run({ dryRunDir: noTeams ? path.join(RUNS_DIR, todayKey(), 'cards') : undefined }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
