#!/usr/bin/env node
// Run the suite one site at a time and post one Teams card per site.
//
//   node src/run-per-site.js                 all sites, in config order
//   node src/run-per-site.js --sites a,b     a subset
//   node src/run-per-site.js --no-teams      save cards locally instead of posting
//
// Each site runs src/run.js with its own folder (runs/<date>/sites/<site>/), its own
// retries and its own card. Afterwards the per-site results are merged into
// runs/<date>/results.json and summary.json so history and trends keep working.
// The Monday weekly roll-up is posted once, after the last site.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { RUNS_DIR, todayKey, readJson, writeJson, loadHistory } = require('./lib/results');
const { createLogger } = require('./lib/runner');
const { sites } = require('../config/sites');
const { summarize } = require('./run');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : undefined);
const keys = (opt('--sites') || Object.keys(sites).join(',')).split(',').map((s) => s.trim()).filter((k) => sites[k]);
const date = todayKey();
const dayDir = path.join(RUNS_DIR, date);
fs.mkdirSync(dayDir, { recursive: true });
const log = createLogger(path.join(dayDir, 'per-site.log'));

const passThrough = [];
if (flag('--no-teams')) passThrough.push('--no-teams');
if (flag('--headed')) passThrough.push('--headed');
if (opt('--workers')) passThrough.push('--workers', opt('--workers'));

log(`per-site run started: ${keys.join(', ')}`);
const merged = [];
let attempts = 1;
for (const key of keys) {
  const siteDir = path.join(dayDir, 'sites', key);
  log(`--- ${sites[key].domain}: starting`);
  const r = spawnSync(process.execPath, [path.join(__dirname, 'run.js'), '--sites', key, '--run-dir', siteDir, '--no-weekly', ...passThrough], {
    stdio: 'inherit',
    env: { ...process.env, SITES: key },
  });
  const res = readJson(path.join(siteDir, 'results.json'), null);
  if (!res) {
    log(`--- ${sites[key].domain}: no results (exit ${r.status}); continuing with next site`);
    continue;
  }
  attempts = Math.max(attempts, res.attempts || 1);
  merged.push(...res.results);
  const s = readJson(path.join(siteDir, 'summary.json'), null);
  log(`--- ${sites[key].domain}: ${s ? `${s.passed}/${s.total} passed, ${s.overall}` : 'done'} (exit ${r.status})`);
}

// Merge for history / trends / weekly roll-up.
const final = { date, attempts, perSite: true, finishedAt: new Date().toISOString(), results: merged };
writeJson(path.join(dayDir, 'results.json'), final);
const summary = summarize(final, date, dayDir, loadHistory(7));
writeJson(path.join(dayDir, 'summary.json'), summary);
log(`all sites: ${summary.passed}/${summary.total} passed, overall ${summary.overall}`);

if (!flag('--no-weekly') && new Date().getDay() === 1) {
  require('./weekly')
    .run({ dryRunDir: flag('--no-teams') ? path.join(dayDir, 'cards') : undefined, log })
    .catch((e) => log(`weekly roll-up failed: ${e.message}`))
    .finally(() => log('done'));
} else {
  log('done');
}
