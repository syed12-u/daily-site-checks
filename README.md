# daily-site-checks

Daily website monitoring and visual regression for **perhaps.com**, **flexoffers.com**, **fusetwo.com** and **incubators.com**. Playwright runs the checks, a Node orchestrator retries, scores and posts to Microsoft Teams. Plan of record: the "Website Monitoring & Visual Regression Automation Plan" (24 Sep 2026).

## What runs

| Job | When | Command | Does |
|---|---|---|---|
| Daily full run | 06:00 | `npm run run:daily` | All AV / FN / ER / PF / UF / VR scenarios on 4 sites, 2 retries 60 s apart, alerts + daily summary card, weekly card on Mondays |
| Hourly uptime | every hour | `npm run run:uptime` | Homepage HTTP 200 per site; Critical card while down, resolved card when back; re-checks open Critical alerts from the daily run |
| Weekly roll-up | Monday (from daily run) | `npm run run:weekly` | 7-day uptime % and response-time trend per site |

Scenario IDs (AV-01 … VR-08), pass conditions and severities follow the plan. Defaults live in `src/lib/severity.js`.

## Setup

```powershell
npm install
npx playwright install chromium
copy .env.example .env      # fill TEAMS_WEBHOOK_URL at minimum
npm run check:config        # shows what will run / skip per site
npm run teams:test          # posts a hello card to the channel
```

### Teams webhook
In the target channel: **… → Workflows → "Post to a channel when a webhook request is received"** → copy the HTTP POST URL into `TEAMS_WEBHOOK_URL`. (Classic "Incoming Webhook" connectors also work.) Optional `TEAMS_MENTION_UPNS` / `TEAMS_MENTION_NAMES` @mention people on Critical cards.

### Images and report links in Teams
A webhook cannot upload files, so screenshots and diffs appear in cards only when the run folder is published somewhere with a URL:
- `PUBLISH_DIR` – folder the run is copied to (Azure Blob container mounted or synced locally, a static-site share, etc.)
- `REPORT_BASE_URL` – public URL of that folder

Without these, cards contain text and local paths, and the HTML report is at `runs/<date>/html/index.html`.

## Runbook

**Run everything now, without posting to Teams**
```powershell
npm run run:daily -- --no-teams        # cards saved to runs/<date>/cards/*.json
npm run run:daily -- --sites perhaps   # one site
npm run run:daily -- --grep "\[AV-"    # one scenario family
npx playwright test --grep "\[FN-06\]\[flexoffers\]" --headed   # one check, visible browser
npm run report                          # open the last HTML report
```

**First-run baselines.** The first daily run captures every image, layout, text and style baseline and reports "baseline captured" notes instead of failures. Review `baselines/desktop/<site>/*.png` and `baselines/mobile/...` once, then they are the approved reference.

**Approve an intended change**
```powershell
npm run approve flexoffers home     # one page (image + layout + text + style baselines)
npm run approve flexoffers all      # whole site
npm run approve all all             # everything
npm run approve perhaps dns         # accept new DNS records after a planned IP change
```
Approvals are logged in `state/approvals.json` and appear in the next daily card's change log. If the folder is a git repo the baselines are committed.

**Add a page or flow.** Edit `config/sites.js`: add to `pages[]` (key + path), or fill the `contact` / `search` / `login` / `signup` blocks. Scenarios whose block is missing skip with a reason instead of failing. Run `npm run check:config` to confirm, then `npm run approve <site> <newpage>` to capture its baselines.

**Silence a scenario.** Temporarily: `npx playwright test --grep-invert "\[ER-06\]"` or pass `--grep` to `run:daily`. Permanently for one site: remove the config block that drives it, or wrap the `test(...)` in `test.skip(site.key === 'x', 'reason')`.

**Mask a dynamic region.** Add its selector to `masks[]` for the site in `config/sites.js` (global defaults: cookie banners, chat widgets, carousels, video, ad slots, dates). Then re-approve the affected pages.

**Form submissions.** `FN-04` and the submit step of `UF-01` only run when `ENABLE_FORM_SUBMIT=true`. Set it once every site has a safe test path (a `contact.testMode.hiddenField` or an email address the site recognises as a test). `TEST_EMAIL` is what gets submitted.

**Alerts stuck open.** `state/alerts.json` holds open Critical/High alerts. Delete an entry to stop re-posts; it will re-open if the check fails again.

## Scheduling on the always-on machine
```powershell
powershell -ExecutionPolicy Bypass -File scripts\register-tasks.ps1
```
Registers "DailySiteChecks Daily" (06:00) and "DailySiteChecks Hourly". Logs go to `logs\`. Keep the checkout outside OneDrive on that machine. Fallback if no machine is available: a small Azure VM or a GitHub Actions cron running the same two commands.

## Layout
```
config/sites.js        per-site pages, selectors, flows, masks
tests/*.spec.js        availability, errors, performance, functionality, flows, visual
src/run.js             daily orchestrator (retries, alerts, summary, prune)
src/uptime.js          hourly ping + re-check of open Critical alerts
src/weekly.js          Monday roll-up
src/approve.js         baseline approval
src/teams.js           Adaptive Cards + webhook
src/reporter.js        Playwright reporter -> results.json
src/lib/               http/tls/dns, page helpers, baselines, alert state, runner
baselines/             desktop/ mobile/ (png), layout/ text/ styles/ (json)
runs/YYYY-MM-DD/       results.json, summary.json, html/, artifacts/ (30 days kept)
state/                 alerts.json, dns.json, approvals.json, run.json
```

## Exit codes
`run:daily` exits 0 (green), 1 (amber: medium/low failures), 2 (red: critical/high), 3 (runner error). `run:uptime` exits 2 when any site is down.
