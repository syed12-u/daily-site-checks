// VR-01 .. VR-08: visual regression against approved baselines.
//
// Image baselines: baselines/<project>/<site>/<page>.png (Playwright snapshot
// path). Missing baselines are captured and reported as a note instead of a
// failure; approving a change re-captures with UPDATE_BASELINES=1 (see
// src/approve.js). JSON baselines (layout, text, styles) live under
// baselines/{layout,text,styles}/<project>/<site>/<page>.json.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { activeSites } = require('../config/sites');
const { prepareForVisual, masks, DEFAULT_MASKS } = require('../src/lib/page');
const { compareOrCapture } = require('../src/lib/baselines');
const { tag, setSeverity, metric, note, url: setUrl } = require('../src/lib/results');

const pageUrl = (site, p) => new URL(p.path, site.baseUrl).toString();
const approving = () => !!process.env.UPDATE_BASELINES;
const pagesFor = (site) => {
  const only = process.env.APPROVE_PAGE;
  return site.pages.filter((p) => !only || only === 'all' || p.key === only);
};

/**
 * Compare a page or locator screenshot to its baseline. Captures the baseline
 * when missing or when approving. Returns 'captured' | 'pass' | 'fail'.
 */
async function snapshot(testInfo, target, page, site, segments, opts = {}) {
  const file = testInfo.snapshotPath(...segments);
  const shouldWrite = !fs.existsSync(file) || approving();
  if (shouldWrite) {
    fs.mkdirSync(require('path').dirname(file), { recursive: true });
    await target.screenshot({ path: file, fullPage: opts.fullPage, mask: opts.mask, animations: 'disabled', caret: 'hide', scale: 'css' });
    note(testInfo, `image baseline ${approving() ? 'updated' : 'captured'}: ${segments.join('/')}`);
    return 'captured';
  }
  const before = testInfo.errors.length;
  // Longer timeout: a full-page capture of a long page needs two stable frames.
  await expect.soft(target).toHaveScreenshot(segments, { timeout: 30000, ...opts });
  return testInfo.errors.length > before ? 'fail' : 'pass';
}

