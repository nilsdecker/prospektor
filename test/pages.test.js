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
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const site = require('../src/_data/site.json');
const { served } = require('../lib/assets.js');
const i18n = require('../lib/i18n.js');
const { siteBuild } = require('./helpers.js');

// Built into a directory of this file's own — /resources/ and the consent gate
// build too, and Node runs test files in parallel. Same reasoning, same shape.
let SITE, built;
const read = p => fs.readFileSync(path.join(SITE, p), 'utf8');
const htmlPages = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? htmlPages(path.join(dir, e.name))
    : e.name.endsWith('.html') ? [path.join(dir, e.name)] : []);

// A nav url maps to the file Eleventy writes for it: "/pricing/" → pricing/index.html.
const fileFor = url => path.join(SITE, url.replace(/^\//, '').replace(/\/$/, '') || '.', 'index.html');

describe('the header, and the pages behind it', () => {
  before(() => { built = siteBuild('pages'); SITE = built.dir; });
  after(() => built && built.cleanup());

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

  // In the page's own language since #114: on `/es/…` the label is the
  // catalogue's and the href is the Spanish twin where the build wrote one
  // (`/es/pricing/`) and the English page where it did not (`/help/`). The
  // expectation is derived from lib/i18n.js and the built page list — the
  // same two things the layout derives it from — so a nav item, a language or
  // a translated page can be added without touching this.
  test('every nav item is rendered in the header of every built page', () => {
    const pages = htmlPages(SITE);
    const built = new Set(pages.map(p => '/' + path.relative(SITE, p).replace(/index\.html$/, '').replace(/\\/g, '/')));
    for (const p of pages) {
      const html = fs.readFileSync(p, 'utf8');
      const url = '/' + path.relative(SITE, p).replace(/index\.html$/, '').replace(/\\/g, '/');
      const lang = i18n.localeOf(url);
      for (const item of site.nav) {
        const twin = i18n.twin(item.url, lang);
        const href = built.has(twin) ? twin : item.url;
        const label = i18n.t(item.label, lang);
        assert.ok(html.includes(`<li><a href="${href}">${label}</a></li>`),
          `${path.relative(SITE, p)} is missing the "${label}" nav item (expected href ${href})`);
      }
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

  // #453 moved the two questions out of the h1 and into the deck under it: the
  // h1 is the promise now ("Find leads that fit you."), which is what the
  // <title> has always said and what a stranger can act on. #153's requirement
  // is unchanged and is what this still holds — the frame must be ON the
  // homepage, prominently, and must reach both pages. Scoped to the hero
  // deliberately: the header carries the same two strings on every page of the
  // site, so a page-wide match would pass on the nav alone and assert nothing.
  test('the homepage frames the two questions in the hero, and reaches both pages', () => {
    const home = read('index.html');
    const hero = home.match(/<section class="hero"[^>]*>([\s\S]*?)<\/section>/);
    assert.ok(hero, 'the homepage has no hero section');
    assert.ok(/Who to pitch\./.test(hero[1]) && /What to send\./.test(hero[1]),
      'the two questions have left the hero — the nav, both product pages and the halves '
      + 'section are all built on that frame (#153), so it may be demoted but not dropped');
    const h1 = home.match(/<h1>([\s\S]*?)<\/h1>/);
    assert.ok(h1 && h1[1].replace(/<[^>]*>/g, '').trim().length > 8,
      'the homepage has no h1 worth reading');
    assert.match(home, /href="\/who-to-pitch\/"[^]*href="\/what-to-send\/"/,
      'the two halves do not both link through to their pages');
  });

  // #453. The <title> is "Prospektor · <tagline>" and the h1 is the same
  // promise; they said different things until this change, which is the one
  // shape a search result should never have. Derived from site.json — editing
  // the tagline is allowed and editing the h1 is allowed, drifting them apart
  // silently is not.
  // Punctuation-insensitive on purpose: the h1 breaks the promise across two
  // lines with a full stop in the middle ("Find Leads." / "That fit you."), and
  // the tagline is one phrase. Comparing the WORDS is the claim; comparing the
  // typography would fail on a line break somebody was right to add.
  const words = t => t.replace(/<[^>]*>/g, ' ').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
  test('the homepage h1 says what the title says', () => {
    const h1 = words(read('index.html').match(/<h1>([\s\S]*?)<\/h1>/)[1]);
    const key = words(site.tagline).replace(/^your /, '');
    assert.ok(h1.includes(key),
      `the h1 (${JSON.stringify(h1)}) no longer carries the tagline the <title> shows `
      + `(${JSON.stringify(site.tagline)}) — a page whose headline and search result disagree (#453)`);
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

  // #423. The funnel published "no trial theater" in the pricing tile and
  // again in the FAQ, and "No free trial" in llms.txt, for as long as those
  // pages have existed — and nothing anywhere checked them. #422 then built a
  // free tier (a workspace that runs one full pitch, then asks for the card)
  // whose door opens on one operator environment variable, ONBOARDING_OPEN=1,
  // set on the STUDIO. So the day that variable is set, three sentences on
  // this site become false with no commit here to notice, on the two pages
  // where being caught lying costs the most.
  //
  // The fix in the copy was to stop denying that anything is free and keep
  // denying the fourteen-day clock, which is what the sentence was really
  // promising and which the free tier does not falsify. This is what stops it
  // coming back. It is a list of CLAIM shapes, never of files: writing a new
  // page, or a /resources/ article about somebody else's trial funnel, cannot
  // turn it red — only asserting again that we have no free offering can
  // (#131, and the same rule the learnings ledger and the help checks keep).
  test('no page claims there is no free offering', () => {
    // Each pattern is an absolute denial. "No fourteen days of hoping you
    // remember to cancel" is deliberately NOT one: it says what we do not do,
    // which stays true whether the free tier's door is open or shut.
    const denials = [
      /no\s+trial\s+theater/i,
      /no\s+free\s+trial/i,
      /(?:there\s+is|there's)\s+no\s+free/i,
      /no\s+free\s+(?:tier|workspace|plan)/i,
    ];
    const found = [];
    for (const file of htmlPages(SITE)) {
      const text = fs.readFileSync(file, 'utf8').replace(/<[^>]*>/g, ' ');
      for (const re of denials) {
        const m = text.match(re);
        if (m) found.push(`${path.relative(SITE, file)} → ${JSON.stringify(m[0])}`);
      }
    }
    assert.deepEqual(found, [],
      'the studio has a free tier behind one env var (#422) — these sentences deny it (#423):\n  ' +
      found.join('\n  '));
  });

  // #450. Two non-sales readers — plausible buyers both — could not say what
  // the product does after reading the homepage. The cause was measurable: the
  // hero explained the product as "a full GTM team on every pitch: a BDR to
  // research it, an SDR to find your way in, an AE to write what you send",
  // and nine acronyms in total landed before the page named, in ordinary
  // words, the thing a buyer receives.
  //
  // Both checks below are a list of JARGON SHAPES, never of files or elements
  // — the same construction as the free-offering denials above and for the
  // same reason (#131). Writing a new section, a sixth agent card or a whole
  // new page cannot turn them red; putting an unexplained acronym in front of
  // a first-time reader is the only thing that can.
  const JARGON = /\b(?:GTM|BDR|SDR|AEs?|RevOps|Sales Ops|ICP|TAM|SAM|SAL|MQLs?|SQLs?)\b/;

  test('the hero explains the product without sales-org jargon', () => {
    const home = read('index.html');
    const sub = home.match(/<p class="hero-sub">([\s\S]*?)<\/p>/);
    assert.ok(sub, 'the homepage has no hero sub — the one sentence that has to explain the product');
    const text = sub[1].replace(/<[^>]*>/g, ' ');
    const hit = text.match(JARGON);
    assert.equal(hit, null,
      `the hero sub is back to explaining the product in sales-org vocabulary (${JSON.stringify(hit && hit[0])}): `
      + JSON.stringify(text.trim()) + ' — #450: this is the one sentence on the site whose entire job is comprehension');
  });

  test('the homepage names what a buyer gets before it names who does the work', () => {
    // Order, not presence. The deliverables were always on this page; they were
    // three sections below the acronyms, which is past where a confused reader
    // leaves. Whichever section carries them may move or be rewritten — it just
    // may not end up underneath the job titles again.
    const text = read('index.html').replace(/<[^>]*>/g, ' ');
    const goods = text.search(/\bdeck\b[\s\S]{0,400}?\bproposal\b/i);
    assert.ok(goods >= 0, 'the homepage never names the deliverables in plain words at all (#450)');
    const jargon = text.search(JARGON);
    if (jargon >= 0)
      assert.ok(goods < jargon,
        'a sales acronym reaches the reader before the homepage has said what they get, in plain words (#450) — '
        + `first acronym at ${jargon}, first "deck … proposal" at ${goods}`);
  });

  test('every agent acronym on the homepage carries a plain-English gloss', () => {
    // The five kickers are the operator's own ask of 25 Aug and the five card
    // headings are pinned verbatim by test/agents.test.js in the studio repo,
    // so neither can be removed here. What #450 added instead is one plain word
    // beside each. Derived from the built card: a sixth agent can only turn
    // this red by shipping unglossed.
    const kickers = [...read('index.html').matchAll(/<span class="crew-kicker">([\s\S]*?)<\/span>/g)];
    assert.ok(kickers.length, 'the crew cards have lost their kickers');
    for (const [, inner] of kickers)
      assert.match(inner, /<em>[^<]+<\/em>/,
        `the agent label ${JSON.stringify(inner.replace(/<[^>]*>/g, '').trim())} has no plain-English gloss (#450)`);
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

  // #419: the free run answered the whole WHO half to a stranger for six days
  // while nothing on this site pointed at it, and it ran at zero — `spent: 0`
  // was zero distribution, not weak demand. A link nobody can see is the exact
  // failure that cost those six days, so the door is asserted rather than
  // remembered. Derived from the built page and from scan.js, never from a
  // list: the check reads what ships.
  test('the homepage offers the free run, and it is the card\'s primary action', () => {
    const html = read('index.html');
    const RUN = 'https://studio.prospektor.ai/r';
    assert.ok(html.includes(`href="${RUN}"`),
      `the homepage no longer links to the free run at ${RUN} — #419 shipped that door because nothing on this site pointed at it for six days and it ran at zero`);
    // Primary means the button, not a line of small print: the visitor at this
    // moment has seen a guess about their own business and no evidence yet,
    // which is #418's whole reason for putting the run in front of the price.
    const card = html.match(/<div class="scan-cta-row">[\s\S]*?<\/div>/);
    assert.ok(card, 'the scan result has no CTA row');
    assert.match(card[0], new RegExp(`<a class="btn-cta" id="scanRunCta" href="${RUN}"`),
      'the free run is no longer the primary action on the scan result (#418/#419)');
    // Demoted, never removed — the reader who is already sold must not have to
    // hunt for the way to pay.
    assert.match(card[0], /id="scanCta" href="\/checkout\/"/,
      'checkout has fallen off the scan result entirely — #419 demoted it, it did not delete it');
  });

  // The run page starts on arrival from ?domain=, so nobody types their site
  // twice. If this stops being sent, the link still works and the funnel still
  // silently asks for the domain a second time — which is why it is pinned.
  test('the free-run link carries the domain the scan resolved', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src/assets/js/scan.js'), 'utf8');
    assert.match(js, /runCtaEl\.href = runUrl\(domain\)/,
      'scan.js no longer points the free-run CTA at the scanned domain (#419)');
    assert.match(js, /'\?domain=' \+ encodeURIComponent\(domain\)/,
      'the free-run URL no longer carries ?domain= — the visitor types their site twice (#419)');
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
