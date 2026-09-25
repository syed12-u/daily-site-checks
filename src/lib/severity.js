// Default severity per scenario ID (from the plan). Tests may override at
// runtime with setSeverity() when the plan defines a conditional severity.

const SEVERITY = {
  // Availability and response
  'AV-01': 'critical',
  'AV-02': 'high', // critical if more than one page fails (set in test)
  'AV-03': 'high',
  'AV-04': 'high', // critical if expired (set in test)
  'AV-05': 'critical',
  'AV-06': 'low',
  'AV-07': 'medium',
  'AV-08': 'medium', // high if 10+ or >1 % of sitemap URLs broken (set in test)
  // Critical functionality
  'FN-01': 'high',
  'FN-02': 'medium',
  'FN-03': 'high',
  'FN-04': 'high',
  'FN-05': 'high',
  'FN-06': 'critical',
  'FN-07': 'high',
  'FN-08': 'low',
  'FN-09': 'high',
  // Error detection
  'ER-01': 'medium',
  'ER-02': 'high',
  'ER-03': 'medium',
  'ER-04': 'high',
  'ER-05': 'high',
  'ER-06': 'low',
  // Performance
  'PF-01': 'medium',
  'PF-02': 'medium',
  'PF-03': 'low',
  'PF-04': 'low',
  'PF-05': 'medium',
  // Key user flows
  'UF-01': 'high',
  'UF-02': 'high',
  'UF-03': 'high',
  'UF-04': 'high',
  'UF-05': 'critical',
  'UF-06': 'high',
  'UF-07': 'medium',
  // Visual regression
  'VR-01': 'medium', // high if homepage (set in test)
  'VR-02': 'medium',
  'VR-03': 'high',
  'VR-04': 'high',
  'VR-05': 'medium',
  'VR-06': 'low',
  'VR-07': 'medium',
  'VR-08': 'high',
};

const NAMES = {
  'AV-01': 'Homepage responds',
  'AV-02': 'Key pages respond',
  'AV-03': 'www / http redirects',
  'AV-04': 'TLS certificate valid',
  'AV-05': 'DNS resolves',
  'AV-06': 'Custom 404 page',
  'AV-07': 'robots.txt and sitemap.xml',
  'AV-08': 'Sitemap URLs respond',
  'FN-01': 'Primary navigation',
  'FN-02': 'No broken images',
  'FN-03': 'Contact form loads',
  'FN-04': 'Contact form submits (test mode)',
  'FN-05': 'Search',
  'FN-06': 'Login page',
  'FN-07': 'Signup / apply page',
  'FN-08': 'Third-party embeds',
  'FN-09': 'Key CTA buttons',
  'ER-01': 'Console errors',
  'ER-02': 'Failed network requests',
  'ER-03': 'Mixed content',
  'ER-04': 'Unexpected text',
  'ER-05': 'Expected content present',
  'ER-06': 'Security headers',
  'PF-01': 'Time to first byte',
  'PF-02': 'Largest Contentful Paint',
  'PF-03': 'Total page weight',
  'PF-04': 'Request count',
  'PF-05': 'Response-time trend',
  'UF-01': 'Visitor to contact',
  'UF-02': 'Visitor to key landing page',
  'UF-03': 'Publisher signup',
  'UF-04': 'Advertiser signup',
  'UF-05': 'Login attempt',
  'UF-06': 'Browse / search',
  'UF-07': 'Mobile navigation',
  'VR-01': 'Full-page screenshot, desktop',
  'VR-02': 'Full-page screenshot, mobile',
  'VR-03': 'Above-the-fold hero',
  'VR-04': 'Header and footer components',
  'VR-05': 'Layout shift',
  'VR-06': 'Text content diff',
  'VR-07': 'Styling drift',
  'VR-08': 'Missing sections',
};

const RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0, ok: 0 };

module.exports = { SEVERITY, NAMES, RANK };
