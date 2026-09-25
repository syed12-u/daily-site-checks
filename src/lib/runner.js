// Shared plumbing for the orchestrators: run Playwright as a child process,
// publish a run folder, build public URLs, log to file + console.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, readJson } = require('./results');

const PUBLISH_DIR = process.env.PUBLISH_DIR || '';
const REPORT_BASE_URL = (process.env.REPORT_BASE_URL || '').replace(/\/$/, '');

/**
 * Run `playwright test` with the given args. Returns the parsed results.json
 * written by src/reporter.js. Never throws on test failures, only on a
 * missing results file (i.e. Playwright itself crashed).
 */
function runPlaywright({ runDir, resultsFile = 'results.json', htmlDir, args = [], env = {} }) {
  const cli = require.resolve('@playwright/test/cli');
  fs.mkdirSync(runDir, { recursive: true });
  const r = spawnSync(process.execPath, [cli, 'test', ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      RUN_DIR: runDir,
      RESULTS_FILE: resultsFile,
      HTML_DIR: htmlDir || path.join(runDir, 'html'),
      ...env,
    },
  });
  const file = path.join(runDir, resultsFile);
  const data = readJson(file, null);
  if (!data) throw new Error(`Playwright produced no results file at ${file} (exit code ${r.status}${r.error ? ', ' + r.error.message : ''})`);
  data.exitCode = r.status;
  return data;
}

/** Copy the run folder to PUBLISH_DIR/<name>. Returns the destination or null. */
function publishRun(runDir, name) {
  if (!PUBLISH_DIR) return null;
  const dest = path.join(PUBLISH_DIR, name);
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(runDir, dest, { recursive: true, force: true });
  return dest;
}

/** Public URL for a file inside the run folder, or null when not published. */
function publicUrl(localPath, runDir, name) {
  if (!REPORT_BASE_URL || !localPath) return null;
  const rel = path.relative(runDir, localPath).split(path.sep).join('/');
  if (rel.startsWith('..')) return null;
  return `${REPORT_BASE_URL}/${name}/${rel.split('/').map(encodeURIComponent).join('/')}`;
}

function createLogger(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    fs.appendFileSync(file, line + '\n');
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { runPlaywright, publishRun, publicUrl, createLogger, sleep, PUBLISH_DIR, REPORT_BASE_URL };
