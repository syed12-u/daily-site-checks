// Custom Playwright reporter. Writes a flat results.json that the orchestrator
// (src/run.js) and Teams cards consume:
//
// {
//   startedAt, finishedAt, durationMs,
//   results: [{ key, project, scenario, site, name, title, status, severity,
//               error, url, notes[], metrics{}, attachments[], durationMs }]
// }

const fs = require('fs');
const path = require('path');
const { SEVERITY } = require('./lib/severity');

const TITLE_RE = /^\[([A-Z]{2}-\d{2})\]\[([\w.-]+)\]\s*(.*)$/;
const ANSI_RE = /\u001b\[[0-9;]*m/g;

class SentinelReporter {
  constructor(options = {}) {
    this.outputFile = options.outputFile || path.join('runs', 'results.json');
    this.results = [];
  }

  onBegin() {
    this.startedAt = new Date();
  }

  onTestEnd(test, result) {
    const m = test.title.match(TITLE_RE);
    const scenario = m ? m[1] : null;
    const site = m ? m[2] : null;
    const name = m ? m[3] : test.title;
    const project = test.parent.project() ? test.parent.project().name : 'default';

    const ann = (type) => result.annotations.concat(test.annotations).filter((a) => a.type === type);
    const severityOverride = ann('severity').pop();
    const metrics = {};
    for (const a of ann('metric')) {
      try {
        Object.assign(metrics, JSON.parse(a.description));
      } catch {
        /* ignore */
      }
    }
    const notes = ann('note').map((a) => a.description);
    const urlAnn = ann('url').pop();

    const attachments = result.attachments
      .filter((a) => a.path && /\.(png|jpg|jpeg|webp)$/i.test(a.path))
      .map((a) => ({ name: a.name, path: a.path }));

    const errors = result.errors.length ? result.errors : result.error ? [result.error] : [];
    const error = errors
      .map((e) => (e.message || String(e)).replace(ANSI_RE, ''))
      .join('\n---\n')
      .slice(0, 4000);

    // Normalise status: passed | failed | skipped
    let status = result.status;
    if (status === 'timedOut' || status === 'interrupted') status = 'failed';

    this.results.push({
      key: `${project}::${test.title}`,
      project,
      scenario,
      site,
      name,
      title: test.title,
      status,
      severity: severityOverride ? severityOverride.description : SEVERITY[scenario] || 'medium',
      error: status === 'failed' ? error : '',
      url: urlAnn ? urlAnn.description : null,
      notes,
      metrics,
      attachments,
      durationMs: result.duration,
      retry: result.retry,
    });
  }

  onEnd() {
    const finishedAt = new Date();
    const data = {
      startedAt: this.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt - this.startedAt,
      results: this.results,
    };
    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    fs.writeFileSync(this.outputFile, JSON.stringify(data, null, 2));
  }

  printsToStdio() {
    return false;
  }
}

module.exports = SentinelReporter;
