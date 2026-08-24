// The header, and the pages behind it (#153).
//
// The bug this file exists to prevent, in the operator's words: *"the 'what it
// does' links to a pointless anchor on the page … pricing is also just an
// achor as is 'how it works' — it needs to be redone properly."* Three of five
// nav items were `/#…` anchors, so the header taught nothing and every click
// landed on the document you were already reading.
//
// So the first two tests are derived from `site.json` rather than written as a
// list: adding a nav item that points at an anchor, or at a page that does not
// build, turns the suite red naming the item. A list somebody has to remember
// to update would rot the same silent way the nav did.
//
// What the rest guard, in the order they would break:
//   - /pricing/ still goes STRAIGHT TO STRIPE. CLAUDE.md records this exact
//     regression happening once already (asked for direct pay, built as a link
//     to an onboarding page, recorded as shipped) — so every id buy.js binds
//     to is asserted present, not just "there is a CTA somewhere";
//   - the homepage keeps #what / #how / #pricing. Stripe's own cancel_url is
//     `/#pricing` (test/checkout-session.test.js pins it) and deep links from
//     old emails and search results still point at all three;
//   - the WHO/WHAT frame is actually on the homepage and reaches both pages,
//     because a reframe that only exists in a commit message is not a reframe;
//   - no page anywhere links to an internal URL that does not build. That one
//     is deliberately broader than this change: it is the class of bug, and it
//     would have caught the nav on the day it broke.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const site = require('../src/_data/site.json');
const { served } = require('../lib/assets.js');

// Built into a directory of this file's own — /resources/ and the consent gate
// build too, and Node runs test files in parallel. Same reasoning, same shape.
let SITE;
const read = p => fs.readFileSync(path.join(SITE, p), 'utf8');
const htmlPages = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? htmlPages(path.join(dir, e.name))
    : e.name.endsWith('.html') ? [path.join(dir, e.name)] : []);

