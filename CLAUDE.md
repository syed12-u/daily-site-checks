# daily-site-checks

Playwright + Node monitoring suite for perhaps.com, flexoffers.com, fusetwo.com, incubators.com. Results go to Microsoft Teams. Full runbook in README.md; requirements in Website_Monitoring_Automation_Plan.pdf.

## Commands
- `npm run run:daily -- --no-teams` full run, cards written to runs/<date>/cards instead of posted
- `npm run run:daily -- --sites perhaps --grep "\[AV-"` narrow a run
- `npx playwright test --grep "\[FN-06\]\[flexoffers\]"` single check
- `npm run run:uptime -- --no-teams` hourly ping
- `npm run approve <site> <page|all|dns>` re-capture baselines
- `npm run check:config` what runs / skips per site

## Conventions
- Test titles are `[ID][siteKey] Name`; src/reporter.js parses them. Keep that format.
- Use helpers from src/lib/results.js in tests: `tag`, `setSeverity`, `metric`, `note`, `url`. Metrics feed history/trend checks and the Teams cards.
- Conditional severities (AV-02, AV-04, VR-01) are set inside the test with `setSeverity`; defaults are in src/lib/severity.js.
- A scenario with missing config must `test.skip(...)` with a reason, never fail.
- Mobile project only runs visual/flows/performance specs; tests skip themselves by `testInfo.project.name`.
- Retries are done by src/run.js (`--last-failed`), not Playwright's `retries`.
- Missing baselines are captured, noted and passed; never fail a first run on a missing baseline.

## When analysing a run
Read `runs/<date>/summary.json` first (per-site status, failed IDs, one-line summaries), then `results.json` for full errors. Failure screenshots are under `runs/<date>/artifacts/`. Config guesses marked `TODO` in config/sites.js are the usual cause of noisy failures before Day 1 page lists are confirmed.