for (const site of activeSites()) {
  test.describe(site.key, () => {
    // VR-01 desktop / VR-02 mobile: full-page screenshots of every page.
    for (const [id, project] of [
      ['VR-01', 'desktop'],
      ['VR-02', 'mobile'],
    ]) {
      test(tag(id, site), async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== project, `${project} only`);
        const outcome = {};
        for (const p of pagesFor(site)) {
          await prepareForVisual(page, site, pageUrl(site, p));
          outcome[p.key] = await snapshot(testInfo, page, page, site, [site.key, `${p.key}.png`], {
            fullPage: true,
            mask: masks(page, site),
            maxDiffPixelRatio: 0.002,
          });
        }
        const failed = Object.keys(outcome).filter((k) => outcome[k] === 'fail');
        metric(testInfo, { pages: Object.keys(outcome).length, diffs: failed.length, outcome });
        if (id === 'VR-01' && failed.includes('home')) setSeverity(testInfo, 'high');
      });
    }

    test(tag('VR-03', site), async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'desktop only');
      setUrl(testInfo, site.baseUrl);
      await prepareForVisual(page, site, site.baseUrl);
      // Hero = configured selector when it matches, otherwise the first viewport (above the fold).
      const heroLoc = page.locator(site.hero).filter({ visible: true }).first();
      const useSelector = (await heroLoc.count()) > 0;
      if (!useSelector) note(testInfo, `hero selector matched nothing; using the first viewport instead`);
      const target = useSelector ? heroLoc : page;
      const outcome = await snapshot(testInfo, target, page, site, [site.key, 'hero.png'], { fullPage: false, mask: masks(page, site), maxDiffPixelRatio: 0.001 });
      metric(testInfo, { outcome, heroSelectorMatched: useSelector });
    });

    test(tag('VR-04', site), async ({ page }, testInfo) => {
      const outcome = {};
      for (const p of pagesFor(site)) {
        await prepareForVisual(page, site, pageUrl(site, p));
        for (const region of ['header', 'footer']) {
          const loc = page.locator(site[region]).first();
          if (!(await loc.isVisible().catch(() => false))) {
            outcome[`${p.key}/${region}`] = 'missing';
            continue;
          }
          await loc.scrollIntoViewIfNeeded().catch(() => {});
          outcome[`${p.key}/${region}`] = await snapshot(testInfo, loc, page, site, [site.key, `${p.key}-${region}.png`], { mask: masks(page, site), maxDiffPixels: 0 });
        }
      }
      const failed = Object.keys(outcome).filter((k) => outcome[k] === 'fail');
      const missing = Object.keys(outcome).filter((k) => outcome[k] === 'missing');
      metric(testInfo, { regions: Object.keys(outcome).length, diffs: failed.length, missing: missing.length });
      expect(missing, `header/footer not visible on: ${missing.join(', ')}`).toEqual([]);
    });

    test(tag('VR-05', site), async ({ page }, testInfo) => {
      const problems = [];
      for (const p of pagesFor(site)) {
        await prepareForVisual(page, site, pageUrl(site, p));
        const boxes = {};
        const probes = { nav: site.header, h1: 'h1', cta: site.ctas, footer: site.footer };
        for (const [name, sel] of Object.entries(probes)) {
          if (!sel) continue; // e.g. a site without button-style CTAs
          const b = await page.locator(sel).first().boundingBox().catch(() => null);
          boxes[name] = b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null;
        }
        const r = compareOrCapture(testInfo, 'layout', testInfo.project.name, site.key, p.key, boxes, (base, cur) => {
          const d = [];
          for (const name of Object.keys(base)) {
            const a = base[name];
            const b = cur[name];
            if (!a && !b) continue;
            if (!a || !b) {
              // CTAs are often injected late by page builders; only structural elements count when they come and go.
              if (name !== 'cta') d.push(`${name}: ${a ? 'disappeared' : 'appeared'}`);
              continue;
            }
            const dx = Math.abs(a.x - b.x);
            const dy = Math.abs(a.y - b.y);
            if (dx > 10 || dy > 10) d.push(`${name}: moved ${dx}px horizontally, ${dy}px vertically (was ${a.x},${a.y} now ${b.x},${b.y})`);
          }
          return d;
        });
        if (r.diffs && r.diffs.length) problems.push(`${p.key}: ${r.diffs.join('; ')}`);
      }
      metric(testInfo, { pagesShifted: problems.length });
      expect(problems, problems.join('\n')).toEqual([]);
    });

    test(tag('VR-06', site), async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'desktop only');
      const changes = {};
      for (const p of pagesFor(site)) {
        await prepareForVisual(page, site, pageUrl(site, p));
        const lines = await page.evaluate((selectors) => {
          const hidden = [];
          for (const sel of selectors) {
            try {
              for (const el of document.querySelectorAll(sel)) {
                hidden.push([el, el.style.display]);
                el.style.display = 'none';
              }
            } catch {
              /* bad selector */
            }
          }
          const text = document.body.innerText || '';
          for (const [el, d] of hidden) el.style.display = d;
          return text
            .split('\n')
            .map((l) => l.replace(/\s+/g, ' ').trim())
            .filter((l) => l.length > 1 && !/^[\d\s,.%$#+()-]+$/.test(l)); // skip counters and prices that change daily
        }, [...DEFAULT_MASKS, ...(site.masks || [])]);
        const r = compareOrCapture(testInfo, 'text', testInfo.project.name, site.key, p.key, lines, (baseAll, cur) => {
          const base = baseAll.filter((l) => !/^[\d\s,.%$#+()-]+$/.test(l)); // older baselines may still hold counters
          const b = new Set(base);
          const c = new Set(cur);
          const removed = base.filter((l) => !c.has(l));
          const added = cur.filter((l) => !b.has(l));
          return [...removed.map((l) => `- ${l.slice(0, 120)}`), ...added.map((l) => `+ ${l.slice(0, 120)}`)];
        });
        if (r.diffs && r.diffs.length) changes[p.key] = r.diffs.slice(0, 30);
      }
      metric(testInfo, { pagesChanged: Object.keys(changes).length });
      expect(Object.keys(changes), `text changed:\n${JSON.stringify(changes, null, 2)}`).toEqual([]);
    });

    test(tag('VR-07', site), async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'desktop only');
      setUrl(testInfo, site.baseUrl);
      await prepareForVisual(page, site, site.baseUrl);
      const probe = site.styleProbe || {};
      const styles = await page.evaluate((probe) => {
        const pick = (sel, props) => {
          const el = sel && document.querySelector(sel);
          if (!el) return null;
          const cs = getComputedStyle(el);
          const out = {};
          for (const p of props) out[p] = cs[p];
          return out;
        };
        return {
          font: pick(probe.font, ['fontFamily', 'fontSize']),
          primary: pick(probe.primary, ['color', 'fontFamily', 'fontWeight']),
          button: pick(probe.button, ['backgroundColor', 'color', 'borderRadius', 'fontFamily']),
        };
      }, probe);
      const r = compareOrCapture(testInfo, 'styles', testInfo.project.name, site.key, 'home', styles, (base, cur) => {
        const d = [];
        for (const k of Object.keys(base)) {
          const a = JSON.stringify(base[k]);
          const b = JSON.stringify(cur[k]);
          if (a !== b) d.push(`${k}: ${a} -> ${b}`);
        }
        return d;
      });
      metric(testInfo, { styles });
      expect(r.diffs || [], `styling drift:\n${(r.diffs || []).join('\n')}`).toEqual([]);
    });

    test(tag('VR-08', site), async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'desktop only');
      setUrl(testInfo, site.baseUrl);
      await prepareForVisual(page, site, site.baseUrl);
      const missing = [];
      for (const sel of site.sections || []) {
        const loc = page.locator(sel).first();
        if ((await loc.count()) === 0) {
          missing.push(`${sel}: not found`);
          continue;
        }
        const nonEmpty = await loc.evaluate((el) => (el.innerText || '').trim().length > 0 || el.querySelector('img, svg, video, picture') !== null);
        if (!nonEmpty) missing.push(`${sel}: empty`);
      }
      metric(testInfo, { sections: (site.sections || []).length, missing: missing.length });
      expect(missing, missing.join('\n')).toEqual([]);
    });
  });
}
