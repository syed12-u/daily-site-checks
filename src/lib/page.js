// Browser-side helpers: error collectors, stable navigation, masking for
// screenshots, cookie banner dismissal, lazy-load scrolling.

const DEFAULT_MASKS = [
  '[id*="cookie" i]',
  '[class*="cookie" i]',
  '[id*="consent" i]',
  '[class*="consent" i]',
  '[id*="chat" i]',
  '[class*="chat-widget" i]',
  'iframe[src*="chat" i]',
  'iframe[src*="intercom" i]',
  'iframe[src*="hubspot" i]',
  '[class*="carousel" i]',
  '[class*="slider" i]',
  '[class*="swiper" i]',
  '[class*="marquee" i]',
  'video',
  'ins.adsgoogle, ins.adsbygoogle, [id*="ad-slot" i], [class*="ad-slot" i]',
  'time, [datetime]',
];

const FREEZE_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
  }
  html { scrollbar-width: none !important; }
  ::-webkit-scrollbar { display: none !important; }
`;

function isFirstParty(url, site) {
  try {
    const h = new URL(url).hostname;
    return h === site.domain || h.endsWith('.' + site.domain);
  } catch {
    return false;
  }
}

/**
 * Attach listeners that collect console errors, failed first-party requests,
 * mixed content and request/byte counts for the page's lifetime.
 */
function collect(page, site) {
  const data = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    mixedContent: [],
    requests: 0,
    bytes: 0,
    urls: [],
  };
  page.on('console', (m) => {
    if (m.type() === 'error') data.consoleErrors.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => data.pageErrors.push(String(e.message || e).slice(0, 300)));
  page.on('request', (r) => {
    const u = r.url();
    data.requests++;
    data.urls.push(u);
    if (u.startsWith('http://') && page.url().startsWith('https://')) data.mixedContent.push(u);
  });
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() >= 400 && isFirstParty(u, site)) data.failedRequests.push(`${r.status()} ${u}`);
  });
  page.on('requestfinished', async (r) => {
    try {
      const s = await r.sizes();
      data.bytes += (s.responseBodySize || 0) + (s.responseHeadersSize || 0);
    } catch {
      /* request may be gone */
    }
  });
  page.on('requestfailed', (r) => {
    const txt = (r.failure() && r.failure().errorText) || '';
    if (/ERR_ABORTED|ERR_BLOCKED_BY_CLIENT/.test(txt)) return;
    if (isFirstParty(r.url(), site)) data.failedRequests.push(`FAILED ${r.url()} (${txt})`);
  });
  return data;
}

/** Navigate, wait for fonts and network to settle. Returns the main response. */
async function gotoStable(page, url, { waitUntil = 'load', timeout = 45000 } = {}) {
  const res = await page.goto(url, { waitUntil, timeout });
  await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await dismissBanners(page, null); // consent UI never gets in the way of a check
  return res;
}

/** Disable animations/transitions and hide scrollbars before screenshots. */
async function freeze(page) {
  await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
}

// Accept buttons of the common consent tools (HubSpot, OneTrust, Cookiebot,
// CookieYes, Cookie Notice, Cookie Law Info, cookieconsent, GDPR CMP).
const CONSENT_ACCEPT = [
  '#hs-eu-confirmation-button',
  '#onetrust-accept-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#CybotCookiebotDialogBodyButtonAccept',
  '.cky-btn-accept',
  '#cookie_action_close_header',
  '.cc-btn.cc-allow, .cc-btn.cc-dismiss',
  '#cn-accept-cookie',
  '.cmplz-accept',
  'button:has-text("Accept All")',
  'button:has-text("Accept all")',
  'button:has-text("Allow all")',
  'button:has-text("I agree")',
  'button:has-text("Got it")',
  'button:has-text("Accept")',
  'a:has-text("Accept")',
].join(', ');

// Containers of those tools, hidden as a fallback when no button matched.
const CONSENT_HIDE_CSS = `
  #hs-eu-cookie-confirmation, #hs-banner-parent, #onetrust-consent-sdk, #onetrust-banner-sdk,
  #CybotCookiebotDialog, #CybotCookiebotDialogBodyUnderlay, .cky-consent-container, .cky-overlay,
  #cookie-law-info-bar, .cli-modal-backdrop, .cc-window, #cookie-notice, .cmplz-cookiebanner,
  [id*="cookie-banner" i], [class*="cookie-banner" i], [id*="cookie-notice" i], [class*="cookie-notice" i],
  [id*="cookieconsent" i], [class*="cookieconsent" i], [id*="cookie-consent" i], [class*="cookie-consent" i]
  { display: none !important; visibility: hidden !important; }
  body { overflow: auto !important; }
