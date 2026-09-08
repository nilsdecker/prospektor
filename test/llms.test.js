// `prospektor.ai/llms.txt` (#316) — the marketing half of the studio's #300.
//
// Two files, one link between them, and the split is the whole point. The
// studio's `llms.txt` opens with the six calls that need no account, and it is
// checked against the functions that declare them (`test/deploy.test.js` in the
// studio repo) — a renamed route turns that suite red. Nothing here can do
// that: this repo has no /api/ to read the claims back against.
//
// So this file claims nothing about behaviour it cannot show. It names no
// endpoint, and every internal URL it gives an agent is a page this build
// actually writes. Those are the two rules, and these are the tests for them:
// the first would have caught a copied endpoint list going stale, the second a
// link to a page somebody renamed.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const site = require('../src/_data/site.json');
const { siteBuild } = require('./helpers.js');

let SITE, txt, built;

describe('llms.txt — the machine-readable front door (#316)', () => {
  before(() => {
    built = siteBuild('llms');
    SITE = built.dir;
    txt = fs.readFileSync(path.join(SITE, 'llms.txt'), 'utf8');
  });
  after(() => built && built.cleanup());

  test('it builds at the site root, beside robots.txt', () => {
    assert.ok(fs.existsSync(path.join(SITE, 'robots.txt')));
    assert.ok(txt.startsWith('# Prospektor'), 'llms.txt must open with the product name');
  });

  test('it names no endpoint — those are only true on the studio', () => {
    const paths = [...txt.matchAll(/\/api\/[a-z0-9_-]+/gi)].map(m => m[0]);
    assert.deepEqual(paths, [],
      `llms.txt names ${paths.join(', ')} — endpoint claims belong in the studio's file, ` +
      'where test/deploy.test.js reads them back against the functions that declare them (#316)');
  });

  test('it hands the machine surface to the studio', () => {
    assert.ok(txt.includes('https://studio.prospektor.ai/llms.txt'),
      'the calls live on the studio — this file must link to its llms.txt');
  });

  test('it says there is no MCP server, and nothing builds one', () => {
    assert.ok(/No MCP server/i.test(txt));
    assert.ok(!fs.existsSync(path.join(SITE, '.well-known', 'mcp-manifest.json')),
      'a built mcp-manifest.json would answer 200 with the marketing site as JSON — ' +
      'the catch-all 404 in netlify.toml is the honest answer (#300/#316)');
  });

  // #423, and the same rule as test/pages.test.js' — this file is the other
  // half, because llms.txt is not an HTML page and that sweep cannot see it.
  // "**No free trial.** The free scan above is the trial" was published here
  // from #316, and it had gone wrong twice over by 30 Aug: #419 put a second
  // free thing above it (the run at /r), so "the free scan" undersold, and
  // #422 built a free tier that one operator env var away makes the denial
  // flatly false. An agent reading this file quotes it at people.
  test('it does not deny a free offering the studio is one env var from opening', () => {
    const denials = [/no\s+free\s+trial/i, /(?:there\s+is|there's)\s+no\s+free/i,
                     /no\s+free\s+(?:tier|workspace|plan)/i];
    for (const re of denials) {
      assert.ok(!re.test(txt),
        `llms.txt denies a free offering (${re}) — #422 shipped one behind ONBOARDING_OPEN=1 (#423)`);
    }
  });

  test('every prospektor.ai page it links to actually builds', () => {
    const links = [...txt.matchAll(/https:\/\/prospektor\.ai(\/[^)\s]*)?/g)]
      .map(m => m[1] || '/');
    assert.ok(links.length >= 5, 'llms.txt should point an agent at the pages that carry its claims');
    for (const url of new Set(links)) {
      const file = path.join(SITE, url.replace(/^\//, '').replace(/\/$/, '') || '.', 'index.html');
      assert.ok(fs.existsSync(file), `llms.txt links ${url}, which this build does not write`);
    }
  });

  test('every price it quotes is a price the pricing page charges', () => {
    const pricing = fs.readFileSync(path.join(SITE, 'pricing', 'index.html'), 'utf8');
    // #542: two figures now, and a machine reading this file must not be told
    // either one that /pricing/ does not offer. Read as a set, so a third plan
    // named here and nowhere else is red.
    const quoted = [...txt.matchAll(/US\$([\d,]+) (?:a|for a) (?:month|year)/g)].map(m => m[1]);
    assert.ok(quoted.length, 'llms.txt must state the price a machine came here to read');
    for (const q of quoted)
      assert.ok(pricing.includes(`"price": "${q.replace(/,/g, '')}.00"`),
        `llms.txt says US$${q}; /pricing/ offers no such price`);
    assert.ok(pricing.includes('"priceCurrency": "USD"'));
  });

  test('robots.txt still lets a crawler in', () => {
    const robots = fs.readFileSync(path.join(SITE, 'robots.txt'), 'utf8');
    assert.ok(robots.includes('Allow: /'));
    assert.ok(robots.includes(`${site.url}/sitemap.xml`));
  });
});
