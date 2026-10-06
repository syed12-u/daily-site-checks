#!/usr/bin/env node
// Post the saved daily summary of a run to Teams (re-send, or send after a manual run).
//
//   npm run post:summary              today's run
//   npm run post:summary -- 2026-10-05   a specific day
require('dotenv').config();
const path = require('path');
const { RUNS_DIR, todayKey, readJson } = require('./lib/results');
const teams = require('./teams');

const date = process.argv[2] || todayKey();
const file = path.join(RUNS_DIR, date, 'summary.json');
const summary = readJson(file, null);
if (!summary) {
  console.error(`no summary at ${file}; run "npm run run:daily" first`);
  process.exit(1);
}
teams
  .postCard(teams.summaryCard(summary))
  .then((r) => console.log(r.ok ? `Posted daily summary for ${date} to Teams.` : `Not posted: ${r.skipped}`))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
