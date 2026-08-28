// Content-hashed assets (#169).
//
// The change these guard is two halves that are only correct together: the
// build writes css, js and fonts under a filename carrying a hash of their
// bytes, and `netlify.toml` answers `max-age=31536000, immutable` for exactly
// those trees. Shipping one half is worse than shipping neither — a long
// cache on an unhashed name serves a stale stylesheet for a year, and a hash
// with no header buys a repeat visitor nothing.
//
// What these guard, in the order they would break:
//   - every asset a built page names actually exists in the output. The old
//     dead-link check skipped `/assets/` because the names were fixed; now
//     they are computed, and a reference the build does not produce is a page
//     with no stylesheet;
//   - the name matches the bytes. A manifest written once and gone stale is
//     the one failure this mechanism exists to make impossible, so the hash in
//     every served filename is recomputed from the file's own contents;
//   - no page still names an unhashed path in a hashed tree — that URL is not
//     served at all any more;
//   - the headers and the hashing agree, in BOTH directions: a hashed tree
//     that lost its `immutable` header is the whole point thrown away, and an
//     `immutable` header on a tree the build does not hash is the stale-for-a-
//     year bug.
//
// Nothing here counts assets. Adding a stylesheet, a script or a font can only
// turn this red by being unhashed or unreferenced — the #131 rule, that
// friction points at the defect and never at the work.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const A = require('../lib/assets.js');
const { siteBuild } = require('./helpers.js');

let SITE, built;
const htmlPages = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? htmlPages(path.join(dir, e.name))
    : e.name.endsWith('.html') ? [path.join(dir, e.name)] : []);

// Every `/assets/…` URL a built page names, from href, src and the absolute
// URLs inside the JSON-LD graph — derived from the output, never from a list.
const ASSET_REF = /\/assets\/[A-Za-z0-9][A-Za-z0-9._/-]*\.[A-Za-z0-9]+/g;
const refsIn = html => [...new Set(html.match(ASSET_REF) || [])];

const inHashedTree = url => A.HASHED_TREES.includes(url.split('/')[2])
  && A.HASHED_EXT.has(path.extname(url));

describe('assets carry a content hash, and are cached forever because of it', () => {
  before(() => { built = siteBuild('assets'); SITE = built.dir; });
  after(() => built && built.cleanup());

  test('every asset a page names is actually served', () => {
    const dead = [];
    for (const p of htmlPages(SITE))
      for (const ref of refsIn(fs.readFileSync(p, 'utf8')))
        if (!fs.existsSync(path.join(SITE, ref))) dead.push(`${path.relative(SITE, p)} → ${ref}`);
    assert.deepEqual(dead, [], 'these pages name an asset this build does not write');
  });

  test('every css, js and font a page names carries a hash of its own bytes', () => {
    const wrong = [];
    for (const p of htmlPages(SITE)) {
      for (const ref of refsIn(fs.readFileSync(p, 'utf8'))) {
        if (!inHashedTree(ref)) continue;
        const m = ref.match(A.HASHED_NAME);
        if (!m) { wrong.push(`${path.relative(SITE, p)} → ${ref} has no hash`); continue; }
        const file = path.join(SITE, ref);
        if (!fs.existsSync(file)) continue;   // the previous test names it
        const real = crypto.createHash('sha256').update(fs.readFileSync(file))
          .digest('hex').slice(0, A.HASH_LEN);
        const named = m[0].split('.')[1];
        if (named !== real) wrong.push(`${ref} is named ${named} but its bytes hash to ${real}`);
      }
    }
    assert.deepEqual(wrong, [], 'a name that does not match its bytes is a cache poisoned for a year');
  });

  test('no page still names an unhashed css, js or font URL', () => {
    const stale = [];
    for (const p of htmlPages(SITE))
      for (const ref of refsIn(fs.readFileSync(p, 'utf8')))
        if (inHashedTree(ref) && !A.HASHED_NAME.test(ref))
          stale.push(`${path.relative(SITE, p)} → ${ref}`);
    assert.deepEqual(stale, [],
      'that URL is not served any more — put the reference through the `asset` filter');
  });

  test('a stylesheet names the fonts by their hashed URLs too', () => {
    // The one reference a template cannot fix, because it lives inside a file's
    // own bytes: fonts.css names four woff2 files. If the rewrite were dropped
    // the page would still render — in a fallback font, silently.
    const css = fs.readFileSync(path.join(SITE, A.served('/assets/css/fonts.css')), 'utf8');
    const fonts = refsIn(css).filter(r => r.endsWith('.woff2'));
    assert.ok(fonts.length > 0, 'fonts.css names no font files at all');
    for (const f of fonts) {
      assert.match(f, A.HASHED_NAME, `${f} inside fonts.css was never rewritten`);
      assert.ok(fs.existsSync(path.join(SITE, f)), `${f} inside fonts.css is not served`);
    }
  });

  test('the images are deliberately left alone', () => {
    // Not an oversight and not a TODO: the Open Graph cards are referenced by
    // absolute URL from caches this repo does not control, so their URLs must
    // not move. `netlify.toml` gives them a day rather than a year for the
    // same reason.
    const card = A.served('/assets/img/og.png');
    assert.equal(card, '/assets/img/og.png', 'og.png must keep its URL — other people’s caches hold it');
    assert.ok(fs.existsSync(path.join(SITE, card)));
  });
});

