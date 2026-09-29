#!/usr/bin/env node
// Record every test of a run with a video AND a full trace, then collect them
// under videos/<date>/:
//   <ID>-<site>-<name>-<project>-<status>.webm   the screen recording
//   <ID>-<site>-<name>-<project>-<status>.zip    the trace: every step with its
//                                                command, selector, screenshot,
//                                                DOM snapshot, network, console
//
//   npm run test:video                                    flexoffers FN + UF checks
//   npm run test:video -- --sites perhaps --grep "\[FN-"  any subset
//
// Open a trace step by step:   npx playwright show-trace videos/<date>/<file>.zip
// Open the HTML report:        npx playwright show-report runs/_videos/html
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : d);
const sites = opt('--sites', 'flexoffers');
const grep = opt('--grep', '\[(FN|UF)-\d\d\]');
const project = opt('--project', 'desktop');
const date = new Date().toISOString().slice(0, 10);
const runDir = path.join(ROOT, 'runs', '_videos');
const outDir = path.join(ROOT, 'videos', date);

fs.rmSync(runDir, { recursive: true, force: true });
const cli = require.resolve('@playwright/test/cli');
spawnSync(process.execPath, [cli, 'test', '--project', project, '--workers', '2', '--grep', grep], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, RUN_DIR: runDir, SITES: sites, VIDEO: 'on', TRACE: 'on', SLOWMO: process.env.SLOWMO || '150' },
});

fs.mkdirSync(outDir, { recursive: true });
const results = JSON.parse(fs.readFileSync(path.join(runDir, 'results.json'), 'utf8')).results;
const artifacts = path.join(runDir, 'artifacts');
const folders = fs.existsSync(artifacts) ? fs.readdirSync(artifacts) : [];
let videos = 0;
let traces = 0;
for (const r of results) {
  if (r.status === 'skipped') continue;
  const folder = folders.find((d) => d.includes(`-${r.scenario}-${r.site}-`) && d.endsWith(`-${r.project}`));
  if (!folder) continue;
  const base = `${r.scenario}-${r.site}-${r.name.replace(/[^\w]+/g, '-')}-${r.project}-${r.status}`;
  const dir = path.join(artifacts, folder);
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.webm')) {
      fs.copyFileSync(path.join(dir, f), path.join(outDir, `${base}.webm`));
      videos++;
    } else if (f === 'trace.zip') {
      fs.copyFileSync(path.join(dir, f), path.join(outDir, `${base}.zip`));
      traces++;
    }
  }
}
console.log(`\n${videos} video(s) and ${traces} trace(s) saved to ${outDir}`);
console.log(`Step-by-step viewer:  npx playwright show-trace "${path.join(outDir, '<file>.zip')}"`);
console.log(`HTML report:          npx playwright show-report "${path.join(runDir, 'html')}"`);
