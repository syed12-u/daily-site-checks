// Microsoft Teams delivery via incoming webhook (Workflows connector or the
// classic Incoming Webhook). Builds Adaptive Cards for immediate alerts, the
// daily summary and the weekly roll-up.
//
// Images: a webhook cannot upload files, so screenshots/diffs are shown only
// when REPORT_BASE_URL is set and the run folder is published there
// (PUBLISH_DIR). Without it, cards carry text and local paths.
//
// Usage: node src/teams.js --test      posts a hello card to verify the webhook

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const WEBHOOK = process.env.TEAMS_WEBHOOK_URL;
const STYLE = { critical: 'attention', high: 'warning', medium: 'accent', low: 'default', ok: 'good' };
const ICON = { critical: '🔴', high: '🟠', medium: '🟡', low: '⚪', ok: '🟢', resolved: '✅' };
const OVERALL = { red: '🔴', amber: '🟠', green: '🟢' };

function mentions() {
  const upns = (process.env.TEAMS_MENTION_UPNS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const names = (process.env.TEAMS_MENTION_NAMES || '').split(',').map((s) => s.trim());
  if (!upns.length) return { text: '', entities: [] };
  const entities = upns.map((upn, i) => ({
    type: 'mention',
    text: `<at>${names[i] || upn}</at>`,
    mentioned: { id: upn, name: names[i] || upn },
  }));
  return { text: entities.map((e) => e.text).join(' '), entities };
}

function card(body, { entities = [], actions = [] } = {}) {
  const c = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
    msteams: { width: 'Full' },
  };
  if (entities.length) c.msteams.entities = entities;
  if (actions.length) c.actions = actions;
  return c;
}

const text = (t, extra = {}) => ({ type: 'TextBlock', text: t, wrap: true, ...extra });
const facts = (pairs) => ({ type: 'FactSet', facts: pairs.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([title, value]) => ({ title, value: String(value) })) });
const image = (url, alt, size = 'Large') => ({ type: 'Image', url, altText: alt, size });
const openUrl = (title, url) => ({ type: 'Action.OpenUrl', title, url });
const code = (s) => '```\n' + String(s).slice(0, 1200) + '\n```';

