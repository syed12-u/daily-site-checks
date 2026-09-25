// AV-01 .. AV-07: availability and response. Pure HTTP/TLS/DNS, no browser.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { activeSites } = require('../config/sites');
const { timedFetch, followRedirects, certInfo, resolveDns, hostOf } = require('../src/lib/http');
const { tag, setSeverity, metric, note, url: setUrl, STATE_DIR, readJson, writeJson } = require('../src/lib/results');

const DNS_STATE = path.join(STATE_DIR, 'dns.json');
const pageUrl = (site, p) => new URL(p.path, site.baseUrl).toString();

for (const site of activeSites()) {
  test.describe(site.key, () => {
    test(tag('AV-01', site), async ({}, testInfo) => {
      setUrl(testInfo, site.baseUrl);
      const res = await timedFetch(site.baseUrl, { redirect: 'follow', timeout: 5000 });
      metric(testInfo, { responseMs: res.ms, status: res.status });
      expect(res.error, `request failed: ${res.error}`).toBeUndefined();
      expect(res.status, `expected HTTP 200, got ${res.status}`).toBe(200);
      expect(res.url.startsWith('https://'), `final URL is not HTTPS: ${res.url}`).toBe(true);
      expect(res.ms, `responded in ${res.ms} ms (limit 5000 ms)`).toBeLessThan(5000);
    });

    test(tag('AV-02', site), async ({}, testInfo) => {
      const failures = [];
      const statuses = {};
      for (const p of site.pages) {
        const u = pageUrl(site, p);
        const res = await timedFetch(u, { redirect: p.redirectTo ? 'manual' : 'follow' });
        statuses[p.key] = res.status;
        const want = p.expectStatus || (p.redirectTo ? 301 : 200);
        if (res.error) failures.push(`${p.key} ${u}: ${res.error}`);
        else if (res.status !== want) failures.push(`${p.key} ${u}: expected ${want}, got ${res.status}`);
        else if (p.redirectTo) {
          const target = res.location ? new URL(res.location, u).toString() : '';
          const wanted = new URL(p.redirectTo, site.baseUrl).toString();
          if (target !== wanted) failures.push(`${p.key} ${u}: redirects to ${target}, expected ${wanted}`);
        }
      }
      metric(testInfo, { pagesChecked: site.pages.length, pagesFailed: failures.length, statuses });
      setSeverity(testInfo, failures.length > 1 ? 'critical' : 'high');
      expect(failures, failures.join('\n')).toEqual([]);
    });

    test(tag('AV-03', site), async ({}, testInfo) => {
      const canonical = hostOf(site.baseUrl);
      const alt = canonical.startsWith('www.') ? canonical.slice(4) : `www.${canonical}`;
      const variants = [`http://${canonical}/`, `http://${alt}/`, `https://${alt}/`];
      const failures = [];
      const chains = {};
      for (const v of variants) {
        const { chain, final, status, tooMany } = await followRedirects(v);
        chains[v] = chain.map((c) => `${c.status || c.error}${c.location ? ' -> ' + c.location : ''}`).join(' | ');
        const finalOrigin = (() => {
          try {
            return new URL(final).origin;
          } catch {
            return final;
          }
        })();
        if (tooMany) failures.push(`${v}: too many redirects`);
        else if (chain[0].error) failures.push(`${v}: ${chain[0].error}`);
        else if (finalOrigin !== new URL(site.baseUrl).origin || status !== 200) failures.push(`${v}: ends at ${final} (${status}), expected ${site.baseUrl}/`);
        else {
          const bad = chain.filter((c) => c.status >= 300 && c.status < 400 && ![301, 308].includes(c.status));
          if (bad.length) failures.push(`${v}: uses ${bad.map((b) => b.status).join(',')} redirect(s), expected 301`);
        }
      }
      metric(testInfo, { chains });
      expect(failures, failures.join('\n')).toEqual([]);
    });

    test(tag('AV-04', site), async ({}, testInfo) => {
      const host = hostOf(site.baseUrl);
      const info = await certInfo(host);
      metric(testInfo, { daysLeft: info.daysLeft, validTo: info.validTo, issuer: info.issuer });
      expect(info.error, `TLS error: ${info.error}`).toBeUndefined();
      if (info.daysLeft < 0 || !info.authorized) setSeverity(testInfo, 'critical');
      else if (info.daysLeft < 14) setSeverity(testInfo, 'high');
      expect(info.authorized, `certificate chain not trusted: ${info.authError}`).toBe(true);
      expect(info.daysLeft, `certificate expires in ${info.daysLeft} days (${info.validTo})`).toBeGreaterThanOrEqual(14);
    });

    test(tag('AV-05', site), async ({}, testInfo) => {
      const host = hostOf(site.baseUrl);
      const now = await resolveDns(host);
      metric(testInfo, { a: now.a, aaaa: now.aaaa });
      expect(now.a.length + now.aaaa.length, `no A/AAAA records for ${host}`).toBeGreaterThan(0);

      const state = readJson(DNS_STATE, {});
      const known = state[site.key];
      if (!known || process.env.UPDATE_DNS === site.key || process.env.UPDATE_DNS === 'all') {
        state[site.key] = { a: now.a, aaaa: now.aaaa, since: new Date().toISOString() };
        writeJson(DNS_STATE, state);
        note(testInfo, `DNS baseline captured: ${[...now.a, ...now.aaaa].join(', ')}`);
        return;
      }
      const allowed = new Set([...(known.a || []), ...(known.aaaa || []), ...((site.dns && site.dns.allowedIps) || [])]);
      const newIps = [...now.a, ...now.aaaa].filter((ip) => !allowed.has(ip));
      expect(
        newIps,
        `DNS changed for ${host}: new IP(s) ${newIps.join(', ')}; previously ${[...allowed].join(', ')} (since ${known.since}). ` +
          `If intended run: npm run approve ${site.key} dns`
      ).toEqual([]);
    });

    test(tag('AV-06', site), async ({}, testInfo) => {
      const u = `${site.baseUrl.replace(/\/$/, '')}/sentinel-404-check-${Date.now()}`;
      setUrl(testInfo, u);
      const res = await timedFetch(u, { redirect: 'follow' });
      metric(testInfo, { status: res.status, bytes: res.text.length });
      expect(res.status, `expected 404, got ${res.status}`).toBe(404);
      const generic = /<center>\s*<h1>\s*404 Not Found\s*<\/h1>|<title>404 Not Found<\/title>|Apache\/|IIS Web Core|<title>Error<\/title>/i.test(res.text);
      const branded = site.notFoundText.test(res.text) && res.text.length > 800 && !generic;
      expect(branded, `404 page does not look branded (length ${res.text.length}, generic server page: ${generic})`).toBe(true);
    });

    test(tag('AV-07', site), async ({}, testInfo) => {
      const base = site.baseUrl.replace(/\/$/, '');
      const robots = await timedFetch(`${base}/robots.txt`, { redirect: 'follow' });
      expect(robots.status, `robots.txt returned ${robots.status}`).toBe(200);

      // Parse the "User-agent: *" group and make sure it does not block everything.
      const lines = robots.text.split(/\r?\n/).map((l) => l.trim());
      let inStar = false;
      let blocksAll = false;
      const sitemaps = [];
      for (const line of lines) {
        const ua = line.match(/^user-agent:\s*(.+)$/i);
        if (ua) inStar = ua[1].trim() === '*';
        else if (inStar && /^disallow:\s*\/\s*$/i.test(line)) blocksAll = true;
        const sm = line.match(/^sitemap:\s*(\S+)/i);
        if (sm) sitemaps.push(sm[1]);
      }
      expect(blocksAll, 'robots.txt blocks the whole site for User-agent: *').toBe(false);

      const candidates = sitemaps.length ? sitemaps : [`${base}/sitemap.xml`, `${base}/sitemap_index.xml`, `${base}/sitemap-index.xml`];
      let found = null;
      const tried = [];
      for (const c of candidates) {
        const res = await timedFetch(c, { redirect: 'follow' });
        tried.push(`${c} -> ${res.status || res.error}`);
        if (res.status === 200 && /<(urlset|sitemapindex)[\s>]/i.test(res.text)) {
          found = c;
          break;
        }
      }
      metric(testInfo, { sitemap: found, sitemapsDeclared: sitemaps.length });
      expect(found, `no valid sitemap found. Tried: ${tried.join('; ')}`).not.toBeNull();
    });
  });
}
