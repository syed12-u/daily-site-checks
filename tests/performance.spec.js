// PF-01 .. PF-05: performance of the homepage, with comparison to history.
const { test, expect } = require('@playwright/test');
const { activeSites } = require('../config/sites');
const { timedFetch } = require('../src/lib/http');
const { collect, gotoStable } = require('../src/lib/page');
const { tag, metric, note, url: setUrl, loadHistory, metricSeries, average } = require('../src/lib/results');

const LCP_INIT = () => {
  window.__lcp = 0;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    /* unsupported */
  }
};

const pct = (now, before) => (before ? Math.round(((now - before) / before) * 100) : 0);

for (const site of activeSites()) {
  test.describe(site.key, () => {
    test(tag('PF-01', site), async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'desktop only');
      setUrl(testInfo, site.baseUrl);
      await gotoStable(page, site.baseUrl);
      const nav = await page.evaluate(() => {
        const n = performance.getEntriesByType('navigation')[0];
        return n ? { ttfb: n.responseStart - n.requestStart, domLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd } : null;
      });
      expect(nav, 'no navigation timing available').not.toBeNull();
      const ttfb = Math.round(nav.ttfb);
      metric(testInfo, { ttfbMs: ttfb, domLoadedMs: Math.round(nav.domLoaded), loadMs: Math.round(nav.load) });
      expect(ttfb, `TTFB ${ttfb} ms (limit 800 ms)`).toBeLessThan(800);
    });

    test(tag('PF-02', site), async ({ page }, testInfo) => {
      const mobile = testInfo.project.name === 'mobile';
      const limit = mobile ? 4000 : 2500;
      setUrl(testInfo, site.baseUrl);
      await page.addInitScript(LCP_INIT);
      // Median of 3 loads: one slow packet on the runner's network should not fail the check.
      const samples = [];
      for (let i = 0; i < 3; i++) {
        await gotoStable(page, site.baseUrl);
        await page.waitForTimeout(2500);
        const v = Math.round(await page.evaluate(() => window.__lcp || 0));
        if (v > 0) samples.push(v);
      }
      samples.sort((a, b) => a - b);
      const lcp = samples.length ? samples[Math.floor(samples.length / 2)] : 0;
      metric(testInfo, { lcpMs: lcp, samples, viewport: testInfo.project.name });
      expect(lcp, 'LCP not reported by the browser').toBeGreaterThan(0);
      expect(lcp, `LCP ${lcp} ms on ${testInfo.project.name} (limit ${limit} ms)`).toBeLessThan(limit);
    });

    test(tag('PF-03', site), async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'desktop only');
      setUrl(testInfo, site.baseUrl);
      const data = collect(page, site);
      await gotoStable(page, site.baseUrl);
      await page.waitForTimeout(1500);
      const mb = data.bytes / 1024 / 1024;
      const prev = metricSeries(loadHistory(1), site.key, 'PF-03', 'bytes');
      const before = prev.length ? prev[prev.length - 1] : null;
      const increase = before ? pct(data.bytes, before) : 0;
      metric(testInfo, { bytes: data.bytes, mb: Math.round(mb * 100) / 100, increasePct: increase });
      if (!before) note(testInfo, 'no previous run to compare page weight against');
      expect(mb, `homepage weighs ${mb.toFixed(2)} MB (limit 3 MB)`).toBeLessThan(3);
      expect(increase, `page weight up ${increase}% since previous run (${(before / 1048576).toFixed(2)} MB -> ${mb.toFixed(2)} MB)`).toBeLessThanOrEqual(25);
    });

    test(tag('PF-04', site), async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'desktop only');
      setUrl(testInfo, site.baseUrl);
      const data = collect(page, site);
      await gotoStable(page, site.baseUrl);
      await page.waitForTimeout(1500);
      const prev = metricSeries(loadHistory(1), site.key, 'PF-04', 'requests');
      const before = prev.length ? prev[prev.length - 1] : null;
      const increase = before ? pct(data.requests, before) : 0;
      metric(testInfo, { requests: data.requests, increasePct: increase });
      if (!before) note(testInfo, 'no previous run to compare request count against');
      expect(increase, `request count up ${increase}% since previous run (${before} -> ${data.requests})`).toBeLessThanOrEqual(25);
    });

    test(tag('PF-05', site), async ({}, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'desktop only');
      setUrl(testInfo, site.baseUrl);
      // Three samples, keep the median, to avoid a single slow packet skewing the trend.
      const samples = [];
      for (let i = 0; i < 3; i++) {
        const r = await timedFetch(site.baseUrl, { redirect: 'follow' });
        if (!r.error) samples.push(r.ms);
      }
      expect(samples.length, 'homepage did not respond').toBeGreaterThan(0);
      samples.sort((a, b) => a - b);
      const today = samples[Math.floor(samples.length / 2)];
      const series = metricSeries(loadHistory(7), site.key, 'PF-05', 'responseMs');
      const avg = average(series);
      metric(testInfo, { responseMs: today, avg7dMs: avg ? Math.round(avg) : null, samples: series.length });
      if (series.length < 3) {
        note(testInfo, `trend needs 3+ days of history, have ${series.length}`);
        return;
      }
      const regression = pct(today, avg);
      expect(regression, `response time ${today} ms is ${regression}% above the 7-day average of ${Math.round(avg)} ms (limit 50%)`).toBeLessThanOrEqual(50);
    });
  });
}
