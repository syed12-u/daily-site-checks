// ER-01 .. ER-06: hidden errors on key pages.
const { test, expect } = require('@playwright/test');
const { activeSites } = require('../config/sites');
const { timedFetch } = require('../src/lib/http');
const { collect, gotoStable, dismissBanners } = require('../src/lib/page');
const { tag, metric, note, url: setUrl } = require('../src/lib/results');

const pageUrl = (site, p) => new URL(p.path, site.baseUrl).toString();

// Console noise that is not a real JS error on our side.
const IGNORED_CONSOLE = /Failed to load resource|net::ERR_BLOCKED_BY_CLIENT|third-party cookie|deprecat|\[Report Only\]|preload/i;

// Text that should never be visible to a visitor.
const BAD_TEXT = [
  { name: 'Lorem ipsum', re: /\blorem ipsum\b/i },
  { name: 'undefined', re: /\bundefined\b/ },
  { name: 'null', re: /(^|\s)null(\s|$|[.,])/ },
  { name: 'NaN', re: /\bNaN\b/ },
  { name: '[object Object]', re: /\[object Object\]/ },
  { name: 'Unrendered template', re: /\{\{[^}]+\}\}|<%[^%]+%>/ },
  { name: 'PHP/JS error', re: /\b(Fatal error|Parse error|Warning: |Notice: |Uncaught (Type|Reference)?Error|Traceback \(most recent)/ },
  { name: 'Stack trace', re: /\bat \w[\w.$<>]* \([^)]*:\d+:\d+\)/ },
  { name: 'Error', re: /\bError\b(?! (404|page))/ },
  { name: 'Placeholder', re: /\b(TODO|FIXME|placeholder text|coming soon\.{3})\b/i },
];

for (const site of activeSites()) {
  test.describe(site.key, () => {
    test(tag('ER-01', site), async ({ page }, testInfo) => {
      const data = collect(page, site);
      const perPage = {};
      for (const p of site.pages) {
        data.consoleErrors.length = 0;
        data.pageErrors.length = 0;
        await gotoStable(page, pageUrl(site, p));
        await dismissBanners(page, site);
        await page.waitForTimeout(1000);
        const errs = [...data.pageErrors, ...data.consoleErrors.filter((e) => !IGNORED_CONSOLE.test(e))];
        if (errs.length) perPage[p.key] = [...new Set(errs)].slice(0, 10);
      }
      const failing = Object.keys(perPage);
      metric(testInfo, { pagesWithErrors: failing.length });
      expect(failing, `${failing.length} page(s) affected: ${failing.join(', ')}\n${JSON.stringify(perPage, null, 2)}`).toEqual([]);
    });

    test(tag('ER-02', site), async ({ page }, testInfo) => {
      const data = collect(page, site);
      const perPage = {};
      for (const p of site.pages) {
        data.failedRequests.length = 0;
        await gotoStable(page, pageUrl(site, p));
        await page.waitForTimeout(500);
        if (data.failedRequests.length) perPage[p.key] = [...new Set(data.failedRequests)].slice(0, 15);
      }
      const failing = Object.keys(perPage);
      metric(testInfo, { pagesWithFailedRequests: failing.length });
      expect(failing, `${failing.length} page(s) affected: ${failing.join(', ')}\n${JSON.stringify(perPage, null, 2)}`).toEqual([]);
    });

    test(tag('ER-03', site), async ({ page }, testInfo) => {
      const data = collect(page, site);
      const perPage = {};
      for (const p of site.pages) {
        data.mixedContent.length = 0;
        await gotoStable(page, pageUrl(site, p));
        // Also catch http:// URLs in the DOM that the browser may have upgraded or blocked.
        const inDom = await page.evaluate(() =>
          [...document.querySelectorAll('[src^="http://"], [href^="http://"][rel="stylesheet"], iframe[src^="http://"]')].map((e) => e.src || e.href).slice(0, 20)
        );
        const all = [...new Set([...data.mixedContent, ...inDom])];
        if (all.length) perPage[p.key] = all.slice(0, 15);
      }
      const failing = Object.keys(perPage);
      metric(testInfo, { pagesWithMixedContent: failing.length });
      expect(failing, `${failing.length} page(s) affected: ${failing.join(', ')}\n${JSON.stringify(perPage, null, 2)}`).toEqual([]);
    });

    test(tag('ER-04', site), async ({ page }, testInfo) => {
      const perPage = {};
      for (const p of site.pages) {
        await gotoStable(page, pageUrl(site, p));
        await dismissBanners(page, site);
        const text = await page.evaluate(() => document.body.innerText || '');
        const hits = [];
        for (const { name, re } of BAD_TEXT) {
          const m = text.match(re);
          if (m) {
            const i = m.index;
            hits.push(`${name}: "...${text.slice(Math.max(0, i - 40), i + 60).replace(/\s+/g, ' ')}..."`);
          }
        }
        if (hits.length) perPage[p.key] = hits;
      }
      const failing = Object.keys(perPage);
      metric(testInfo, { pagesWithBadText: failing.length });
      expect(failing, `${failing.length} page(s) affected: ${failing.join(', ')}\n${JSON.stringify(perPage, null, 2)}`).toEqual([]);
    });

    test(tag('ER-05', site), async ({ page }, testInfo) => {
      const problems = [];
      for (const p of site.pages) {
        await gotoStable(page, pageUrl(site, p));
        const title = (await page.title()).trim();
        // Brand is required in the homepage title; inner pages only need a real title.
        if (p.key === 'home') {
          const titleOk = site.titlePattern ? site.titlePattern.test(title) : title.toLowerCase().includes(site.name.toLowerCase());
          if (!titleOk) problems.push(`home: title "${title}" does not contain "${site.titlePattern || site.name}"`);
        } else if (!title || /^(untitled|page not found|404)/i.test(title)) {
          problems.push(`${p.key}: bad title "${title}"`);
        }
        const h1s = await page.locator('h1').count();
        if (h1s === 0) problems.push(`${p.key}: no <h1>`);
        if (p.key === 'home') {
          const text = await page.evaluate(() => document.body.innerText || '');
          for (const phrase of site.keyPhrases || []) {
            if (!text.toLowerCase().includes(phrase.toLowerCase())) problems.push(`home: key phrase "${phrase}" not visible`);
          }
        }
      }
      metric(testInfo, { problems: problems.length });
      expect(problems, problems.join('\n')).toEqual([]);
    });

    test(tag('ER-06', site), async ({}, testInfo) => {
      setUrl(testInfo, site.baseUrl);
      const res = await timedFetch(site.baseUrl, { redirect: 'follow' });
      const h = (n) => res.headers.get(n);
      const present = {
        hsts: !!h('strict-transport-security'),
        xcto: (h('x-content-type-options') || '').toLowerCase() === 'nosniff',
        frame: !!h('x-frame-options') || /frame-ancestors/i.test(h('content-security-policy') || ''),
        csp: !!h('content-security-policy'),
      };
      metric(testInfo, present);
      const missing = [];
      if (!present.hsts) missing.push('Strict-Transport-Security');
      if (!present.xcto) missing.push('X-Content-Type-Options: nosniff');
      if (!present.frame) missing.push('X-Frame-Options or CSP frame-ancestors');
      if (!present.csp) note(testInfo, 'No Content-Security-Policy header (informational)');
      expect(missing, `missing security headers: ${missing.join(', ')}`).toEqual([]);
    });
  });
}
