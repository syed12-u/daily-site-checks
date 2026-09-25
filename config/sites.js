// Site configuration. One entry per monitored site.
//
// Page lists were pulled from each site's sitemap and homepage navigation on
// 24 Sep 2026. Fields marked TODO still need confirmation with the site owner
// (plan: Day 1). Scenarios whose config block is missing (login, search,
// signup, contact) are skipped with a reason instead of failing.
//
// Field reference
//   key           short id used in test titles, baselines and reports
//   name          brand text expected in <title> (ER-05); titlePattern overrides
//   domain        apex domain; used to decide first-party vs third-party requests
//   baseUrl       canonical origin, always https
//   pages[]       key pages: { key, path, expectStatus?, redirectTo? }
//   keyPhrases[]  phrases that must be visible on the homepage (ER-05)
//   sections[]    selectors that must be present and non-empty on the homepage (VR-08)
//   hero          selector for the above-the-fold hero region (VR-03)
//   header/footer selectors for component screenshots (VR-04)
//   nav           { links, mobileToggle, mobileMenu }
//   ctas          selector for primary CTAs on the homepage (FN-09, UF-02)
//   contact       { path, navText, form, fields: {selector: value}, submit, successText, testMode? }
//   search        { path, input, submit?, results, term, resultLink? }   (FN-05, UF-06)
//   login         { url, user, password, submit, errorText }             (FN-06, UF-05)
//   signup        { publisher: {...}, advertiser: {...} }                (FN-07, UF-03, UF-04)
//   embeds[]      { name, urlPattern } third-party scripts expected to load (FN-08)
//   masks[]       selectors hidden before screenshots (dynamic regions)
//   cookieAccept  selector of the cookie-banner accept button, clicked before checks
//   styleProbe    { font: selector, primary: selector, button: selector } (VR-07)
//   notFoundText  text expected on the branded 404 page (AV-06)

const TEST_EMAIL = process.env.TEST_EMAIL || 'sentinel-test@flexoffers.com';

// All four sites are WordPress; these selectors cover common WP/Elementor themes.
const WP = {
  nav: {
    links: 'header a[href], nav a[href], footer a[href]',
    mobileToggle:
      'button[aria-label*="menu" i], a[aria-label*="menu" i], [aria-label*="navigation" i], .hamburger, .menu-toggle, [class*="burger" i], [class*="hamburger" i], ' +
      '.elementor-menu-toggle, [aria-controls*="menu" i], [class*="menu" i][class*="toggle" i], [class*="menu" i][class*="btn" i], [class*="menu" i][class*="button" i], ' +
      '[class*="mobile" i][class*="toggle" i], [class*="nav" i][class*="toggle" i], header button:has(svg)',
    mobileMenu: 'nav, [role="navigation"], .elementor-nav-menu--dropdown, [class*="menu" i], [id*="menu" i]',
  },
  // Primary calls to action: theme buttons anywhere in the page body (header/footer links excluded in tests).
  ctas: 'a.elementor-button, a.elementor-button-link, a.btn, a.button, a[class*="btn" i], a[class*="button" i], a[class*="cta" i], a[role="button"], .hero a, [class*="hero" i] a',
  header: 'header, .elementor-location-header',
  footer: 'footer, .elementor-location-footer',
  hero: '.hero, [class*="hero" i], .elementor-location-header + *, main > *:first-child, header + section, header + div, [data-elementor-type="wp-page"] > *:first-child',
  sections: ['header, .elementor-location-header', 'main, #content, .site-content, [data-elementor-type="wp-page"]', 'footer, .elementor-location-footer', 'h1'],
  cookieAccept: 'button:has-text("Accept"), button:has-text("Agree"), a:has-text("Accept"), [id*="cookie" i] button, #hs-eu-confirmation-button',
  styleProbe: { font: 'body', primary: 'h1', button: 'a.elementor-button, a.btn, a.button, button' },
  notFoundText: /not found|404|page.*(doesn|does not|can.t).*(exist|be found)|oops/i,
  ga: { name: 'Google Tag Manager / Analytics', urlPattern: /googletagmanager\.com|google-analytics\.com/ },
  hubspot: { name: 'HubSpot', urlPattern: /hs-scripts\.com|hubspot\.com|hsforms\.net|hs-analytics\.net/ },
};

// Generic contact-form fields (WPForms / Gravity Forms / CF7 / HubSpot). TODO confirm per site.
// Gravity Forms names the first-name input "input_N.3" inside .name_first.
const NAME_FIELD =
  'input[name*="name" i]:not([name*="last" i]):not([name*="company" i]), input[id*="firstname" i], input[placeholder*="name" i], ' +
  'input[autocomplete="given-name"], .name_first input, input[aria-label*="first" i], input[name^="input_"][name$=".3"], input[name^="input_"][type="text"]';
