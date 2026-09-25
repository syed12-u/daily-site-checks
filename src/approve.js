#!/usr/bin/env node
// Approve an intended change by re-capturing baselines.
//
//   npm run approve <site> <page>     re-capture image + JSON baselines for one page
//   npm run approve <site> all        every page of one site
//   npm run approve all all           everything (first-run capture)
//   npm run approve <site> dns        accept the site's current DNS records
//
// Records the approval in state/approvals.json (shown in the next daily
// summary's change log) and commits the baselines when the folder is a git repo.

require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, RUNS_DIR, STATE_DIR, readJson, writeJson } = require('./lib/results');
const { runPlaywright } = require('./lib/runner');
const { sites } = require('../config/sites');

const [siteArg, pageArg] = process.argv.slice(2);
if (!siteArg || !pageArg) {
  console.error('usage: npm run approve <site|all> <page|all|dns>');
  process.exit(1);
}
if (siteArg !== 'all' && !sites[siteArg]) {
  console.error(`unknown site "${siteArg}". Known: ${Object.keys(sites).join(', ')}`);
  process.exit(1);
}
if (pageArg !== 'all' && pageArg !== 'dns' && siteArg !== 'all' && !sites[siteArg].pages.some((p) => p.key === pageArg)) {
  console.error(`unknown page "${pageArg}" for ${siteArg}. Known: ${sites[siteArg].pages.map((p) => p.key).join(', ')}`);
  process.exit(1);
}

const runDir = path.join(RUNS_DIR, '_approve');
fs.rmSync(runDir, { recursive: true, force: true });

let data;
if (pageArg === 'dns') {
  data = runPlaywright({
    runDir,
    args: ['--grep', siteArg === 'all' ? '\\[AV-05\\]' : `\\[AV-05\\]\\[${siteArg}\\]`],
    env: { UPDATE_DNS: siteArg },
  });
} else {
  data = runPlaywright({
    runDir,
    args: ['--grep', siteArg === 'all' ? '\\[VR-' : `\\[VR-\\d\\d\\]\\[${siteArg}\\]`],
    env: { UPDATE_BASELINES: '1', APPROVE_PAGE: pageArg, SITES: siteArg === 'all' ? '' : siteArg },
  });
}

const failed = data.results.filter((r) => r.status === 'failed');
const captured = data.results.flatMap((r) => r.notes.filter((n) => /baseline (captured|updated)/.test(n)));
console.log(`\n${captured.length} baseline(s) written, ${failed.length} check(s) failed while capturing.`);
for (const f of failed) console.log(`  FAILED ${f.title}: ${(f.error || '').split('\n')[0]}`);

const approvals = readJson(path.join(STATE_DIR, 'approvals.json'), []);
approvals.push({ site: siteArg, page: pageArg, at: new Date().toISOString(), by: os.userInfo().username, baselines: captured.length });
writeJson(path.join(STATE_DIR, 'approvals.json'), approvals);

if (fs.existsSync(path.join(ROOT, '.git'))) {
  const add = spawnSync('git', ['add', 'baselines', 'state/approvals.json', 'state/dns.json'], { cwd: ROOT, stdio: 'inherit' });
  if (add.status === 0) spawnSync('git', ['commit', '-m', `Approve baseline: ${siteArg}/${pageArg}`], { cwd: ROOT, stdio: 'inherit' });
} else {
  console.log('Not a git repository yet; baselines written but not committed.');
}
process.exitCode = failed.length ? 1 : 0;
