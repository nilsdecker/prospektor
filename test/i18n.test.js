// The funnel in more than one language (#114) — the contract, pinned.
//
// What each test holds, in the order it would break:
//   - English is a NO-OP, byte for byte. A `{% t %}` block on an English page
//     renders its content unchanged, whitespace included, before any lookup
//     happens — the same property #113 held the studio's prompts to. This is
//     the one the whole design rests on: a translation layer that moves an
//     English byte has changed the product it was meant to leave alone.
//   - The inventory is readable. Every `{% t %}` block, filter literal and
//     `t('…')` call the extractor sees is a sentence a catalogue can hold; a
//     block carrying an expression it cannot resolve fails BY NAME rather
//     than silently leaving a hole (#113's "a t() the extractor cannot read").
//   - No catalogue holds a sentence the site no longer says (stale), and no
//     translation drops a `{placeholder}` the English carries. Both are the
//     shapes that rot silently.
//   - UNTRANSLATED IS REPORTED, NEVER RED. Nothing here counts sentences or
//     fails on a missing translation: a feature ships its English in the code
//     that uses it, and `npm run i18n:coverage` lists what a sweep should
//     catch up on (#113, #131).
//   - A language exists exactly when its catalogue does: pages, hreflang,
//     the switcher and the sitemap all derive from that one file's presence.
//   - The functions' catalogue map (`netlify/lib/strings.js`) names every
//     catalogue on disk — a language that lands in `src/_data/strings/` and
//     not there is a welcome email that silently stays English.
//   - Nothing on a localized page points at a URL the build did not write:
//     `localize` falls back to the English page rather than 404ing.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const i18n = require('../lib/i18n.js');
const { siteBuild } = require('./helpers.js');

let SITE, built;
const read = p => fs.readFileSync(path.join(SITE, p), 'utf8');
const htmlPages = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? htmlPages(path.join(dir, e.name))
    : e.name.endsWith('.html') ? [path.join(dir, e.name)] : []);
const urlOf = p => '/' + path.relative(SITE, p).replace(/index\.html$/, '').replace(/\\/g, '/');

