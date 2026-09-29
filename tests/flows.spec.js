// UF-01 .. UF-07: real user journeys. UF-07 runs on the mobile project, the
// rest on desktop.
const { test, expect } = require('@playwright/test');
const { activeSites } = require('../config/sites');
const { timedFetch } = require('../src/lib/http');
const { collect, gotoStable, dismissBanners, isFirstParty, visible, contactForm, revealSearch } = require('../src/lib/page');
const { tag, metric, note, url: setUrl } = require('../src/lib/results');

const FORM_SUBMIT = /^true$/i.test(process.env.ENABLE_FORM_SUBMIT || '');

/** Click the first visible nav link whose text matches `re`, falling back to `fallbackUrl`. */
async function clickNav(page, site, re, fallbackUrl, testInfo) {
  const link = page.locator(`${site.nav.links}`).filter({ hasText: re }).first();
  if (await link.isVisible().catch(() => false)) {
    await Promise.all([page.waitForLoadState('load').catch(() => {}), link.click()]);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    return true;
  }
  note(testInfo, `no visible nav link matching ${re}; navigated directly to ${fallbackUrl}`);
  await gotoStable(page, fallbackUrl);
  return false;
}

async function expectValidation(page, submitSel) {
  const submit = visible(page, submitSel);
  await expect(submit, 'no visible submit button on the signup form').toBeVisible();
  const before = page.url();
  await submit.click().catch(() => {});
  await page.waitForTimeout(1500);
  const invalid = await page.evaluate(() => document.querySelectorAll(':invalid, [aria-invalid="true"], .error, .is-invalid, .field-error, .wpcf7-not-valid').length);
  const errorText = await page.locator('body').innerText();
  const hasMessage = /required|please (fill|enter)|invalid|must be|cannot be (blank|empty)/i.test(errorText);
  const stayed = page.url().split('#')[0] === before.split('#')[0];
  return { ok: invalid > 0 || hasMessage || stayed, invalid, hasMessage, stayed };
}

