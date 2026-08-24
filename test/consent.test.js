// Cookie consent (#143) — the copy-across half of the studio's #131.
//
// What these guard, in the order they would break:
//   - the script and the withdrawal link are on EVERY page, including the ones
//     nobody thinks about (/404, /checkout/done/, every article). A consent
//     gate with a page-shaped hole in it is not a gate;
//   - the INVENTORY still names every key this site's own code writes. That is
//     the one assertion that keeps the panel honest as the site changes, and
//     the reason it is a test rather than a review habit: an entry that is not
//     true is worse than no panel;
//   - Netlify's Real User Metrics is declared as `analytics` and not smuggled
//     in as `necessary` — which is also what makes the banner a symmetric
//     Accept / Reject rather than a notice;
//   - the edge function's transform swaps Netlify's injected tag for an inert
//     handoff, keeps the token that comes with it, and refuses anything it
//     cannot hand back faithfully.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { served } = require('../lib/assets.js');

const ROOT = path.join(__dirname, '..');
const CONSENT_SRC = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'js', 'consent.js'), 'utf8');

// Built into a directory of this file's own rather than into _site. Node's
// test runner runs test FILES in parallel, and /resources/ builds too — two
// eleventy runs writing the same tree is a suite that fails about one time in
// three, on whichever file lost the race.
let SITE;

const htmlPages = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? htmlPages(path.join(dir, e.name))
    : e.name.endsWith('.html') ? [path.join(dir, e.name)] : []);

