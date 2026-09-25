// Open-alert state so that:
//   - Critical failures are re-posted every hour until they pass again
//   - High failures are posted once and then stay quiet
//   - A recovery posts a single "resolved" notice
//
// State file: state/alerts.json  { open: { "<site>::<scenario>::<project>": {...} } }

const path = require('path');
const { STATE_DIR, readJson, writeJson } = require('./results');

const ALERTS_FILE = path.join(STATE_DIR, 'alerts.json');
const REPOST_AFTER_MS = 55 * 60 * 1000;

const keyOf = (r) => `${r.site}::${r.scenario}::${r.project}`;
const load = () => readJson(ALERTS_FILE, { open: {} });
const save = (state) => writeJson(ALERTS_FILE, state);

/**
 * Reconcile a list of results (from a daily run, an hourly ping or a re-check)
 * with the open alerts. Returns { post, resolved } lists of alert objects.
 */
function reconcile(results, { now = new Date(), retries = 0 } = {}) {
  const state = load();
  const nowIso = now.toISOString();
  const post = [];
  const resolved = [];
  for (const r of results) {
    if (!r.site || !r.scenario) continue;
    const k = keyOf(r);
    const open = state.open[k];
    const alertable = r.status === 'failed' && (r.severity === 'critical' || r.severity === 'high');
    if (alertable) {
      if (!open) {
        const a = {
          key: k,
          site: r.site,
          scenario: r.scenario,
          name: r.name,
          project: r.project,
          severity: r.severity,
          firstSeen: nowIso,
          lastSeen: nowIso,
          lastPosted: nowIso,
          count: 1,
          error: r.error,
          url: r.url,
          attachments: r.attachments || [],
          retries,
        };
        state.open[k] = a;
        post.push(a);
      } else {
        open.lastSeen = nowIso;
        open.count += 1;
        open.error = r.error;
        open.url = r.url || open.url;
        open.attachments = r.attachments && r.attachments.length ? r.attachments : open.attachments;
        open.retries = retries;
        const escalated = open.severity !== 'critical' && r.severity === 'critical';
        open.severity = r.severity;
        if (escalated || (open.severity === 'critical' && now - new Date(open.lastPosted) >= REPOST_AFTER_MS)) {
          open.lastPosted = nowIso;
          post.push(open);
        }
      }
    } else if (r.status === 'passed' && open) {
      delete state.open[k];
      resolved.push({ ...open, resolved: true, lastSeen: nowIso });
    }
  }
  save(state);
  return { post, resolved, state };
}

function openCritical() {
  return Object.values(load().open).filter((a) => a.severity === 'critical');
}

module.exports = { reconcile, openCritical, load, keyOf, ALERTS_FILE };