for (const site of activeSites()) {
  test.describe(site.key, () => {
    test(tag('UF-01', site), async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'desktop only');
      test.skip(!site.contact, 'no contact form configured');
      const c = site.contact;
      setUrl(testInfo, site.baseUrl);
      await test.step('Open homepage', async () => {
        await gotoStable(page, site.baseUrl);
        await dismissBanners(page, site);
      });
      await test.step('Click "Contact" in the navigation', () => clickNav(page, site, c.navText, new URL(c.path, site.baseUrl).toString(), testInfo));
      const form = await test.step('Find the contact form', () => contactForm(page, c));
      await expect(form, 'contact form not visible after navigating').toBeVisible();
      await test.step('Fill name, email and message', async () => {
        for (const [sel, value] of Object.entries(c.fields)) {
          const loc = form.locator(sel).filter({ visible: true }).first(); // skip hidden honeypots
          await expect(loc, `field ${sel} missing`).toHaveCount(1);
          await loc.fill(value);
        }
      });
      const submit = form.locator(c.submit).filter({ visible: true }).first();
      await expect(submit, 'submit button not visible').toBeVisible();
      if (!FORM_SUBMIT) {
        note(testInfo, 'form filled but not submitted: ENABLE_FORM_SUBMIT is not true');
        return;
      }
      if (c.testMode && c.testMode.hiddenField) {
        await form.locator(c.testMode.hiddenField).evaluate((el, v) => (el.value = v), c.testMode.value || '1');
      }
      await submit.click();
      await expect(page.locator('body'), 'no success message after submit').toContainText(c.successText, { timeout: 20000 });
    });

    test(tag('UF-02', site), async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'desktop only');
      setUrl(testInfo, site.baseUrl);
      await test.step('Open homepage', async () => {
        await gotoStable(page, site.baseUrl);
        await dismissBanners(page, site);
      });
      const cta = page.locator(site.ctas).filter({ visible: true }).first();
      await expect(cta, `no visible primary CTA matched "${site.ctas}"`).toBeVisible();
      const href = await cta.getAttribute('href');
      const target = href ? new URL(href, site.baseUrl).toString() : null;
      expect(target, 'primary CTA has no href').not.toBeNull();
      await test.step(`Primary CTA "${((await cta.innerText().catch(() => '')) || '').trim().slice(0, 40)}" points to ${target}`, async () => {});
      if (!isFirstParty(target, site)) {
        const res = await timedFetch(target, { redirect: 'follow' });
        note(testInfo, `CTA points off-site to ${target} (${res.status})`);
        expect(res.status, `external landing page returned ${res.status || res.error}`).toBeLessThan(400);
        return;
      }
      const res = await test.step(`Open landing page ${target}`, () => gotoStable(page, target));
      metric(testInfo, { landing: target, status: res && res.status() });
      expect(res && res.status(), `landing page returned ${res && res.status()}`).toBe(200);
      await test.step('Landing page shows an H1 and a CTA', async () => {
        await expect(page.locator('h1').first(), 'landing page has no visible H1').toBeVisible();
        const landingCta = page.locator(`${site.ctas}, button[type="submit"], form button, form input[type="submit"]`).filter({ visible: true }).first();
        await expect(landingCta, 'landing page has no visible CTA').toBeVisible();
      });
    });

    for (const kind of ['publisher', 'advertiser']) {
      const id = kind === 'publisher' ? 'UF-03' : 'UF-04';
      test(tag(id, site), async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'desktop only');
        test.skip(!site.signup || !site.signup[kind], `${kind} signup not configured for this site`);
        const s = site.signup[kind];
        setUrl(testInfo, s.url);
        await gotoStable(page, site.baseUrl);
        await dismissBanners(page, site);
        await clickNav(page, site, s.navText, s.url, testInfo);
        // From the section page, follow a "sign up / join" link if there is one; otherwise go direct.
        const signupLink = page.locator('a').filter({ hasText: s.signupText }).filter({ visible: true }).first();
        if (await signupLink.isVisible().catch(() => false)) {
          await Promise.all([page.waitForLoadState('load').catch(() => {}), signupLink.click()]);
          await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        } else {
          note(testInfo, `no visible "${s.signupText}" link; navigated directly to ${s.url}`);
          await gotoStable(page, s.url);
        }
        for (const sel of s.requiredFields) await expect(page.locator(sel).first(), `required field ${sel} missing`).toBeVisible();
        const v = await expectValidation(page, s.submit);
        metric(testInfo, { invalidFields: v.invalid, validationMessage: v.hasMessage });
        expect(v.ok, 'submitting an empty form did not trigger validation').toBe(true);
      });
    }

    test(tag('UF-05', site), async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'desktop only');
      test.skip(!site.login, 'login not configured for this site');
      const l = site.login;
      setUrl(testInfo, l.url);
      const data = collect(page, site);
      const serverErrors = [];
      page.on('response', (r) => r.status() >= 500 && serverErrors.push(`${r.status()} ${r.url()}`));
      await test.step(`Open login page ${l.url}`, async () => {
        await gotoStable(page, l.url, { waitUntil: 'domcontentloaded' }); // SPA: load event can lag
        await dismissBanners(page, site);
      });
      await test.step('Type a wrong email and password, press Login', async () => {
        await visible(page, l.user).fill('sentinel-invalid-user@example.com');
        await visible(page, l.password).fill('definitely-wrong-password-123');
        await visible(page, l.submit).click();
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      });
      await test.step('Expect an error message and a still-usable form', async () => {
        await expect(page.locator('body'), 'no error shown for invalid credentials').toContainText(l.errorText, { timeout: 15000 });
        // Page stable: form still usable, no 5xx, no uncaught errors.
        await expect(visible(page, l.user), 'login form disappeared after failed attempt').toBeVisible();
        expect(serverErrors, `5xx during login attempt: ${serverErrors.join(', ')}`).toEqual([]);
        expect(data.pageErrors, `JS errors during login attempt: ${data.pageErrors.join(' | ')}`).toEqual([]);
      });
    });

    test(tag('UF-06', site), async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'desktop only');
      test.skip(!site.search || !site.search.resultLink, 'browse/search flow not configured for this site');
      const s = site.search;
      setUrl(testInfo, site.baseUrl);
      await gotoStable(page, site.baseUrl);
      await dismissBanners(page, site);
      if (s.path && s.path !== '/') await gotoStable(page, new URL(s.path, site.baseUrl).toString());
      const input = await revealSearch(page, s);
      await expect(input, 'search input not visible (no search toggle found either)').toBeVisible();
      await input.fill(s.term);
      await input.press('Enter');
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      const results = page.locator(s.results).filter({ visible: true });
      await expect.poll(() => results.count(), { timeout: 15000, message: 'no results' }).toBeGreaterThan(0);
      const first = page.locator(s.resultLink).filter({ visible: true }).first();
      await expect(first, 'no clickable result').toBeVisible();
      const href = await first.getAttribute('href');
      await Promise.all([page.waitForLoadState('load').catch(() => {}), first.click()]);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      metric(testInfo, { opened: page.url(), resultHref: href });
      await expect(page.locator('h1, h2').first(), 'opened result has no heading').toBeVisible();
    });

    test(tag('UF-07', site), async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile', 'mobile only');
      setUrl(testInfo, site.baseUrl);
      await gotoStable(page, site.baseUrl);
      await dismissBanners(page, site);
      const toggle = page.locator(site.nav.mobileToggle).filter({ visible: true }).first();
      await expect(toggle, `hamburger not visible (selector "${site.nav.mobileToggle}")`).toBeVisible();
      await toggle.click();
      await page.waitForTimeout(600);
      const menuLinks = page.locator(`${site.nav.mobileMenu} a[href]`).filter({ visible: true });
      await expect.poll(() => menuLinks.count(), { timeout: 5000, message: 'menu opened but no visible links' }).toBeGreaterThan(0);
      // First internal link that is not the current page.
      const n = await menuLinks.count();
      let target = null;
      let link = null;
      for (let i = 0; i < n; i++) {
        const href = await menuLinks.nth(i).getAttribute('href');
        if (!href || /^(#|mailto:|tel:|javascript:)/.test(href)) continue;
        const u = new URL(href, site.baseUrl).toString();
        if (isFirstParty(u, site) && u !== page.url()) {
          target = u;
          link = menuLinks.nth(i);
          break;
        }
      }
      expect(target, 'no internal link in the mobile menu').not.toBeNull();
      await Promise.all([page.waitForLoadState('load').catch(() => {}), link.click()]);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      metric(testInfo, { opened: page.url() });
      expect(page.url().split('#')[0], 'URL did not change after tapping a menu link').not.toBe(site.baseUrl + '/');
      await expect(page.locator('main, h1, [role="main"]').first(), 'target page has no main content').toBeVisible();
    });
  });
}
