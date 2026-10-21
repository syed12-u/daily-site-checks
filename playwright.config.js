require('dotenv').config();
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');
const { UA } = require('./src/lib/http');
const { todayKey } = require('./src/lib/results');

// One folder per run day: runs/YYYY-MM-DD (override with RUN_DIR for manual runs).
const runDir = process.env.RUN_DIR || path.join('runs', todayKey());
const resultsFile = process.env.RESULTS_FILE || 'results.json';

module.exports = defineConfig({
  testDir: './tests',
  // Several scenarios loop over every page of a site (up to 10 pages), so a
  // single test can legitimately take a few minutes.
  timeout: 300_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.002, // 0.2 % of pixels (VR-01 / VR-02 default)
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  fullyParallel: true,
  workers: Number(process.env.WORKERS || 3),
  // Retries are orchestrated by src/run.js (2 retries, 60 s apart) so that a
  // single blip does not page anyone. Playwright's own retries stay off.
  retries: 0,
  outputDir: path.join(runDir, 'artifacts'),
  // Image baselines live in baselines/<project>/<site>/<page>.png
  snapshotPathTemplate: 'baselines/{projectName}/{arg}{ext}',
  reporter: [
    ['list'],
    ['html', { outputFolder: process.env.HTML_DIR || path.join(runDir, 'html'), open: 'never' }],
    ['./src/reporter.js', { outputFile: path.join(runDir, resultsFile) }],
  ],
  use: {
    userAgent: UA,
    ignoreHTTPSErrors: false,
    screenshot: 'only-on-failure',
    // TRACE=on keeps a full trace (every step, screenshots, DOM, network, console) for every test.
    trace: process.env.TRACE === 'on' ? 'on' : 'retain-on-failure',
    // VIDEO=on records a .webm per test under runs/<date>/artifacts/<test>/
    video: process.env.VIDEO === 'on' ? { mode: 'on', size: { width: 1440, height: 900 } } : 'off',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    // SLOWMO=300 with --headed makes each action visible when demoing the suite.
    launchOptions: { slowMo: Number(process.env.SLOWMO || 0) },
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, userAgent: UA },
      // Mobile-only checks run in the mobile project.
      grepInvert: /\[(UF-07|VR-02)\]/,
    },
    {
      name: 'mobile',
      // iPhone device preset but rendered in Chromium (only Chromium is installed).
      use: { ...devices['iPhone 14'], defaultBrowserType: 'chromium', viewport: { width: 390, height: 844 }, userAgent: UA + ' Mobile' },
      // Mobile only runs the scenarios that define a mobile variant
      // (VR-02, PF-02 mobile LCP, UF-07). Tests skip themselves otherwise.
      testMatch: /(visual|flows|performance)\.spec\.js/,
      // Only checks with a mobile variant: LCP, mobile menu, screenshots, header/footer, layout.
      grep: /\[(PF-02|UF-07|VR-02|VR-04|VR-05)\]/,
    },
  ],
});
