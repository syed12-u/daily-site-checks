// Helpers that tests use to tag themselves so the reporter (src/reporter.js)
// can attribute results to a scenario ID + site, attach metrics, and override
// severity. Also gives access to previous runs for trend checks.

const fs = require('fs');
const path = require('path');
const { NAMES } = require('./severity');

const ROOT = path.resolve(__dirname, '..', '..');
const RUNS_DIR = path.join(ROOT, 'runs');
const STATE_DIR = path.join(ROOT, 'state');

/** Test title format the reporter parses: "[AV-01][perhaps] Homepage responds" */
function tag(id, site, name) {
  return `[${id}][${site.key}] ${name || NAMES[id] || id}`;
}

function setSeverity(testInfo, severity) {
  testInfo.annotations.push({ type: 'severity', description: severity });
}

function metric(testInfo, obj) {
  testInfo.annotations.push({ type: 'metric', description: JSON.stringify(obj) });
}

function note(testInfo, text) {
  testInfo.annotations.push({ type: 'note', description: String(text) });
}

/** Record the URL a scenario was checking, shown in alerts. */
function url(testInfo, value) {
  testInfo.annotations.push({ type: 'url', description: value });
}

function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Load results.json from the previous N days (excluding today). */
function loadHistory(days = 7) {
  if (!fs.existsSync(RUNS_DIR)) return [];
  const today = todayKey();
  const dirs = fs
    .readdirSync(RUNS_DIR)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < today)
    .sort()
    .slice(-days);
  const history = [];
  for (const d of dirs) {
    const file = path.join(RUNS_DIR, d, 'results.json');
    if (!fs.existsSync(file)) continue;
    try {
      history.push({ date: d, ...JSON.parse(fs.readFileSync(file, 'utf8')) });
    } catch {
      /* ignore corrupt run */
    }
  }
  return history;
}

/** Pull one metric key for a site + scenario across history. */
function metricSeries(history, siteKey, scenarioId, key, project = 'desktop') {
  const out = [];
  for (const run of history) {
    for (const r of run.results || []) {
      if (r.site === siteKey && r.scenario === scenarioId && (!project || r.project === project)) {
        const v = r.metrics && r.metrics[key];
        if (typeof v === 'number') out.push(v);
      }
    }
  }
  return out;
}

function average(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

module.exports = {
  ROOT,
  RUNS_DIR,
  STATE_DIR,
  tag,
  setSeverity,
  metric,
  note,
  url,
  todayKey,
  loadHistory,
  metricSeries,
  average,
  readJson,
  writeJson,
};
