#!/usr/bin/env node
// Finish a daily run that was stopped mid-way (e.g. retries cancelled): merge the
// results-attempt-*.json files already written, build results.json + summary.json,
// and post the daily card.
//
//   node src/finalize.js [YYYY-MM-DD] [--no-teams]
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { RUNS_DIR, todayKey, readJson, writeJson, loadHistory } = require('./lib/results');
const { summarize } = require('./run');
const teams = require('./teams');

const argv = process.argv.slice(2);
const date = argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || todayKey();
const noTeams = argv.includes('--no-teams');
const runDir = path.join(RUNS_DIR, date);

const attempts = fs
  .readdirSync(runDir)
  .filter((f) => /^results-attempt-\d+\.json$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
if (!attempts.length) {
  console.error(`no results-attempt-*.json in ${runDir}`);
  process.exit(1);
}
const merged = new Map();
let startedAt = null;
for (const [i, f] of attempts.entries()) {
  const data = readJson(path.join(runDir, f), { results: [] });
  startedAt = startedAt || data.startedAt;
  for (const r of data.results) {
    if (r.status === 'skipped' && merged.has(r.key)) continue;
    r.retry = i;
    merged.set(r.key, r);
  }
}
const final = { date, startedAt, finishedAt: new Date().toISOString(), attempts: attempts.length, results: [...merged.values()], finalizedEarly: true };
writeJson(path.join(runDir, 'results.json'), final);

const summary = summarize(final, date, runDir, loadHistory(7));
summary.notes.push(`Run finalised after ${attempts.length} attempt(s); remaining retries were skipped.`);
summary.reportPath = path.join(runDir, 'html', 'index.html');
writeJson(path.join(runDir, 'summary.json'), summary);
console.log(`${date}: ${summary.passed}/${summary.total} passed, ${summary.skipped} skipped, overall ${summary.overall}`);

teams
  .postCard(teams.summaryCard(summary), { dryRunDir: noTeams ? path.join(runDir, 'cards') : undefined })
  .then((r) => console.log(r.ok ? 'daily summary posted to Teams' : `not posted: ${r.skipped}`))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