`;

/** Accept the cookie banner if present, then hide any consent UI that is left. */
async function dismissBanners(page, site) {
  const selectors = [site && site.cookieAccept, CONSENT_ACCEPT].filter(Boolean).join(', ');
  const btn = page.locator(selectors).first();
  try {
    if (await btn.isVisible({ timeout: 1500 })) {
      await btn.click({ timeout: 2000 });
      await page.waitForTimeout(400);
    }
  } catch {
    /* no banner or not clickable */
  }
  await page.addStyleTag({ content: CONSENT_HIDE_CSS }).catch(() => {});
}

/** First VISIBLE element matching `sel` (many themes keep hidden duplicates, e.g. a collapsed search form). */
function visible(root, sel) {
  return root.locator(sel).filter({ visible: true }).first();
}

/**
 * The contact form root: a visible <form> on the page, or the form inside a
 * HubSpot forms iframe. Returns a Locator (possibly inside a frame).
 */
async function contactForm(page, c) {
  const onPage = visible(page, c.form || 'form');
  if (await onPage.count()) return onPage;
  const hs = 'iframe[src*="hsforms"], iframe[id^="hs-form-iframe"]';
  for (let i = 0; i < 5; i++) {
    if (await page.locator(hs).count()) {
      const inFrame = page.frameLocator(hs).first().locator('form').first();
      if (await inFrame.count()) return inFrame;
    }
    await page.waitForTimeout(800);
  }
  return onPage;
}

/**
 * Make the search input visible: many themes hide it behind an icon. Tries the
 * configured toggle, then common toggle selectors. Returns the input locator.
 */
async function revealSearch(page, s) {
  let input = visible(page, s.input);
  if (await input.count()) return input;
  const toggles = [s.toggle, '[aria-label*="search" i]', 'button[class*="search" i]', 'a[class*="search" i]', '.search-toggle, .search-icon, [class*="search" i][class*="toggle" i], [class*="search" i][class*="icon" i]']
    .filter(Boolean)
    .join(', ');
  const toggle = visible(page, toggles);
  if (await toggle.count()) {
    await toggle.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
  input = visible(page, s.input);
  if (await input.count()) return input;
  // Last resort: a search results page via the WordPress ?s= convention.
  return page.locator(s.input).first();
}

/** Scroll through the page to trigger lazy-loaded images, then go back to top. */
async function scrollThrough(page, step = 700) {
  await page.evaluate(async (s) => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += s) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo(0, 0);
  }, step);
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
}

/** Locators of dynamic regions to mask in screenshots. */
function masks(page, site) {
  return [...DEFAULT_MASKS, ...(site.masks || [])].map((sel) => page.locator(sel));
}

/** Full preparation for a screenshot or visual check of one page. */
async function prepareForVisual(page, site, url) {
  const res = await gotoStable(page, url);
  await dismissBanners(page, site);
  await freeze(page);
  await scrollThrough(page);
  await page.waitForTimeout(250);
  return res;
}

module.exports = { DEFAULT_MASKS, isFirstParty, collect, gotoStable, freeze, dismissBanners, scrollThrough, masks, prepareForVisual, visible, contactForm, revealSearch };
