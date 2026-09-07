#!/usr/bin/env node
'use strict';
// `npm run i18n:coverage [-- es]` — what each language's catalogue is missing,
// what it holds that the site no longer says, and any translation that lost
// a placeholder (#114). The same three lists `test/i18n.test.js` reads, on
// demand and in full: the test turns red on stale entries and dropped
// placeholders, and only REPORTS missing ones — untranslated is a sweep to
// run, never a build to fail (#113's rule, and #131's).
//
// With no argument it reports every language in the closed set, including
// the ones with no catalogue yet — so "what would German need" is answered
// before a German file exists.
const i18n = require('../lib/i18n.js');

const codes = process.argv.slice(2).filter(a => !a.startsWith('-'));
const which = codes.length ? codes : i18n.LANGUAGES.filter(l => l.code !== i18n.DEFAULT).map(l => l.code);

let exit = 0;
for (const code of which) {
  const lang = i18n.LANGUAGES.find(l => l.code === code);
  if (!lang) { console.error(`unknown language: ${code}`); exit = 2; continue; }
  const c = i18n.coverage(code);
  const pct = c.total ? Math.round((100 * c.translated) / c.total) : 100;
  console.log(`\n${lang.name} (${code}) — ${c.built ? `src/_data/strings/${code}.json` : 'no catalogue: not built'}`);
  console.log(`  ${c.translated}/${c.total} sentences translated (${pct}%) · ${c.stale.length} stale · ${c.dropped.length} dropped placeholders`);
  if (c.missing.length) {
    console.log('  missing:');
    let file = '';
    for (const m of c.missing) {
      if (m.file !== file) { file = m.file; console.log(`    ${file}`); }
      console.log(`      ${JSON.stringify(m.key)}`);
    }
  }
  if (c.stale.length) {
    console.log('  stale — the site no longer says these; delete them:');
    for (const k of c.stale) console.log(`      ${JSON.stringify(k)}`);
    exit = 1;
  }
  if (c.dropped.length) {
    console.log('  dropped placeholders:');
    for (const d of c.dropped) console.log(`      ${JSON.stringify(d.key)} wants {${d.want.join('} {')}}, translation has {${d.got.join('} {')}}`);
    exit = 1;
  }
}
process.exit(exit);