// A nav url maps to the file Eleventy writes for it: "/pricing/" → pricing/index.html.
const fileFor = url => path.join(SITE, url.replace(/^\//, '').replace(/\/$/, '') || '.', 'index.html');

describe('the header, and the pages behind it', () => {
  before(() => {
    SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-'));
    execFileSync('npx', ['@11ty/eleventy', '--quiet', '--output=' + SITE], { cwd: ROOT, stdio: 'ignore' });
  });
  after(() => fs.rmSync(SITE, { recursive: true, force: true }));

  test('no nav item is a same-page anchor', () => {
    for (const item of site.nav)
      assert.ok(!item.url.includes('#'),
        `nav item "${item.label}" points at ${item.url} — the header is for pages, not anchors (#153)`);
  });

  test('every nav item resolves to a page that actually builds', () => {
    for (const item of site.nav)
      assert.ok(fs.existsSync(fileFor(item.url)),
        `nav item "${item.label}" points at ${item.url}, which builds no page`);
  });

  test('every nav item is rendered in the header of every built page', () => {
    for (const p of htmlPages(SITE)) {
      const html = fs.readFileSync(p, 'utf8');
      for (const item of site.nav)
        assert.ok(html.includes(`<li><a href="${item.url}">${item.label}</a></li>`),
          `${path.relative(SITE, p)} is missing the "${item.label}" nav item`);
    }
  });

  test('the two product pages say what they are', () => {
    for (const [url, h1] of [['/who-to-pitch/', 'Who to pitch'], ['/what-to-send/', 'What to send']]) {
      const html = fs.readFileSync(fileFor(url), 'utf8');
      assert.match(html, new RegExp(`<h1 class="page-h1">${h1}</h1>`), `${url} has no h1`);
      assert.match(html, new RegExp(`<link rel="canonical" href="https://prospektor\\.ai${url}">`),
        `${url} has no canonical`);
      // A page with no description is a page Google writes the snippet for.
      const desc = html.match(/<meta name="description" content="([^"]+)">/);
      assert.ok(desc && desc[1].length > 80 && desc[1] !== site.description,
        `${url} has no description of its own`);
    }
  });

  // #207. Eight links on this site are /#scan, and the id decides where all
  // eight land. On .scan-hero — the last child of a flex-centred 100vh hero —
  // the browser parked the form's top edge at y=0, dead behind the fixed 58px
  // nav, with the headline off the top and empty hero padding below: the grey
  // with nothing to press. The geometry is asserted in the drive; this is the
  // cheap tripwire that says which element owns the anchor.
  test('/#scan targets the hero, not the field buried at the foot of it', () => {
    const home = read('index.html');
    assert.match(home, /<section class="hero" id="scan">/,
      'the hero no longer carries id="scan" — /#scan lands wherever the id went');
    assert.doesNotMatch(home, /class="scan-hero" id="scan"|id="scan" class="scan-hero"/,
      'id="scan" is back on .scan-hero, which parks the field behind the nav');
    assert.equal((home.match(/id="scan"/g) || []).length, 1, 'id="scan" is not unique');
  });

  test('the two product pages point at each other, and end somewhere', () => {
    assert.match(read('who-to-pitch/index.html'), /href="\/what-to-send\/"/);
    assert.match(read('what-to-send/index.html'), /href="\/who-to-pitch\/"/);
    assert.match(read('who-to-pitch/index.html'), /href="\/#scan"/, 'the WHO page never offers the free scan');
    assert.match(read('what-to-send/index.html'), /href="\/pricing\/"/, 'the WHAT page never reaches the price');
  });

  // The trap CLAUDE.md names by name. buy.js binds by id and silently does
  // nothing if one is missing — which degrades to the multi-step /checkout/
  // page, i.e. exactly the regression that was shipped and called done.
  test('/pricing/ carries the direct-to-Stripe buy form, whole', () => {
    const html = read('pricing/index.html');
    for (const id of ['buy', 'buyLink', 'buyForm', 'buyEmail', 'buyBtn', 'buySite', 'buyMsg', 'buyLive'])
      assert.match(html, new RegExp(`id="${id}"`), `/pricing/ is missing #${id} — buy.js will not bind`);
    // Attributes allowed — the claim is that the page LOADS buy.js, which is
    // the regression CLAUDE.md names. #137 added `defer` to it, and pinning
    // the exact tag turned that into a failure about the wrong thing.
    assert.match(html, new RegExp(`<script src="${served('/assets/js/buy.js')}"[^>]*></script>`),
      '/pricing/ never loads buy.js');
    assert.match(html, /\$999/, '/pricing/ does not name the price');
  });

  test('the homepage still carries its three section ids', () => {
    const home = read('index.html');
    for (const id of ['what', 'how', 'pricing', 'scan'])
      assert.match(home, new RegExp(`id="${id}"`),
        `#${id} is gone from the homepage — Stripe's cancel_url and every old deep link land on it`);
  });

  test('the homepage frames the two questions and reaches both pages', () => {
    const home = read('index.html');
    const h1 = home.match(/<h1>([\s\S]*?)<\/h1>/);
    assert.ok(h1 && /Who to pitch\./.test(h1[1]) && /What to send\./.test(h1[1]),
      'the homepage h1 is no longer the two questions (#153)');
    assert.match(home, /href="\/who-to-pitch\/"[^]*href="\/what-to-send\/"/,
      'the two halves do not both link through to their pages');
  });

  // #137 deferred four scripts (F6) and left /help/'s alone, because #136's
  // no-double-render stamp had not been re-verified with `defer` on; #170
  // verified it and finished the pass. Nothing pinned any of it: the audit
  // records async/defer as a FACT per script and flags no defect, so a fifth
  // blocking script could arrive tomorrow and the only trace would be a
  // column in a report nobody runs on a branch.
  //
  // Derived from the built pages, never from a list of filenames — adding a
  // page or a script must never turn this red, only adding a BLOCKING one.
  // Same rule as the learnings ledger and the help checks: friction points at
  // the defect, not at the work (#131).
  test('no page serves a parser-blocking script', () => {
    const blocking = [];
    for (const file of htmlPages(SITE)) {
      const html = fs.readFileSync(file, 'utf8');
      for (const m of html.matchAll(/<script\b[^>]*\ssrc=["'][^"']*["'][^>]*>/gi)) {
        const tag = m[0];
        // A module script is deferred by definition; nothing here is one yet,
        // and this exists so that adding one is not a false red.
        if (/\stype\s*=\s*["']?module\b/i.test(tag)) continue;
        // Attribute VALUES stripped first, so a filename that happens to
        // contain "async" cannot pass for the attribute.
        const attrs = tag.replace(/=\s*("[^"]*"|'[^']*'|[^\s>]+)/g, '');
        if (/\b(?:defer|async)\b/i.test(attrs)) continue;
        blocking.push(`${path.relative(SITE, file)} → ${(tag.match(/\ssrc=["']([^"']*)["']/i) || [])[1]}`);
      }
    }
    assert.deepEqual(blocking, [],
      'these scripts stop the parser mid-document — add defer (#137 F6, #170):\n  ' + blocking.join('\n  '));
  });

  test('every page carries the mobile way into the nav', () => {
    // Under 860px .nav-links is display:none and this button is the only
    // thing that opens it — so a page that ships without it ships a header
    // with no items at all on a phone, which is what /#anchors used to hide.
    for (const p of htmlPages(SITE)) {
      const html = fs.readFileSync(p, 'utf8');
      assert.match(html, /<button class="nav-toggle" id="navToggle"[^>]*aria-controls="navLinks"/,
        `${path.relative(SITE, p)} has no nav toggle`);
      assert.match(html, /<ul class="nav-links" id="navLinks">/,
        `${path.relative(SITE, p)} — the toggle's aria-controls target is missing`);
    }
  });

  test('the sitemap lists the new pages', () => {
    const xml = read('sitemap.xml');
    for (const url of ['/who-to-pitch/', '/what-to-send/', '/pricing/'])
      assert.match(xml, new RegExp(`<loc>https://prospektor\\.ai${url}</loc>`), `sitemap is missing ${url}`);
  });

  test('no page links to an internal URL that does not build', () => {
    // Redirects declared in netlify.toml resolve at the edge, not in _site.
    const REDIRECTED = ['/app/'];
    const dead = [];
    for (const p of htmlPages(SITE)) {
      const html = fs.readFileSync(p, 'utf8');
      for (const m of html.matchAll(/href="(\/[^"#?]*)(?:[#?][^"]*)?"/g)) {
        const href = m[1];
        // Assets have their own check since #169 — their names are computed
        // now, so `test/assets.test.js` resolves every one of them (src as
        // well as href) against the build rather than assuming they exist.
        if (href.startsWith('/assets/') || href.startsWith('/.netlify/')) continue;
        if (REDIRECTED.some(r => href.startsWith(r))) continue;
        const target = /\.[a-z0-9]+$/i.test(href)
          ? path.join(SITE, href)
          : path.join(SITE, href, 'index.html');
        if (!fs.existsSync(target)) dead.push(`${path.relative(SITE, p)} → ${href}`);
      }
    }
    assert.deepEqual(dead, [], 'dead internal links');
  });
});
