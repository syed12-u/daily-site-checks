# Bugs found during suite verification (24-25 Sep 2026)

Both caught by the daily suite on flexoffers.com and confirmed by hand.

## BUG-1: Uncaught JavaScript error "wp is not defined" on every page of flexoffers.com

- **Severity:** Medium (ER-01 Console errors). Affects all 10 monitored pages on every load.
- **Test case:** ER-01, `tests/errors.spec.js`
- **Environment:** Chrome 128 (Playwright Chromium), desktop 1440x900, 25 Sep 2026
- **Steps to reproduce:**
  1. Open https://www.flexoffers.com/ in Chrome.
  2. Press F12, open the Console tab, reload the page.
  3. Observe `ReferenceError: wp is not defined at wp-i18n-js-after:2:1`.
- **Expected:** no uncaught errors on page load.
- **Actual:** inline script `#wp-i18n-js-after` runs `wp.i18n.setLocaleData(...)` but WordPress `wp-i18n` is not loaded before it (script dependency missing, or an optimisation plugin defers/removes `wp-i18n`).
- **Impact:** any block/plugin relying on `wp.i18n` after this point fails silently; error shows in every visitor's console.
- **Screenshot:** `BUG-1-flexoffers-home-wp-not-defined.png`

## BUG-2: /advertisers/ page has no H1 heading

- **Severity:** Medium (ER-05 flags it High per plan; SEO and accessibility impact, no visual impact).
- **Test case:** ER-05 Expected content present, `tests/errors.spec.js`
- **Steps to reproduce:**
  1. Open https://www.flexoffers.com/advertisers/.
  2. Press F12, Console, run `document.querySelectorAll('h1').length`.
  3. Observe `0`. The hero title "The Advertiser Platform Powered by Trusted Partnerships" is an `<h2>`.
- **Expected:** exactly one H1 per page (every other monitored flexoffers.com page has one).
- **Actual:** hero heading rendered as H2; search engines and screen readers get no page-level heading.
- **Screenshot:** `BUG-2-flexoffers-advertisers-no-h1.png`

## Informational (Low, daily card only)

| Site | Finding | Check |
| --- | --- | --- |
| All four | Strict-Transport-Security missing; X-Content-Type-Options missing on perhaps, fusetwo, incubators; frame protection missing on fusetwo, incubators | ER-06 |
| flexoffers.com | Homepage title "Performance-Based Marketing" has no brand name | ER-05 |
| fusetwo.com | Uncaught "Cannot read properties of null (reading 'offsetHeight')" on 9 pages | ER-01 |
| flexoffers.com | Cookiebot dialog contains an unrendered placeholder link `[#DSR_FORM_URL#]` (hidden, not user-facing) | FN-01 (now excluded) |
