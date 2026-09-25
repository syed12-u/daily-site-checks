#!/usr/bin/env node
// Prints what the suite will check per site and which scenarios will be
// skipped because their config block is missing. Run after editing
// config/sites.js or .env:  npm run check:config

require('dotenv').config();
const { sites } = require('../config/sites');

const yes = (v) => (v ? 'yes' : 'no');
console.log('Environment');
console.log(`  TEAMS_WEBHOOK_URL   ${yes(process.env.TEAMS_WEBHOOK_URL)}`);
console.log(`  PUBLISH_DIR         ${process.env.PUBLISH_DIR || '(not set: no report links/images in Teams)'}`);
console.log(`  REPORT_BASE_URL     ${process.env.REPORT_BASE_URL || '(not set)'}`);
console.log(`  ENABLE_FORM_SUBMIT  ${process.env.ENABLE_FORM_SUBMIT || 'false'}`);
console.log(`  RETRIES             ${process.env.RETRIES ?? 2} x ${process.env.RETRY_DELAY_SECONDS ?? 60}s`);
console.log('');

for (const s of Object.values(sites)) {
  console.log(`${s.domain}  (${s.baseUrl})`);
  console.log(`  pages: ${s.pages.map((p) => `${p.key}=${p.path}`).join(', ')}`);
  const skipped = [];
  if (!s.contact) skipped.push('FN-03, FN-04, UF-01 (no contact block)');
  else if (!/^true$/i.test(process.env.ENABLE_FORM_SUBMIT || '')) skipped.push('FN-04 submit + UF-01 submit (ENABLE_FORM_SUBMIT=false)');
  if (!s.search) skipped.push('FN-05 (no search block)');
  if (!s.search || !s.search.resultLink) skipped.push('UF-06 (no search.resultLink)');
  if (!s.login) skipped.push('FN-06, UF-05 (no login block)');
  if (!s.signup) skipped.push('FN-07, UF-03, UF-04 (no signup block)');
  if (!s.embeds || !s.embeds.length) skipped.push('FN-08 (no embeds)');
  console.log(`  skipped: ${skipped.length ? skipped.join('; ') : 'none'}`);
  const todo = [];
  if (!s.keyPhrases || !s.keyPhrases.length) todo.push('keyPhrases empty (ER-05 checks title + H1 only)');
  if (todo.length) console.log(`  todo: ${todo.join('; ')}`);
  console.log('');
}