describe('consent gate', () => {
  before(() => {
    SITE = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'consent-'));
    execFileSync('npx', ['eleventy', '--quiet', '--output=' + SITE], { cwd: ROOT, stdio: 'ignore' });
  });

  after(() => fs.rmSync(SITE, { recursive: true, force: true }));

  test('every built page loads the gate, and offers withdrawal', () => {
    const pages = htmlPages(SITE);
    assert.ok(pages.length >= 10, `only ${pages.length} pages built`);
    const missingScript = [], missingLink = [];
    for (const p of pages) {
      const html = fs.readFileSync(p, 'utf8');
      const rel = path.relative(SITE, p);
      // Asked of the manifest rather than of a filename: since #169 the served
      // name carries a content hash, so a literal `/assets/js/consent.js` here
      // would pin the one thing that is now allowed to change.
      if (!html.includes(`<script src="${served('/assets/js/consent.js')}" defer></script>`)) missingScript.push(rel);
      // The exact anchor the script picks up by delegation, per the handover.
      if (!/<a href="#cookies" data-cookies>Cookies<\/a>/.test(html)) missingLink.push(rel);
    }
    assert.deepStrictEqual(missingScript, [], 'pages without the consent script');
    assert.deepStrictEqual(missingLink, [], 'pages without a Cookies link');
  });

  test('nothing on the site claims the id the panel is triggered by', () => {
    // `#cookies` is the whole product's trigger: consent.js opens the panel on
    // that hash and on any link ending in it. /privacy/ used to give its
    // documentation section that id, which meant its own table-of-contents
    // link opened a dialog instead of scrolling. The anchor moved to
    // #tracking; this stops it, or another one, moving back.
    const clashes = htmlPages(SITE)
      .filter(p => / id="cookies"/.test(fs.readFileSync(p, 'utf8')))
      .map(p => path.relative(SITE, p));
    assert.deepStrictEqual(clashes, []);
  });

  test('the gate is in the head, so it is running before anything optional could', () => {
    const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
    assert.ok(html.indexOf('consent.js') < html.indexOf('</head>'));
  });

  // ── the inventory is the whole truth, and stays that way ──

  const declared = () => [...CONSENT_SRC.matchAll(/^\s+id: '([^']+)',$/gm)].map(m => m[1]);

  test('every storage key this site writes is declared in the inventory', () => {
    // Everything the browser-delivered code touches, found rather than
    // remembered — a new sessionStorage key in a new feature turns this red
    // instead of quietly making the panel a lie.
    const sources = [
      ...fs.readdirSync(path.join(ROOT, 'src', 'assets', 'js')).map(f => path.join(ROOT, 'src', 'assets', 'js', f)),
      ...fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.njk')).map(f => path.join(ROOT, 'src', f)),
    ];
    const used = new Set();
    for (const f of sources)
      for (const m of fs.readFileSync(f, 'utf8')
        .matchAll(/(?:session|local)Storage\.(?:get|set|remove)Item\(\s*'([^']+)'/g)) used.add(m[1]);
    assert.ok(used.size > 0, 'found no storage keys at all — the scan is broken, not the site');
    const undeclared = [...used].filter(k => !declared().includes(k));
    assert.deepStrictEqual(undeclared, [], 'storage keys the panel does not name');
  });

  test('the inventory declares nothing this site does not have', () => {
    // The studio's copy declared the studio's cookies. This origin sets none
    // at all — measured against production, no `set-cookie` on any response —
    // so an entry of kind `Cookie` here would be an invented disclosure.
    assert.ok(!/kind: 'Cookie'/.test(CONSENT_SRC), 'this origin sets no cookies; nothing may claim to');
    for (const studioOnly of ['pps_session', 'pps_oauth_state', 'pps_share', 'pps-theme', 'pps-library-sort'])
      assert.ok(!declared().includes(studioOnly), `${studioOnly} belongs to the studio origin, not this one`);
  });

  test('Netlify RUM is declared, and declared as a choice', () => {
    assert.ok(declared().includes('netlify-rum'), 'the one third party on this origin must be named');
    const entry = CONSENT_SRC.slice(CONSENT_SRC.indexOf("id: 'netlify-rum'"));
    const category = entry.slice(0, entry.indexOf('},')).match(/category: '([^']+)'/);
    assert.strictEqual(category && category[1], 'analytics',
      'gating it is what turns the banner from a notice into a real Accept / Reject');
  });

  // ── the edge function's transform ──

  const netlifyShaped = tag => `<html><head></head><body><p>page</p>\n${tag}\n</body></html>`;
  const REAL_TAG = '<script async id="netlify-rum-container" src="/.netlify/scripts/rum" '
    + 'data-netlify-rum-site-id="52a97af0-b445-4993-a25b-1be2260991be" '
    + 'data-netlify-deploy-branch="main" data-netlify-cwv-token="eyJhbGciOiJIUzI1NiJ9.e30.sig"></script>';

  let gateRumTag;
  before(async () => {
    ({ gateRumTag } = await import(
      require('node:url').pathToFileURL(path.join(ROOT, 'netlify', 'edge-functions', 'rum-consent.js')).href));
  });

  test('the injected tag is replaced by markup no browser will fetch', () => {
    const out = gateRumTag(netlifyShaped(REAL_TAG));
    assert.ok(!/<script\s+async/.test(out), 'the live tag is gone');
    assert.ok(!out.includes('id="netlify-rum-container"><'), 'nothing left that a browser would load');
    assert.match(out, /<script type="application\/json" id="ppsc-gated-rum">/);
    assert.ok(out.includes('<p>page</p>'), 'the rest of the page is untouched');
  });

  test('the handoff carries what the script needs to work once allowed', () => {
    const out = gateRumTag(netlifyShaped(REAL_TAG));
    const json = JSON.parse(out.match(/id="ppsc-gated-rum">([^<]+)</)[1]);
    assert.strictEqual(json.src, '/.netlify/scripts/rum');
    // RUM reads its own token back off the element by id at send time, so
    // dropping either of these would gate the script into uselessness.
    assert.strictEqual(json.id, 'netlify-rum-container');
    assert.strictEqual(json['data-netlify-cwv-token'], 'eyJhbGciOiJIUzI1NiJ9.e30.sig');
  });

  test('a page with no injected tag is handed back untouched', () => {
    assert.strictEqual(gateRumTag('<html><body>nothing to gate</body></html>'), null);
  });

  test('a tag it cannot faithfully hand back is left alone rather than lost', () => {
    // Better ungated-and-visible than removed-and-broken: the audit catches
    // the first against production, and nothing catches the second.
    for (const bad of [
      '<script async id="netlify-rum-container" src="https://evil.example/rum"></script>',
      '<script async id="netlify-rum-container" src="//evil.example/rum"></script>',
      '<script async id="netlify-rum-container"></script>',
    ]) assert.strictEqual(gateRumTag(netlifyShaped(bad)), null, bad);
  });
});
