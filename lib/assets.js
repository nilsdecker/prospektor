'use strict';

// Content-hashed asset filenames (#169).
//
// Every asset this site served answered `cache-control: public, max-age=0,
// must-revalidate`, and Netlify could not safely do better: a long cache on a
// filename like `main.css` serves a stale stylesheet after the next deploy.
// The cost was not bandwidth — an ETag makes each one a 304 — it was **eight
// conditional round trips before a repeat visitor sees anything**, which is an
// LCP tax on exactly the visitor most likely to buy.
//
// The fix is the standard one and it has two halves that only work together:
// the filename carries a hash of the bytes, so a changed file is a *different
// URL*; and `netlify.toml` may then answer `max-age=31536000, immutable` for
// the trees whose names carry one. Shipping either half alone is a bug — a
// long cache on an unhashed name serves stale files for a year, and a hash
// with no header buys nothing. `test/assets.test.js` pins the two together.
//
// WHAT IS HASHED, and why the line is drawn here:
//
//   css, js, fonts  — hashed. These are what a page actually blocks on, they
//                     are referenced only from this repo's own output, and a
//                     changed one must reach the browser at the next deploy.
//   img             — NOT hashed. The Open Graph cards are referenced by
//                     absolute URL from other people's caches (Slack, X,
//                     LinkedIn) and from links already shared; changing those
//                     URLs would blank cards that render today. They also cost
//                     a visitor nothing — a social crawler fetches them, a
//                     reader does not. They get a day's cache, no `immutable`.
//
// ORDER MATTERS. `fonts.css` names the woff2 files by URL, so the fonts are
// hashed first and the stylesheet's bytes are rewritten to the hashed names
// *before* the stylesheet itself is hashed. Rewriting after hashing would
// publish a stylesheet whose name no longer matches its contents, which is the
// one failure this whole mechanism exists to make impossible.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SRC = path.join(__dirname, '..', 'src', 'assets');

// In dependency order: a tree may only reference assets from a tree before it.
const HASHED_TREES = ['fonts', 'css', 'js'];
const HASHED_EXT = new Set(['.woff2', '.css', '.js']);
// File types whose contents name other assets and must be rewritten.
const REWRITTEN_EXT = new Set(['.css']);

const HASH_LEN = 10;
// What a hashed name looks like, for the tests and for the production audit.
const HASHED_NAME = new RegExp(`\\.[0-9a-f]{${HASH_LEN}}\\.(?:css|js|woff2)$`);
// Any `/assets/…` URL with a file extension, as it appears inside a stylesheet.
const ASSET_REF = /\/assets\/[A-Za-z0-9][A-Za-z0-9._/-]*\.[A-Za-z0-9]+/g;

const hash = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, HASH_LEN);

const tree = url => url.split('/')[2];
const srcPath = url => path.join(SRC, url.replace(/^\/assets\//, ''));

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push('/assets/' + path.relative(SRC, p).split(path.sep).join('/'));
  }
  return out;
}

// Rewrite the asset URLs a file's own bytes carry. An unknown reference is a
// build error rather than a silent passthrough: a stylesheet pointing at a
// font this build does not produce is a missing font in production, and it is
// worth finding here instead of in a screenshot.
function rewrite(text, manifest, from) {
  return text.replace(ASSET_REF, ref => {
    const to = manifest.get(ref);
    if (!to) throw new Error(`${from} references ${ref}, which this build does not produce`);
    return to;
  });
}

// The whole manifest, computed from the source tree and nothing else — same
// input bytes, same output names, on any machine and in any order.
function build() {
  const all = walk(SRC);
  const manifest = new Map();   // logical URL → served URL
  const files = [];             // { url, body } in served-URL terms

  const add = (url, served, body) => { manifest.set(url, served); files.push({ url: served, body }); };

  const hashed = url => HASHED_TREES.includes(tree(url)) && HASHED_EXT.has(path.extname(url));

  for (const url of all) if (!hashed(url)) add(url, url, fs.readFileSync(srcPath(url)));

  for (const t of HASHED_TREES) {
    for (const url of all.filter(u => hashed(u) && tree(u) === t)) {
      let body = fs.readFileSync(srcPath(url));
      if (REWRITTEN_EXT.has(path.extname(url))) body = Buffer.from(rewrite(body.toString('utf8'), manifest, url));
      const ext = path.extname(url);
      add(url, `${url.slice(0, -ext.length)}.${hash(body)}${ext}`, body);
    }
  }

  return { manifest, files };
}

// Write the manifest into the output directory, and delete anything left over
// in a hashed tree from an earlier build. Eleventy does not clean its output,
// so without the prune a local `_site` accumulates every hash it has ever
// produced — and a stale file makes a dead reference look alive to the tests.
function emit(outDir, built = build()) {
  for (const { url, body } of built.files) {
    const dest = path.join(outDir, url);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body);
  }
  const keep = new Set(built.files.map(f => f.url));
  for (const t of HASHED_TREES) {
    const dir = path.join(outDir, 'assets', t);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const url = `/assets/${t}/${name}`;
      if (!keep.has(url) && fs.statSync(path.join(dir, name)).isFile()) fs.unlinkSync(path.join(dir, name));
    }
  }
  return built;
}

// Where Eleventy actually wrote this build. `--output=<dir>` does not reach
// the config object the `eleventy.after` event hands over, so the directory is
// recovered from a page Eleventy just wrote: an output path minus the URL it
// was written for is the root everything else hangs off.
function outputRoot(ev) {
  const first = (ev && ev.results || [])[0];
  if (first && first.outputPath && first.url) {
    const suffix = first.url.endsWith('/') ? first.url + 'index.html' : first.url;
    if (first.outputPath.endsWith(suffix)) return first.outputPath.slice(0, -suffix.length) || '.';
  }
  return (ev && ev.dir && ev.dir.output) || '_site';
}

// The URL a source asset is actually served under. For tests and tools that
// need to name one built asset without rebuilding the manifest each time —
// memoised, because the manifest is a pure function of the source tree.
let memo = null;
function served(url) {
  if (!memo) memo = build().manifest;
  const out = memo.get(url);
  if (!out) throw new Error(`served: nothing built at ${url}`);
  return out;
}

module.exports = { build, emit, served, outputRoot, HASHED_TREES, HASHED_EXT, HASHED_NAME, HASH_LEN, SRC };