const contactFields = {
  [NAME_FIELD]: 'Site Sentinel',
  'input[type="email"], input[name*="email" i]': TEST_EMAIL,
  'textarea': 'Automated daily monitoring check. Please ignore.',
};
// Relative to the form root (no "form " prefix: the root may itself be the form).
const contactSubmit = 'button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Send")';
const contactSuccess = /thank|received|success|we.ll be in touch|get back to you/i;

const sites = {
  perhaps: {
    key: 'perhaps',
    name: 'Perhaps',
    domain: 'perhaps.com',
    baseUrl: 'https://www.perhaps.com',
    pages: [
      { key: 'home', path: '/' },
      { key: 'services', path: '/our-services/' },
      { key: 'about', path: '/about-us/' },
      { key: 'careers', path: '/careers/' },
      { key: 'news', path: '/news-events/' },
      { key: 'faqs', path: '/faqs/' },
      { key: 'blog', path: '/blog/' },
      { key: 'contact', path: '/contact-us/' },
      { key: 'advertiser-signup', path: '/advertiser-sign-up/' },
    ],
    keyPhrases: ['Perhaps'], // TODO add 2-3 headline phrases from the homepage
    sections: WP.sections,
    hero: WP.hero,
    header: WP.header,
    footer: WP.footer,
    nav: WP.nav,
    ctas: WP.ctas,
    contact: {
      path: '/contact-us/', navText: /contact/i,
      form: 'form, iframe[src*="hsforms"]', // HubSpot forms may render in an iframe: TODO confirm
      fields: contactFields, submit: contactSubmit, successText: contactSuccess,
      // testMode: { hiddenField: 'input[name="sentinel"]', value: '1' }  // TODO agree with site owner
    },
    embeds: [WP.ga, WP.hubspot],
    masks: ['[class*="testimonial" i]', '[class*="logo" i][class*="slider" i]', '.tribe-events, [class*="event" i][class*="list" i]', '[class*="latest" i][class*="post" i]'],
    cookieAccept: WP.cookieAccept,
    styleProbe: WP.styleProbe,
    notFoundText: WP.notFoundText,
  },

  flexoffers: {
    key: 'flexoffers',
    name: 'FlexOffers',
    // Homepage <title> is "Performance-Based Marketing" (no brand). TODO: confirm with SEO, then tighten.
    titlePattern: /FlexOffers|Performance-Based Marketing/i,
    domain: 'flexoffers.com',
    baseUrl: 'https://www.flexoffers.com',
    pages: [
      { key: 'home', path: '/' },
      { key: 'publishers', path: '/publishers/' },
      { key: 'advertisers', path: '/advertisers/' },
      { key: 'signup', path: '/sign-up/' },
      { key: 'directory', path: '/affiliate-program-directory-list/' },
      { key: 'ranking', path: '/affiliate-program-ranking/' },
      { key: 'about', path: '/about-us/' },
      { key: 'contact', path: '/contact-us/' },
      { key: 'support', path: '/flexoffers-support-team/' },
      { key: 'blog', path: '/blog/' },
    ],
    keyPhrases: ['FlexOffers'], // TODO add headline phrases e.g. 'Partnerships at Scale'
    sections: WP.sections,
    hero: WP.hero,
    header: WP.header,
    footer: WP.footer,
    nav: WP.nav,
    ctas: WP.ctas,
    contact: {
      path: '/contact-us/', navText: /contact/i,
      form: 'form',
      fields: contactFields, submit: contactSubmit, successText: contactSuccess,
      // testMode: { hiddenField: 'input[name="sentinel"]', value: '1' }  // TODO agree with FlexOffers product
    },
    search: {
      path: '/', // homepage has a search input (verified 24 Sep). TODO confirm it is the program directory search
      input: 'input[type="search"], input[name="s"], input[name*="search" i], input[placeholder*="search" i]',
      submit: 'button[type="submit"], input[type="submit"]',
      results: 'article, .search-result, .result, .program, .affiliate-program, main li a, .elementor-post',
      term: 'affiliate',
      resultLink: 'article a, .result a, .program a, .elementor-post a',
    },
    login: {
      url: 'https://publisherpro.flexoffers.com/', // publisher portal login (verified 25 Sep: Email Address / Password / LOGIN)
      user: 'input[type="email"], input[name*="user" i], input[name*="email" i], input[id*="user" i]',
      password: 'input[type="password"]',
      submit: 'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Log in"), button:has-text("Sign in")',
      errorText: /invalid|incorrect|not (found|recogni)|wrong|error|failed|unable/i,
    },
    signup: {
      publisher: {
        url: 'https://www.flexoffers.com/sign-up/',
        navText: /publisher/i,
        signupText: /sign ?up|join|apply|get started/i,
        requiredFields: ['input[type="email"], input[name*="email" i]'],
        submit: 'button[type="submit"], input[type="submit"], a:has-text("Sign Up")',
      },
      advertiser: {
        url: 'https://www.flexoffers.com/advertisers/', // TODO confirm advertiser apply page
        navText: /advertiser/i,
        signupText: /sign ?up|join|apply|get started|contact/i,
        requiredFields: ['input[type="email"], input[name*="email" i]'],
        submit: 'button[type="submit"], input[type="submit"]',
      },
    },
    embeds: [WP.ga, WP.hubspot],
    masks: ['[class*="testimonial" i]', '[class*="logo" i][class*="slider" i]', '[class*="ticker" i]', '.blog-posts, [class*="latest" i], [class*="recent" i]'],
    cookieAccept: WP.cookieAccept,
    styleProbe: WP.styleProbe,
    notFoundText: WP.notFoundText,
  },

  fusetwo: {
    key: 'fusetwo',
    name: 'FuseTwo',
    domain: 'fusetwo.com',
    baseUrl: 'https://www.fusetwo.com',
    pages: [
      { key: 'home', path: '/' },
      { key: 'platform', path: '/platform/' },
      { key: 'brands', path: '/brands/' },
      { key: 'brand-services', path: '/brands/services/' },
      { key: 'industries', path: '/brands/industries/' },
      { key: 'publishers', path: '/publishers/' },
      { key: 'about', path: '/about-us/' },
      { key: 'support', path: '/support/' },
      { key: 'help', path: '/help-articles/' },
    ],
    keyPhrases: ['Partner Marketing'], // TODO confirm
    sections: WP.sections,
    hero: WP.hero,
    header: WP.header,
    footer: WP.footer,
    nav: WP.nav,
    ctas: WP.ctas,
    // No /contact page in the sitemap; forms appear to be HubSpot embeds (thank-you page exists).
    // TODO: confirm which page carries the lead form, then fill this block.
    contact: null,
    embeds: [WP.ga, WP.hubspot],
    masks: ['[class*="testimonial" i]', '[class*="logo" i][class*="slider" i]'],
    cookieAccept: WP.cookieAccept,
    styleProbe: WP.styleProbe,
    notFoundText: WP.notFoundText,
  },

  incubators: {
    key: 'incubators',
    name: 'Incubators',
    domain: 'incubators.com',
    baseUrl: 'https://incubators.com', // apex is canonical (www redirects here)
    pages: [
      { key: 'home', path: '/' },
      { key: 'founder', path: '/founder/' },
      { key: 'what-we-do', path: '/what-we-do/' },
      { key: 'companies', path: '/companies-built/' },
      { key: 'contact', path: '/contact-us/' },
    ],
    keyPhrases: ['Incubators'], // TODO
    sections: WP.sections,
    hero: WP.hero,
    header: WP.header,
    footer: WP.footer,
    nav: WP.nav,
    ctas: WP.ctas,
    contact: {
      path: '/contact-us/', navText: /contact/i,
      form: 'form',
      fields: contactFields, submit: contactSubmit, successText: contactSuccess,
    },
    // Directory browse: the "companies built" page is the closest thing to a directory.
    // Homepage has a WordPress search input. TODO confirm which to monitor.
    search: {
      path: '/',
      input: 'input[type="search"], input[name="s"], input[placeholder*="search" i]',
      submit: 'button[type="submit"], input[type="submit"]',
      results: 'article, .elementor-post, .search-result, main li a',
      term: 'company',
      resultLink: 'article a, .elementor-post a, .search-result a',
    },
    embeds: [], // no GTM / HubSpot detected on 24 Sep; FN-08 skips
    masks: ['[class*="testimonial" i]', '[class*="logo" i][class*="slider" i]'],
    cookieAccept: WP.cookieAccept,
    styleProbe: WP.styleProbe,
    notFoundText: WP.notFoundText,
  },
};

// Filter by SITES env (comma-separated keys) so a run can target one site.
function activeSites() {
  const filter = (process.env.SITES || '').split(',').map((s) => s.trim()).filter(Boolean);
  const all = Object.values(sites);
  return filter.length ? all.filter((s) => filter.includes(s.key)) : all;
}

module.exports = { sites, activeSites };
