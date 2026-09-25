// AV-08: every URL in the site's sitemap(s) responds. HTTP only, no browser,
// so thousands of URLs (blog posts, affiliate program pages) are checked in a
// few minutes. Broken URLs are listed in the report; the full list of results
// is saved as an attachment.
//
// Env: SITEMAP_MAX (default 6000 URLs per site), SITEMAP_CONCURRENCY (12),
//      SITEMAP_SKIP=true to skip the check.

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { activeSites } = require('../config/sites');
const { timedFetch } = require('../src/lib/http');
const { tag, setSeverity, metric, note, url: setUrl } = require('../src/lib/results');

const MAX = Number(process.env.SITEMAP_MAX || 6000);
const CONCURRENCY = Number(process.env.SITEMAP_CONCURRENCY || 12);

async function sitemapUrls(base) {
  const robots = await timedFetch(`${base}/robots.txt`, { redirect: 'follow' });
  const declared = [...robots.text.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  const queue = declared.length ? declared : [`${base}/sitemap.xml`, `${base}/sitemap_index.xml`, `${base}/wp-sitemap.xml`];
  const seen = new Set();
  const urls = new Set();
  const sitemaps = [];
  while (queue.length && urls.size < MAX) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    const res = await timedFetch(sm, { redirect: 'follow', timeout: 30000 });
    if (res.status !== 200) continue;
    sitemaps.push(sm);
    const locs = [...res.text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1].trim());
    if (/<sitemapindex/i.test(res.text)) queue.push(...locs);
    else for (const u of locs) urls.add(u);
  }
  return { urls: [...urls].slice(0, MAX), sitemaps };
}

for (const site of activeSites()) {
  test.describe(site.key, () => {
    test(tag('AV-08', site, 'Sitemap URLs respond'), async ({}, testInfo) => {
      test.skip(/^true$/i.test(process.env.SITEMAP_SKIP || ''), 'SITEMAP_SKIP=true');
      testInfo.setTimeout(25 * 60 * 1000);
      const base = site.baseUrl.replace(/\/$/, '');
      setUrl(testInfo, `${base}/robots.txt`);
      const { urls, sitemaps } = await sitemapUrls(base);
      expect(urls.length, 'no URLs found in any sitemap').toBeGreaterThan(0);

      const results = [];
      const queue = [...urls];
      const started = Date.now();
      const worker = async () => {
        while (queue.length) {
          const u = queue.shift();
          let res = await timedFetch(u, { method: 'HEAD', redirect: 'follow', timeout: 20000 });
          // Some servers reject HEAD; confirm with GET before calling it broken.
          if (res.status === 0 || res.status === 405 || res.status >= 500) res = await timedFetch(u, { redirect: 'follow', timeout: 20000 });
          results.push({ url: u, status: res.status, ms: res.ms, error: res.error });
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));

      const broken = results.filter((r) => r.status === 0 || r.status >= 400);
      const slow = results.filter((r) => r.status === 200 && r.ms > 5000).length;
      const pct = (broken.length / results.length) * 100;
      const file = path.join(testInfo.outputDir, `sitemap-${site.key}.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ sitemaps, checked: results.length, broken, slow, results }, null, 2));
      await testInfo.attach(`sitemap-${site.key}.json`, { path: file, contentType: 'application/json' });

      metric(testInfo, { sitemaps: sitemaps.length, urlsChecked: results.length, broken: broken.length, brokenPct: Math.round(pct * 100) / 100, slow, seconds: Math.round((Date.now() - started) / 1000) });
      note(testInfo, `${results.length} sitemap URLs checked in ${Math.round((Date.now() - started) / 1000)} s (${sitemaps.length} sitemap files)`);
      // More than 1 % broken, or 10+ pages: treat as High; a handful is Medium.
      setSeverity(testInfo, broken.length >= 10 || pct > 1 ? 'high' : 'medium');
      const sample = broken.slice(0, 15).map((b) => `${b.status || b.error} ${b.url}`);
      expect(broken.length, `${broken.length} of ${results.length} sitemap URLs broken (${pct.toFixed(2)}%): ${sample.join('; ')}${broken.length > 15 ? ` (+${broken.length - 15} more in sitemap-${site.key}.json)` : ''}`).toBe(0);
    });
  });
}