/** Post one Adaptive Card. Returns { ok } or { skipped } when no webhook is set. */
async function postCard(content, { dryRunDir } = {}) {
  const payload = {
    type: 'message',
    attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content }],
  };
  if (dryRunDir) {
    // --no-teams: save the card locally and do NOT post, even when a webhook is configured.
    fs.mkdirSync(dryRunDir, { recursive: true });
    const f = path.join(dryRunDir, `card-${Date.now()}.json`);
    fs.writeFileSync(f, JSON.stringify(payload, null, 2));
    return { skipped: `saved to ${f} (--no-teams)` };
  }
  if (!WEBHOOK) return { skipped: 'TEAMS_WEBHOOK_URL not set' };
  const res = await fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`Teams webhook returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { ok: true };
}

/** Immediate alert (Critical / High) or a resolution notice. */
function alertCard(a) {
  const sev = a.resolved ? 'ok' : a.severity;
  const icon = a.resolved ? ICON.resolved : ICON[sev];
  const m = a.severity === 'critical' && !a.resolved ? mentions() : { text: '', entities: [] };
  const title = a.resolved ? `${icon} RESOLVED: ${a.site} - ${a.scenario} ${a.name}` : `${icon} ${a.severity.toUpperCase()}: ${a.site} - ${a.scenario} ${a.name}`;
  const body = [
    { type: 'Container', style: STYLE[sev], bleed: true, items: [text(title, { size: 'Large', weight: 'Bolder' })] },
  ];
  if (m.text) body.push(text(m.text));
  body.push(
    facts([
      ['Site', a.site],
      ['Scenario', `${a.scenario} ${a.name}`],
      ['Severity', a.severity],
      ['First seen', a.firstSeen],
      [a.resolved ? 'Resolved' : 'Last seen', a.lastSeen],
      ['Occurrences', a.count],
      ['URL', a.url],
      ['Retries', a.retries],
    ])
  );
  if (!a.resolved && a.error) body.push(text('**What failed**'), text(code(a.error)));
  if (a.imageUrl) body.push(image(a.imageUrl, 'Screenshot of the failing page', 'Stretch'));
  else if (a.imagePath) body.push(text(`Screenshot: ${a.imagePath}`, { size: 'Small', isSubtle: true }));
  const actions = a.reportUrl ? [openUrl('Open full report', a.reportUrl)] : [];
  return card(body, { entities: m.entities, actions });
}

/** Daily summary: one card per run. */
function summaryCard(s) {
  const body = [
    {
      type: 'Container',
      style: s.overall === 'red' ? 'attention' : s.overall === 'amber' ? 'warning' : 'good',
      bleed: true,
      items: [text(`${OVERALL[s.overall]} Daily site check - ${s.date}`, { size: 'Large', weight: 'Bolder' }), text(`${s.passed} of ${s.total} checks passed across ${s.rows.length} sites${s.attempts > 1 ? ` (after ${s.attempts - 1} retry round${s.attempts > 2 ? 's' : ''})` : ''}`)],
    },
  ];
  if (s.narrative) body.push(text(s.narrative));

  // Table header + one row per site.
  const col = (t, w, extra = {}) => ({ type: 'Column', width: w, items: [text(t, { wrap: true, ...extra })] });
  body.push({
    type: 'ColumnSet',
    columns: [col('Site', '2', { weight: 'Bolder' }), col('Status', '1', { weight: 'Bolder' }), col('Failed', '3', { weight: 'Bolder' }), col('Response vs 7d', '2', { weight: 'Bolder' }), col('Diffs', '1', { weight: 'Bolder' })],
  });
  for (const r of s.rows) {
    const resp = r.responseMs != null ? `${r.responseMs} ms${r.avgMs ? ` / ${Math.round(r.avgMs)} ms` : ''}` : '-';
    body.push({
      type: 'ColumnSet',
      separator: true,
      columns: [col(r.site, '2'), col(`${ICON[r.status] || ICON.ok} ${r.status}`, '1'), col(r.failedIds.length ? r.failedIds.join(', ') : 'none', '3'), col(resp, '2'), col(String(r.diffs), '1')],
    });
  }

  // Failure details (compact) for anything medium/low that would not have alerted.
  const details = s.rows.flatMap((r) => r.failures.map((f) => `- **${r.site} ${f.scenario}** ${f.name} (${f.severity}${f.project === 'mobile' ? ', mobile' : ''}): ${f.summary}`));
  if (details.length) body.push(text('**Issues found**'), text(details.slice(0, 25).join('\n')));

  // Diff thumbnails, up to 3 per site.
  for (const r of s.rows) {
    for (const t of r.thumbnails.slice(0, 3)) {
      body.push(text(`**${r.site} / ${t.label}** (baseline, current, diff)`, { size: 'Small' }));
      const imgs = [t.baseline, t.current, t.diff].filter(Boolean).map((u) => ({ type: 'Column', width: 'stretch', items: [image(u, t.label, 'Stretch')] }));
      body.push({ type: 'ColumnSet', columns: imgs });
    }
  }

  if (s.changeLog.length) body.push(text('**Baselines approved since last run**'), text(s.changeLog.map((c) => `- ${c.site}/${c.page} by ${c.by} at ${c.at}`).join('\n')));
  if (s.notes.length) body.push(text(s.notes.map((n) => `- ${n}`).join('\n'), { size: 'Small', isSubtle: true }));
  const actions = s.reportUrl ? [openUrl('Open full HTML report', s.reportUrl)] : [];
  if (!s.reportUrl && s.reportPath) body.push(text(`Full report: ${s.reportPath}`, { size: 'Small', isSubtle: true }));
  return card(body, { actions });
}

/** Weekly roll-up (Monday). */
function weeklyCard(w) {
  const body = [
    { type: 'Container', style: 'accent', bleed: true, items: [text(`📈 Weekly site report - week ending ${w.weekEnding}`, { size: 'Large', weight: 'Bolder' })] },
  ];
  const col = (t, wd, extra = {}) => ({ type: 'Column', width: wd, items: [text(t, { wrap: true, ...extra })] });
  body.push({ type: 'ColumnSet', columns: [col('Site', '2', { weight: 'Bolder' }), col('Uptime', '1', { weight: 'Bolder' }), col('Avg response', '2', { weight: 'Bolder' }), col('Trend', '2', { weight: 'Bolder' }), col('Failed checks', '1', { weight: 'Bolder' })] });
  for (const r of w.rows) {
    body.push({
      type: 'ColumnSet',
      separator: true,
      columns: [col(r.site, '2'), col(r.uptimePct == null ? '-' : `${r.uptimePct.toFixed(2)}%`, '1'), col(r.avgMs == null ? '-' : `${Math.round(r.avgMs)} ms`, '2'), col(r.spark || '-', '2'), col(String(r.failedChecks), '1')],
    });
  }
  if (w.notes && w.notes.length) body.push(text(w.notes.map((n) => `- ${n}`).join('\n'), { size: 'Small', isSubtle: true }));
  return card(body, { actions: w.reportUrl ? [openUrl('Open reports', w.reportUrl)] : [] });
}

module.exports = { postCard, alertCard, summaryCard, weeklyCard, card, text, facts };

if (require.main === module && process.argv.includes('--test')) {
  postCard(card([text('🟢 Site Sentinel is connected to this channel.', { weight: 'Bolder' }), text(`Test message from ${require('os').hostname()} at ${new Date().toISOString()}`)]))
    .then((r) => console.log(r.ok ? 'Posted test card.' : `Not posted: ${r.skipped}`))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