describe('the cache headers and the hashing are one change', () => {
  // Parsed rather than string-matched, so reordering or reformatting
  // netlify.toml cannot quietly pass or quietly fail.
  const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
  const rules = [...toml.matchAll(/\[\[headers\]\]\s*\n\s*for\s*=\s*"([^"]+)"([\s\S]*?)(?=\n\[\[|\n#|$)/g)]
    .map(m => ({ for: m[1], values: m[2] }));
  const cacheFor = glob => {
    const r = rules.find(x => x.for === glob);
    const m = r && r.values.match(/Cache-Control\s*=\s*"([^"]*)"/);
    return m ? m[1] : null;
  };

  test('every hashed tree is served immutable and forever', () => {
    for (const tree of A.HASHED_TREES) {
      const cc = cacheFor(`/assets/${tree}/*`);
      assert.ok(cc, `netlify.toml has no Cache-Control for /assets/${tree}/* — ` +
        'hashed filenames with no long cache buy a repeat visitor nothing');
      assert.match(cc, /max-age=31536000/, `/assets/${tree}/* is not cached for a year: ${cc}`);
      assert.match(cc, /\bimmutable\b/, `/assets/${tree}/* is missing immutable: ${cc}`);
    }
  });

  test('nothing is served immutable unless the build hashes it', () => {
    const unsafe = rules
      .filter(r => /\bimmutable\b/.test(r.values) && r.for.startsWith('/assets/'))
      .map(r => r.for)
      .filter(f => !A.HASHED_TREES.some(t => f === `/assets/${t}/*`));
    assert.deepEqual(unsafe, [],
      'an immutable cache on a filename with no content hash serves a stale file for a year');
  });

  test('the images get a cache they can safely be given', () => {
    const cc = cacheFor('/assets/img/*');
    assert.ok(cc, 'netlify.toml has no Cache-Control for /assets/img/*');
    assert.doesNotMatch(cc, /\bimmutable\b/, 'the OG cards keep their URLs, so they must stay revalidatable');
    const maxAge = Number((cc.match(/max-age=(\d+)/) || [])[1]);
    assert.ok(maxAge > 0, `/assets/img/* still revalidates on every visit: ${cc}`);
  });
});

describe('nothing that asks production names an asset by its old URL', () => {
  // The mistake this exists to catch was made while shipping #169 itself:
  // `npm run audit` asserted `/assets/js/buy.js` appears in the served
  // /pricing/ HTML, and after the deploy that URL does not exist — the claim
  // failed while the page was perfectly fine, which is the worst kind of
  // failure because it teaches you to distrust the audit.
  //
  // The rule: a file that fetches from a live origin may never spell an
  // unhashed css, js or font URL, because production does not serve one. It
  // matches by what it does — anything reading AUDIT_SITE — rather than by a
  // list of filenames, so the next production-checking tool is covered on the
  // day it is written. A hash-tolerant pattern such as
  // `consent(?:\.[0-9a-f]+)?\.js` is exactly what these should use, and is
  // not a finding.
  const dirs = ['test', 'tools'];
  const sources = dirs.flatMap(d => fs.readdirSync(path.join(ROOT, d))
    .filter(f => f.endsWith('.js'))
    .map(f => ({ rel: `${d}/${f}`, text: fs.readFileSync(path.join(ROOT, d, f), 'utf8') })))
    // Reads AUDIT_SITE *and* fetches: that is what makes a file one that talks
    // to a live origin, rather than one that merely mentions the variable —
    // this file does, a few lines up.
    .filter(f => f.text.includes('AUDIT_SITE') && /\bfetch\s*\(/.test(f.text));

  test('and there is something asking production in the first place', () => {
    assert.ok(sources.length >= 2, `only ${sources.length} file(s) read AUDIT_SITE`);
  });

  test('every asset URL they spell allows for the hash', () => {
    // The optional-hash group is blanked to a token no filename can contain,
    // so a pattern written to tolerate a hash cannot look like a literal.
    const LITERAL = /\/assets\\?\/(?:css|js|fonts)\\?\/[A-Za-z0-9_-]+\\?\.(?:css|js|woff2)/g;
    const stale = [];
    for (const { rel, text } of sources) {
      const masked = text.split('(?:\\.[0-9a-f]+)?').join('\u00ab\u00bb');
      for (const m of masked.match(LITERAL) || []) stale.push(`${rel} → ${m}`);
    }
    assert.deepEqual(stale, [],
      'production serves no such URL since #169 — allow for the content hash');
  });
});

describe('the manifest is a function of the bytes', () => {
  test('the same source tree produces the same names', () => {
    assert.deepEqual([...A.build().manifest], [...A.build().manifest]);
  });

  test('a changed byte is a changed URL', () => {
    // The property the whole cache policy rests on, checked directly rather
    // than reasoned about: hash the same file's contents with one byte added
    // and the served name must move.
    const url = '/assets/css/main.css';
    const src = path.join(A.SRC, 'css', 'main.css');
    const before = A.build().manifest.get(url);
    const original = fs.readFileSync(src);
    try {
      fs.writeFileSync(src, Buffer.concat([original, Buffer.from('\n/* x */\n')]));
      assert.notEqual(A.build().manifest.get(url), before,
        'editing a stylesheet did not change its URL — every cached copy would stay stale forever');
    } finally {
      fs.writeFileSync(src, original);
    }
    assert.equal(A.build().manifest.get(url), before, 'the source file was not restored');
  });
});
