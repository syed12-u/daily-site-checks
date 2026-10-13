// FN-01 .. FN-09: critical functionality. Desktop project only.
const { test, expect } = require('@playwright/test');
const { activeSites } = require('../config/sites');
const { timedFetch } = require('../src/lib/http');
const { collect, gotoStable, dismissBanners, scrollThrough, isFirstParty, visible, contactForm, revealSearch } = require('../src/lib/page');
const { tag, metric, note, url: setUrl } = require('../src/lib/results');

const pageUrl = (site, p) => new URL(p.path, site.baseUrl).toString();
const FORM_SUBMIT = /^true$/i.test(process.env.ENABLE_FORM_SUBMIT || '');
// Bot walls (LinkedIn 999, Facebook 400, Cloudflare 403) still mean the site is reachable.
const REACHABLE_EXTERNAL = new Set([400, 401, 403, 405, 429, 999]);

async function checkLinks(urls, site, concurrency = 8) {
  const failures = [];
  const queue = [...urls];
  const worker = async () => {
    while (queue.length) {
      const u = queue.shift();
      const res = await timedFetch(u, { redirect: 'follow', timeout: 20000 });
      const internal = isFirstParty(u, site);
      const ok = res.status >= 200 && res.status < 400;
      if (internal && !ok) failures.push(`${u} -> ${res.status || res.error}`);
      else if (!internal && !ok && !REACHABLE_EXTERNAL.has(res.status)) failures.push(`${u} -> ${res.status || res.error} (external)`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return failures;
}

async function collectHrefs(page, selector, base) {
  // Only links a visitor can actually see; consent dialogs carry unrendered template links.
  const hrefs = await page.locator(selector).evaluateAll((els) =>
    els
      .filter((a) => {
        if (a.closest('#CybotCookiebotDialog, #onetrust-consent-sdk, #hs-eu-cookie-confirmation, [id*="cookie" i], [class*="cookie" i]')) return false;
        const r = a.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((a) => a.getAttribute('href'))
  );
  const out = new Set();
  for (const h of hrefs) {
    if (!h || /^(#|mailto:|tel:|javascript:|sms:)/i.test(h)) continue;
    try {
      const u = new URL(h, base);
      u.hash = '';
      if (/^https?:$/.test(u.protocol)) out.add(u.toString());
    } catch {
      /* invalid href */
    }
  }
  return [...out];
}

/** Fill a form from a { selector: value } map; returns the selectors that were not found. */
async function fillForm(page, form, fields) {
  const missing = [];
  for (const [sel, value] of Object.entries(fields)) {
    // Visible only: Gravity Forms and others add hidden honeypot inputs.
    const loc = form.locator(sel).filter({ visible: true }).first();
    if ((await loc.count()) === 0) {
      missing.push(sel);
      continue;
    }
    await loc.fill(value).catch(() => missing.push(sel));
  }
  return missing;
}

for (const site of activeSites()) {
  test.describe(site.key, () => {
    test(tag('FN-01', site), async ({ page }, testInfo) => {
      setUrl(testInfo, site.baseUrl);
      await gotoStable(page, site.baseUrl);
      // Every clickable link on the homepage (nav, footer and content), internal first, capped at 150.
      const all = await collectHrefs(page, 'a[href]', site.baseUrl);
      const internal = all.filter((u) => isFirstParty(u, site));
      const external = all.filter((u) => !isFirstParty(u, site));
      const links = [...internal, ...external].slice(0, 150);
      expect(links.length, 'no links found on the homepage').toBeGreaterThan(0);
      const failures = await checkLinks(links, site);
      metric(testInfo, { linksChecked: links.length, internal: internal.length, external: external.length, linksBroken: failures.length });
      expect(failures, `${failures.length} broken navigation link(s): ${failures.slice(0, 5).join('; ')}${failures.length > 5 ? ` (+${failures.length - 5} more)` : ''}`).toEqual([]);
    });

    test(tag('FN-02', site), async ({ page }, testInfo) => {
      const perPage = {};
      let total = 0;
      for (const p of site.pages) {
        await gotoStable(page, pageUrl(site, p));
        await scrollThrough(page);
        const broken = await page.evaluate(() =>
          [...document.images]
            .filter((img) => img.complete && img.naturalWidth === 0 && (img.currentSrc || img.src))
            .map((img) => img.currentSrc || img.src)
            .slice(0, 15)
        );
        total += await page.locator('img').count();
        if (broken.length) perPage[p.key] = broken;
      }
      metric(testInfo, { imagesChecked: total, pagesWithBroken: Object.keys(perPage).length });
      expect(Object.keys(perPage), `broken images on ${Object.keys(perPage).join(', ')}\n${JSON.stringify(perPage, null, 2)}`).toEqual([]);
    });

    test(tag('FN-03', site), async ({ page }, testInfo) => {
      test.skip(!site.contact, 'no contact form configured');
      const u = new URL(site.contact.path, site.baseUrl).toString();
      setUrl(testInfo, u);
      await test.step(`Open contact page ${u}`, async () => {
        await gotoStable(page, u);
        await dismissBanners(page, site);
      });
      const form = await test.step('Find the contact form (page form or HubSpot iframe)', () => contactForm(page, site.contact));
      await expect(form, 'contact form not visible').toBeVisible();
      await test.step('Check name, email and message fields exist', async () => {
        const missing = [];
        for (const sel of Object.keys(site.contact.fields)) {
          if ((await form.locator(sel).filter({ visible: true }).count()) === 0) missing.push(sel);
        }
        expect(missing, `form fields missing: ${missing.join(' | ')}`).toEqual([]);
      });
      await test.step('Check submit button is visible', async () => {
        await expect(form.locator(site.contact.submit).filter({ visible: true }).first(), 'submit button not visible').toBeVisible();
      });
    });

    test(tag('FN-04', site), async ({ page }, testInfo) => {
      test.skip(!site.contact, 'no contact form configured');
      test.skip(!FORM_SUBMIT, 'ENABLE_FORM_SUBMIT is not true (waiting for a safe test-mode submit per site)');
      const u = new URL(site.contact.path, site.baseUrl).toString();
      setUrl(testInfo, u);
      await gotoStable(page, u);
      await dismissBanners(page, site);
      const form = await contactForm(page, site.contact);
      const missing = await fillForm(page, form, site.contact.fields);
      expect(missing, `could not fill: ${missing.join(' | ')}`).toEqual([]);
      const tm = site.contact.testMode;
      if (tm && tm.hiddenField) {
        await form.locator(tm.hiddenField).evaluate((el, v) => (el.value = v), tm.value || '1');
      }
      const serverErrors = [];
      page.on('response', (r) => r.status() >= 500 && serverErrors.push(`${r.status()} ${r.url()}`));
      await form.locator(site.contact.submit).first().click();
      await expect(page.locator('body'), 'no success message after submit').toContainText(site.contact.successText, { timeout: 20000 });
      expect(serverErrors, `server errors during submit: ${serverErrors.join(', ')}`).toEqual([]);
    });

    test(tag('FN-05', site), async ({ page }, testInfo) => {
      test.skip(!site.search, 'search not configured for this site');
      const s = site.search;
      const u = new URL(s.path, site.baseUrl).toString();
      setUrl(testInfo, u);
      await test.step(`Open ${u}`, async () => {
        await gotoStable(page, u);
        await dismissBanners(page, site);
      });
      const input = await test.step('Reveal the search box', () => revealSearch(page, s));
      await expect(input, 'search input not visible (no search toggle found either)').toBeVisible();
      await test.step(`Search for "${s.term}"`, async () => {
        await input.fill(s.term);
        // Search result pages can be slow; wait for the navigation separately with a longer timeout.
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {}),
        input.press('Enter', { noWaitAfter: true }),
      ]);
      await page.waitForURL(/[?&]s=|search/i, { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      });

      // A WordPress fatal error page still renders the theme (and an <article>), so check for it explicitly.
      await test.step('Results page is not a server error', async () => {
        const body = await page.locator('body').innerText().catch(() => '');
        expect(body, `results page shows a server error at ${page.url()}`).not.toMatch(/critical error on this website|Fatal error|Internal Server Error|Error establishing a database connection/i);
      });
      const results = page.locator(s.results).filter({ visible: true });
      await test.step('Expect at least one result', async () => {
        await expect.poll(() => results.count(), { timeout: 15000, message: `no results for "${s.term}" at ${page.url()}` }).toBeGreaterThan(0);
      });
      metric(testInfo, { results: await results.count(), resultsUrl: page.url() });
    });

    test(tag('FN-06', site), async ({ page }, testInfo) => {
      test.skip(!site.login, 'login not configured for this site');
      const l = site.login;
      setUrl(testInfo, l.url);
      const serverErrors = [];
      page.on('response', (r) => r.status() >= 500 && serverErrors.push(`${r.status()} ${r.url()}`));
      const data = collect(page, site);
      // Portal is a single-page app whose "load" event can lag; DOM ready is enough.
      await test.step(`Open login page ${l.url}`, async () => {
        const res = await gotoStable(page, l.url, { waitUntil: 'domcontentloaded' });
        expect(res && res.status(), `login page returned ${res && res.status()}`).toBeLessThan(400);
        await dismissBanners(page, site);
      });
      await test.step('Check email and password fields render', async () => {
        await expect(visible(page, l.user), 'username field not visible').toBeVisible();
        await expect(visible(page, l.password), 'password field not visible').toBeVisible();
      });
      await test.step('Submit invalid credentials', async () => {
        await visible(page, l.user).fill('sentinel-invalid-user@example.com');
        await visible(page, l.password).fill('definitely-wrong-password-123');
        await visible(page, l.submit).click();
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      });
      await test.step('Expect an error message, no 500, no JS crash', async () => {
        await expect(page.locator('body'), 'no error message shown for invalid credentials').toContainText(l.errorText, { timeout: 15000 });
        expect(serverErrors, `5xx during login attempt: ${serverErrors.join(', ')}`).toEqual([]);
        expect(data.pageErrors, `JS errors on login page: ${data.pageErrors.join(' | ')}`).toEqual([]);
      });
    });

    test(tag('FN-07', site), async ({ page }, testInfo) => {
      test.skip(!site.signup, 'signup not configured for this site');
      const problems = [];
      for (const [kind, s] of Object.entries(site.signup)) {
        const res = await gotoStable(page, s.url);
        if (!res || res.status() >= 400) {
          problems.push(`${kind}: ${s.url} returned ${res && res.status()}`);
          continue;
        }
        await dismissBanners(page, site);
        for (const sel of s.requiredFields) {
          if ((await page.locator(sel).count()) === 0) problems.push(`${kind}: field "${sel}" missing`);
        }
        if ((await page.locator(s.submit).count()) === 0) problems.push(`${kind}: submit button missing`);
      }
      expect(problems, problems.join('\n')).toEqual([]);
    });

    test(tag('FN-08', site), async ({ page }, testInfo) => {
      test.skip(!site.embeds || !site.embeds.length, 'no embeds configured');
      setUrl(testInfo, site.baseUrl);
      const failed = [];
      page.on('requestfailed', (r) => {
        const txt = (r.failure() && r.failure().errorText) || '';
        if (!/ERR_ABORTED|ERR_BLOCKED_BY_CLIENT/.test(txt)) failed.push(`${r.url()} (${txt})`);
      });
      page.on('response', (r) => r.status() >= 400 && failed.push(`${r.url()} (${r.status()})`));
      const data = collect(page, site);
      await gotoStable(page, site.baseUrl);
      await page.waitForTimeout(2000);
      const problems = [];
      for (const e of site.embeds) {
        const loaded = data.urls.some((u) => e.urlPattern.test(u));
        const errored = failed.filter((u) => e.urlPattern.test(u));
        if (!loaded) problems.push(`${e.name}: no request matched ${e.urlPattern}`);
        else if (errored.length) problems.push(`${e.name}: failed ${errored.slice(0, 3).join(', ')}`);
      }
      expect(problems, problems.join('\n')).toEqual([]);
    });

    test(tag('FN-09', site), async ({ page }, testInfo) => {
      test.skip(!site.ctas, 'site has no button-style CTAs');
      setUrl(testInfo, site.baseUrl);
      await gotoStable(page, site.baseUrl);
      await dismissBanners(page, site);
      // Visible theme buttons in the page body (header/footer links are FN-01's job).
      const ctas = page.locator(site.ctas).filter({ visible: true });
      const n = await ctas.count();
      expect(n, `no visible CTAs matched "${site.ctas}" on the homepage`).toBeGreaterThan(0);
      const problems = [];
      const checked = [];
      for (let i = 0; i < Math.min(n, 8); i++) {
        const c = ctas.nth(i);
        if (await c.evaluate((el) => !!el.closest('header, footer, nav')).catch(() => true)) continue;
        const text = ((await c.innerText().catch(() => '')) || '').trim().slice(0, 40) || `#${i}`;
        if (!(await c.isEnabled()) || (await c.getAttribute('aria-disabled')) === 'true') problems.push(`"${text}" is disabled`);
        const href = await c.getAttribute('href');
        if (!href || /^(#|javascript:)/.test(href)) {
          problems.push(`"${text}" has no destination (href=${href})`);
          continue;
        }
        const u = new URL(href, site.baseUrl).toString();
        checked.push(u);
        const res = await timedFetch(u, { redirect: 'follow' });
        if (res.status !== 200) problems.push(`"${text}" -> ${u} returned ${res.status || res.error}`);
      }
      metric(testInfo, { ctasFound: n, ctasChecked: checked.length });
      expect(checked.length, 'no visible CTA with a link found').toBeGreaterThan(0);
      expect(problems, problems.join('\n')).toEqual([]);
    });
  });
}
