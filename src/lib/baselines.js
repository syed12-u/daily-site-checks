// JSON baselines for the non-pixel visual checks (layout boxes, visible text,
// computed styles). Image baselines are handled by Playwright itself under
// baselines/<project>/<site>/... via snapshotPathTemplate.
//
// First run (file missing) or UPDATE_BASELINES=1: the current value is written
// and the check passes with a "baseline captured" note. Otherwise the current
// value is compared and differences are returned.

const fs = require('fs');
const path = require('path');
const { ROOT, note } = require('./results');

const BASELINES_DIR = path.join(ROOT, 'baselines');

function jsonPath(kind, project, siteKey, pageKey) {
  return path.join(BASELINES_DIR, kind, project, siteKey, `${pageKey}.json`);
}

function shouldUpdate(pageKey) {
  if (!process.env.UPDATE_BASELINES) return false;
  const only = process.env.APPROVE_PAGE;
  return !only || only === 'all' || only === pageKey;
}

/**
 * Compare `current` to the stored baseline via compareFn(baseline, current)
 * which returns an array of difference strings (empty = pass).
 * Returns { captured: true } or { diffs: [...] , baselineAt }.
 */
function compareOrCapture(testInfo, kind, project, siteKey, pageKey, current, compareFn) {
  const file = jsonPath(kind, project, siteKey, pageKey);
  const exists = fs.existsSync(file);
  if (!exists || shouldUpdate(pageKey)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ capturedAt: new Date().toISOString(), data: current }, null, 2));
    note(testInfo, `${kind} baseline ${exists ? 'updated' : 'captured'} for ${siteKey}/${pageKey}`);
    return { captured: true };
  }
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  const diffs = compareFn(stored.data, current) || [];
  return { diffs, baselineAt: stored.capturedAt };
}

/** Image baselines older than `days` with no change (for the stale-baseline note). */
function staleImageBaselines(days = 90) {
  const out = [];
  const cutoff = Date.now() - days * 86400000;
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.png') && fs.statSync(p).mtimeMs < cutoff) out.push(path.relative(ROOT, p));
    }
  };
  for (const project of ['desktop', 'mobile']) walk(path.join(BASELINES_DIR, project));
  return out;
}

module.exports = { BASELINES_DIR, jsonPath, compareOrCapture, staleImageBaselines };