describe('the language contract (#114)', () => {
  before(() => { built = siteBuild('i18n'); SITE = built.dir; });
  after(() => built && built.cleanup());

  test('English is a no-op, byte for byte, before any lookup', () => {
    const odd = '  Find Leads.<br><span class="accent">That fit you.</span>\n   ';
    assert.strictEqual(i18n.translate(odd, 'en'), odd, 'the English key came back changed');
    assert.strictEqual(i18n.t(odd, ''), odd, 'an unset language is English');
    assert.strictEqual(i18n.t(odd, 'xx'), odd, 'a language outside the set is English');
    assert.strictEqual(i18n.t('opening {domain}…', 'en', { domain: 'acme.com' }), 'opening acme.com…');
  });

  test('a sentence a catalogue lacks renders in English, and is not an error', () => {
    for (const l of i18n.built().filter(l => l.code !== 'en')) {
      const key = 'A sentence no catalogue will ever hold (#114 test)';
      assert.strictEqual(i18n.translate(key, l.code), undefined, `${l.code}: a miss must be reported as one`);
      assert.strictEqual(i18n.t(key, l.code), key, `${l.code}: a miss must fall back to the English`);
    }
  });

  test('keys match after whitespace normalisation and nothing else', () => {
    assert.strictEqual(i18n.normalizeKey('  a\n   b  c '), 'a b c');
    assert.notStrictEqual(i18n.normalizeKey('a — b'), i18n.normalizeKey('a - b'), 'punctuation is part of a sentence');
  });

  test('the inventory reads every sentence the site asks for, and names what it cannot', () => {
    const inv = i18n.inventory();
    assert.ok(inv.length > 100, `only ${inv.length} sentences found — the extractor is broken, not the site`);
    for (const e of inv) {
      assert.ok(!/\{\{|\{%/.test(e.key), `${e.file}: a key still carries template syntax: ${e.key.slice(0, 60)}`);
      assert.strictEqual(e.key, i18n.normalizeKey(e.key), `${e.file}: an unnormalised key reached the inventory`);
    }
    // The block the layout and the scripts depend on are all seen.
    const keys = new Set(inv.map(e => e.key));
    for (const k of ['Sign in', 'Scan your site', 'Who to pitch. What to send.', 'Opening secure checkout…', 'opening {domain}…', 'Your studio is ready — sign in'])
      assert.ok(keys.has(k), `the extractor no longer sees ${JSON.stringify(k)}`);
    for (const k of Object.values(i18n.SUGGEST_KEYS)) assert.ok(keys.has(k), `the suggestion bar's ${JSON.stringify(k)} is not in the inventory`);
  });

  test('no catalogue is stale, and no translation drops a placeholder', () => {
    for (const l of i18n.built().filter(l => l.code !== 'en')) {
      const c = i18n.coverage(l.code);
      assert.deepStrictEqual(c.stale, [],
        `${l.code}: the catalogue holds sentences the site no longer says — delete them (npm run i18n:coverage -- ${l.code})`);
      assert.deepStrictEqual(c.dropped, [],
        `${l.code}: translations that lost a placeholder the English carries`);
      // Reported, never red: the count is printed so a reader sees it, and
      // nothing below asserts on it.
      if (c.missing.length) console.log(`  [i18n] ${l.code}: ${c.missing.length} sentence(s) untranslated — npm run i18n:coverage -- ${l.code}`);
    }
  });

  test('every catalogue is normalised JSON a translator can diff', () => {
    for (const l of i18n.built().filter(l => l.code !== 'en')) {
      const raw = i18n.catalogueOf(l.code).raw;
      for (const [k, v] of Object.entries(raw)) {
        assert.strictEqual(k, i18n.normalizeKey(k), `${l.code}: key is not normalised: ${JSON.stringify(k)}`);
        assert.ok(typeof v === 'string' && v.trim(), `${l.code}: empty translation for ${JSON.stringify(k)}`);
      }
    }
  });

  test('the functions ship every catalogue on disk, as a literal require', () => {
    const map = require('../netlify/lib/strings.js');
    const onDisk = fs.existsSync(i18n.STRINGS_DIR)
      ? fs.readdirSync(i18n.STRINGS_DIR).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).sort()
      : [];
    assert.deepStrictEqual(Object.keys(map).sort(), onDisk,
      'netlify/lib/strings.js must require exactly the catalogues in src/_data/strings/ — the welcome email reads them from there');
    const src = fs.readFileSync(path.join(ROOT, 'netlify', 'lib', 'strings.js'), 'utf8');
    for (const code of onDisk)
      assert.ok(src.includes(`require('../../src/_data/strings/${code}.json')`),
        `${code}: not a literal require — the bundler cannot ship a computed path`);
  });

  test('a language exists exactly when its catalogue does', () => {
    const have = i18n.built().map(l => l.code);
    assert.strictEqual(have[0], 'en');
    for (const l of i18n.LANGUAGES) {
      const file = path.join(i18n.STRINGS_DIR, `${l.code}.json`);
      const page = path.join(SITE, l.prefix.replace(/^\//, ''), 'index.html');
      if (l.code === 'en') continue;
      assert.strictEqual(have.includes(l.code), fs.existsSync(file), `${l.code}: built and catalogue disagree`);
      assert.strictEqual(fs.existsSync(page), fs.existsSync(file), `${l.code}: a page without a catalogue, or the reverse`);
    }
  });

  test('every localized page self-canonicalises and names every sibling, itself and x-default included', () => {
    const pages = htmlPages(SITE).map(p => ({ url: urlOf(p), html: fs.readFileSync(p, 'utf8') }));
    const urls = new Set(pages.map(p => p.url));
    for (const p of pages) {
      const lang = i18n.localeOf(p.url);
      const twins = i18n.built().map(l => i18n.twin(p.url, l.code)).filter(u => urls.has(u));
      const links = [...p.html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="https:\/\/prospektor\.ai([^"]*)">/g)]
        .map(m => [m[1], m[2]]);
      assert.match(p.html, new RegExp(`<link rel="canonical" href="https://prospektor\\.ai${p.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`), `${p.url}: canonical is not itself`);
      assert.match(p.html, new RegExp(`<html lang="${lang}">`), `${p.url}: lang`);
      if (twins.length < 2) {
        assert.deepStrictEqual(links, [], `${p.url}: hreflang on a page with no twin is meaningless (SEO-AUDIT.md R5)`);
        assert.ok(!p.html.includes('class="footer-langs"'), `${p.url}: a switcher with nothing to switch to`);
        assert.ok(!p.html.includes('id="i18n"'), `${p.url}: a payload no script needs`);
        continue;
      }
      const codes = links.filter(([c]) => c !== 'x-default').map(([c]) => c).sort();
      assert.deepStrictEqual(codes, twins.map(u => i18n.localeOf(u)).sort(), `${p.url}: hreflang names a different set of siblings than the build wrote`);
      assert.ok(links.some(([c, u]) => c === lang && u === p.url), `${p.url}: does not name itself`);
      assert.ok(links.some(([c, u]) => c === 'x-default' && u === i18n.englishPath(p.url)), `${p.url}: x-default is not the English page`);
      // The switcher names every twin but this one, and this one as text.
      for (const u of twins) {
        if (u === p.url) assert.match(p.html, /<span aria-current="page">/, `${p.url}: the current language is not marked`);
        else assert.ok(p.html.includes(`<a href="${u}" hreflang="${i18n.localeOf(u)}" lang="${i18n.localeOf(u)}">`), `${p.url}: the switcher does not reach ${u}`);
      }
      // og:locale only off English, where the default is right.
      if (lang !== 'en') assert.match(p.html, /<meta property="og:locale" content="[a-z]{2}_[A-Z]{2}">/, `${p.url}: no og:locale`);
      else assert.doesNotMatch(p.html, /og:locale/, `${p.url}: English carries no og:locale, by design`);
    }
  });

  test('a localized page links only to URLs the build wrote, in its own language where one exists', () => {
    const pages = htmlPages(SITE);
    const urls = new Set(pages.map(urlOf));
    const dead = [], english = [];
    for (const p of pages) {
      const url = urlOf(p);
      const lang = i18n.localeOf(url);
      if (lang === 'en') continue;
      const html = fs.readFileSync(p, 'utf8');
      for (const tag of html.matchAll(/<(?:a|link)\b[^>]*>/g)) {
        // The switcher and the hreflang links point at the OTHER languages by
        // design; every other link on the page is what this test is about.
        if (/\bhreflang=/.test(tag[0])) continue;
        const m = tag[0].match(/href="(\/[^"#?]*)(?:[#?][^"]*)?"/);
        if (!m) continue;
        const href = m[1];
        if (href.startsWith('/assets/') || href.startsWith('/.netlify/')) continue;
        if (!urls.has(href) && !/\.[a-z0-9]+$/i.test(href)) dead.push(`${url} → ${href}`);
        // An English href whose twin exists is a link the layout should have localized.
        const twin = i18n.twin(href, lang);
        if (i18n.localeOf(href) === 'en' && twin !== href && urls.has(twin)) english.push(`${url} → ${href} (${twin} exists)`);
      }
    }
    assert.deepStrictEqual(dead, [], 'dead links on localized pages');
    assert.deepStrictEqual(english, [], 'links that fall back to English although a twin was built');
  });

  test('the page ships the scripts\' sentences, and only those, in its own language', () => {
    for (const l of i18n.built().filter(l => l.code !== 'en')) {
      const html = read(path.join(l.prefix.replace(/^\//, ''), 'index.html'));
      const m = html.match(/<script type="application\/json" id="i18n">([\s\S]*?)<\/script>/);
      assert.ok(m, `${l.code}: no payload`);
      const data = JSON.parse(m[1]);
      assert.strictEqual(data.lang, l.code);
      const clientKeys = new Set(i18n.clientKeys());
      for (const k of Object.keys(data.strings)) assert.ok(clientKeys.has(k), `${l.code}: payload carries a sentence no script says: ${k}`);
      assert.ok(Object.keys(data.strings).length > 0, `${l.code}: the payload is empty`);
      // A translated page was chosen and is never nudged (#544): it carries nothing to nudge with.
      assert.strictEqual(data.suggest, undefined, `${l.code}: the nudge runs on English pages only — no suggest payload here`);
      // The payload sits in <head>, before every deferred script, and i18n.js is first.
      assert.ok(html.indexOf('id="i18n"') < html.indexOf('consent.'), `${l.code}: the payload is after the first deferred script`);
      assert.ok(html.indexOf('/assets/js/i18n.') < html.indexOf('/assets/js/consent.'), `${l.code}: i18n.js must be the first deferred script`);
    }
  });

  test('the sitemap lists every twin of every listed page, and nothing that was not built', () => {
    const xml = read('sitemap.xml');
    const locs = [...xml.matchAll(/<loc>https:\/\/prospektor\.ai([^<]*)<\/loc>/g)].map(m => m[1]);
    const urls = new Set(htmlPages(SITE).map(urlOf));
    for (const loc of locs) assert.ok(urls.has(loc), `sitemap lists ${loc}, which the build did not write`);
    for (const l of i18n.built()) {
      for (const loc of locs.filter(u => i18n.localeOf(u) === 'en')) {
        const twin = i18n.twin(loc, l.code);
        assert.strictEqual(locs.includes(twin), urls.has(twin), `sitemap and build disagree about ${twin}`);
      }
    }
  });

  test('the English page carries the nudge: one line per other language, none for itself (#544)', () => {
    const html = read('index.html');
    const m = html.match(/<script type="application\/json" id="i18n">([\s\S]*?)<\/script>/);
    assert.ok(m, '/: no payload');
    const data = JSON.parse(m[1]);
    assert.strictEqual(data.lang, 'en');
    assert.ok(data.suggest && !('en' in data.suggest), 'an English page never offers English');
    for (const l of i18n.built().filter(l => l.code !== 'en')) {
      const s = data.suggest[l.code];
      assert.ok(s, `no nudge for ${l.code}`);
      assert.deepStrictEqual(Object.keys(s).sort(), ['line', 'stay'], `${l.code}: one line and one close, nothing to explain`);
      assert.ok(s.line.includes(l.own), `${l.code}: the line names the language in itself — ${s.line}`);
      assert.ok(!/\{\w+\}/.test(s.line + s.stay), `${l.code}: an unfilled placeholder`);
    }
  });

  test('the nudge offers once and never redirects', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'js', 'i18n.js'), 'utf8');
    assert.doesNotMatch(js, /location\.(?:assign|replace|href\s*=)|window\.location\s*=/,
      'i18n.js must never navigate on its own — Accept-Language suggests, it does not redirect (HANDOVER-website-funnel.md, 23 Aug 2026)');
    // The browser's own ranking is the only signal (#544): no IP, no geo, no
    // header read back from anywhere — and only the FIRST ranked language.
    assert.match(js, /navigator\.languages/, 'the nudge reads the browser\'s language list');
    assert.doesNotMatch(js, /geolocation|ipapi|ipinfo|cf-ipcountry|x-country|timezone/i, 'the nudge never guesses where the visitor is');
    const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
    assert.doesNotMatch(toml, /Language\s*=/, 'no Accept-Language redirect at the edge either');
  });
});
