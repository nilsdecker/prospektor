'use strict';
// The funnel in more than one language (#114) — the whole mechanism, so that
// .eleventy.js, the tests, the coverage tool and the Netlify functions all
// read the same rules from one file instead of four restatements of them.
//
// The convention is the studio's (#113, Slice B), carried over where it
// transfers: **the English sentence is the key.** There is no English
// catalogue to be incomplete, no id to invent, and no key that can render
// raw — a sentence the catalogue does not hold renders in English, which is
// the one fallback a reader can always use. A catalogue is one JSON file per
// language under `src/_data/strings/`, `{ "English sentence": "translation" }`,
// and a language exists on the site exactly when its file does: `built()`
// below is the list, and nothing hand-lists `/es/` anywhere.
//
// **English is a no-op, byte for byte.** `translate()` returns the key
// untouched for `en` before it looks anything up, so the English pages the
// build writes are the pages it wrote before this file existed — the same
// property #113 held the studio's prompts to, for the same reason: a
// translation layer that moves an English byte has changed the product it
// was meant to leave alone. `test/i18n.test.js` pins it.
//
// Keys are compared after `normalizeKey` — trimmed, inner whitespace
// collapsed — because a paragraph in a template wraps across lines and its
// translation is written on one. Nothing else is normalised: punctuation,
// entities and markup are part of the sentence, and a translator sees them.
const fs = require('node:fs');
const path = require('node:path');

/** The closed set, in the order the operator asked for them (23 Aug 2026),
 *  mirroring `lib/language.js` in the studio. `own` is the language's name in
 *  itself — the one a reader who does not read the others can still find.
 *  `prefix` is the path every page of that language lives under; English has
 *  none, because `/` is the page a visitor who never chose gets. */
const LANGUAGES = [
  { code: 'en', name: 'English', own: 'English',    prefix: '',    og: 'en_US' },
  { code: 'es', name: 'Spanish', own: 'Español',    prefix: '/es', og: 'es_ES' },
  { code: 'de', name: 'German',  own: 'Deutsch',    prefix: '/de', og: 'de_DE' },
  { code: 'nl', name: 'Dutch',   own: 'Nederlands', prefix: '/nl', og: 'nl_NL' },
];
const DEFAULT = 'en';
const BY_CODE = new Map(LANGUAGES.map(l => [l.code, l]));
const STRINGS_DIR = path.join(__dirname, '..', 'src', '_data', 'strings');

/** Trim, and collapse every run of whitespace to one space. Applied to both
 *  sides of a lookup and to nothing that is rendered. */
const normalizeKey = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// One read per build. `.eleventy.js` calls `reload()` from `eleventy.before`
// so `eleventy --serve` sees an edited catalogue without a restart.
let cache = null;
function reload() {
  cache = new Map();
  for (const { code } of LANGUAGES) {
    if (code === DEFAULT) continue;
    const file = path.join(STRINGS_DIR, `${code}.json`);
    if (!fs.existsSync(file)) continue;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const table = new Map();
    for (const [k, v] of Object.entries(raw)) table.set(normalizeKey(k), v);
    cache.set(code, { raw, table, file });
  }
  return cache;
}
const catalogues = () => cache || reload();

/** The catalogues handed in rather than read — for a Netlify function, whose
 *  bundle carries them as literal requires (`netlify/lib/strings.js`) and
 *  cannot promise a `src/` tree on disk. `{ es: <parsed es.json>, … }`. */
function load(raw) {
  cache = new Map();
  for (const [code, obj] of Object.entries(raw || {})) {
    if (!BY_CODE.has(code) || code === DEFAULT || !obj) continue;
    const table = new Map();
    for (const [k, v] of Object.entries(obj)) table.set(normalizeKey(k), v);
    cache.set(code, { raw: obj, table, file: null });
  }
  return cache;
}

/** The catalogue for a code — `{ raw, table, file }` — or null when the
 *  language is not built. English has none, on purpose. */
const catalogueOf = code => catalogues().get(code) || null;

/** The languages this build writes pages for: English, then every language
 *  with a catalogue file, in the set's order. */
const built = () => LANGUAGES.filter(l => l.code === DEFAULT || catalogues().has(l.code));

/** The English name of a code — `Spanish` — or `English` for anything unset. */
const languageName = code => (BY_CODE.get(languageOf(code)) || BY_CODE.get(DEFAULT)).name;

/** A code from the set, or '' — accepts `es`, `es-CO`, `ES`. */
function languageOf(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  if (!text) return '';
  const primary = text.split(/[-_]/)[0];
  return BY_CODE.has(primary) ? primary : '';
}

/** The language a URL is written in, from its first path segment. `/es/x/`
 *  → `es`; anything else → `en`. Only BUILT languages count, so a page that
 *  happens to live at `/de/` before German ships is still an English page. */
function localeOf(url) {
  const m = String(url || '').match(/^\/([a-z]{2})(?:\/|$)/);
  const code = m ? m[1] : '';
  return code && code !== DEFAULT && built().some(l => l.code === code) ? code : DEFAULT;
}

/** The English path behind any URL: `/es/pricing/` → `/pricing/`. */
function englishPath(url) {
  const u = String(url || '');
  const code = localeOf(u);
  if (code === DEFAULT) return u;
  const rest = u.slice(BY_CODE.get(code).prefix.length);
  return rest.startsWith('/') ? rest : '/' + rest;
}

/** Where `url` would live in language `code`. Anchors and queries ride along. */
function twin(url, code) {
  const l = BY_CODE.get(code) || BY_CODE.get(DEFAULT);
  const u = String(url || '');
  const cut = u.search(/[#?]/);
  const pathPart = cut < 0 ? u : u.slice(0, cut);
  const tail = cut < 0 ? '' : u.slice(cut);
  return l.prefix + englishPath(pathPart) + tail;
}

/**
 * The sentence in language `code`. English returns the key as given — not
 * normalised, not trimmed, the same bytes — before any lookup happens. Any
 * other language returns the catalogue's sentence, or `undefined` on a miss
 * so the caller can fall back to English and say so.
 *
 * `vars` fills `{name}` placeholders after the lookup, in whichever sentence
 * won; a translation therefore has to carry every placeholder the English
 * does, which `test/i18n.test.js` checks.
 */
function translate(key, code, vars) {
  const lang = languageOf(code) || DEFAULT;
  let out;
  if (lang === DEFAULT) out = key;
  else {
    const cat = catalogueOf(lang);
    out = cat ? cat.table.get(normalizeKey(key)) : undefined;
  }
  if (out === undefined) return undefined;
  return vars ? fill(out, vars) : out;
}

const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

/** `translate` with the English fallback applied: what a page renders. */
function t(key, code, vars) {
  const hit = translate(key, code, vars);
  return hit === undefined ? (vars ? fill(key, vars) : key) : hit;
}

/** Every `{placeholder}` a sentence carries, as a sorted list. */
const placeholders = s => [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]))].sort();

// ── The inventory: every sentence the site asks a catalogue for ──────────
//
// Static, from the sources, rather than recorded by a build — so the coverage
// tool and the test read the same list without needing a build first, and a
// `{% t %}` block the extractor cannot read is a red test rather than a hole.
//
// Four shapes are read:
//   {% t %}…{% endt %}         in any .njk under src/ — copy with markup in it
//   "…" | t   or   '…' | t      a literal through the filter, same files
//   t('…')                      in src/assets/js — what the browser says
//   t('…'                       in netlify/functions — what an email says
//   CARDS[].topic               in help-render.js — the help hub's card topics
// A block may contain `{{ site.<key> }}`, resolved from site.json so the key
// matches what the build renders; any other expression is refused by name.
const SRC = path.join(__dirname, '..', 'src');
const JS_DIR = path.join(SRC, 'assets', 'js');
const FN_DIR = path.join(__dirname, '..', 'netlify', 'functions');

function njkFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'assets') out.push(...njkFiles(p)); }
    else if (/\.(?:njk|md|html)$/.test(e.name)) out.push(p);
  }
  return out.sort();
}

function resolveSite(text, from) {
  const site = JSON.parse(fs.readFileSync(path.join(SRC, '_data', 'site.json'), 'utf8'));
  return text.replace(/\{\{-?\s*([\s\S]*?)\s*-?\}\}/g, (m, expr) => {
    const site_ = expr.match(/^site\.(\w+)$/);
    if (site_ && typeof site[site_[1]] === 'string') return site[site_[1]];
    throw new Error(`${from}: a {% t %} block carries an expression the extractor cannot read: ${m}`);
  });
}

/** The three sentences the suggestion bar can say, in the language it is
 *  suggesting — asked for by `.eleventy.js` for every built language on every
 *  page that has a twin, so they are part of the inventory by name. */
const SUGGEST_KEYS = {
  line: 'This page is also in {language}.',
  go: 'Read it in {language}',
  stay: 'Not now',
};
function suggestStrings() {
  const out = {};
  for (const l of built()) {
    out[l.code] = {};
    for (const [k, key] of Object.entries(SUGGEST_KEYS)) out[l.code][k] = t(key, l.code, { language: l.own });
  }
  return out;
}

// The values a template passes through the `t` FILTER rather than writing in
// a block: site.json's labels and lines, and the frontmatter of every template
// that renders in more than one language — its title, its description and,
// since #535, any `faqs:` list it carries (/help/ renders its FAQ from
// frontmatter, and the FAQPage structured data from the same list). Read from
// the same files the build reads, through the same parser Eleventy uses, so a
// YAML list is read as a list rather than guessed at with a regex.
const matter = require('gray-matter');
function frontmatterOf(text, from) {
  try { return matter(text).data || {}; }
  catch (e) { throw new Error(`${from}: frontmatter the extractor cannot read: ${e.message}`); }
}
// A template renders in more than one language when it paginates over the
// built languages, or when its permalink is prefixed by an edition's (#535:
// /help/ paginates over the studio's editions, whose `prefix` is a language's).
const multilingual = fm =>
  (fm.pagination && fm.pagination.data === 'languages') || /\.prefix\s*\}\}/.test(String(fm.permalink || ''));

function dataStrings() {
  const site = JSON.parse(fs.readFileSync(path.join(SRC, '_data', 'site.json'), 'utf8'));
  const out = [];
  const siteFile = path.join(SRC, '_data', 'site.json');
  for (const k of ['tagline', 'description']) if (site[k]) out.push([site[k], siteFile]);
  for (const list of ['nav', 'legal']) for (const item of site[list] || []) out.push([item.label, siteFile]);
  for (const f of njkFiles(SRC)) {
    const text = fs.readFileSync(f, 'utf8');
    if (!/^---\n[\s\S]*?\n---/.test(text)) continue;
    const fm = frontmatterOf(text, path.relative(SRC, f));
    if (!multilingual(fm)) continue;
    for (const k of ['title', 'seoTitle', 'description'])
      if (typeof fm[k] === 'string' && fm[k] && !/\{\{|\{%/.test(fm[k])) out.push([fm[k], f]);
    for (const q of Array.isArray(fm.faqs) ? fm.faqs : [])
      for (const k of ['q', 'a', 'linkLabel'])
        if (q && typeof q[k] === 'string' && q[k]) out.push([q[k], f]);
  }
  return out;
}

// The card face of each help guide — emoji and topic — lives in
// help-render.js, not in the corpus (#145), and the topic is a word a reader
// sees on the hub in every language. It is asked for by the build (the hub's
// cards) and by the browser (help.js repaints the hub when the studio's
// corpus has moved), so it ships inline like a script's sentence does.
const HELP_RENDER = path.join(JS_DIR, 'help-render.js');
function cardStrings() {
  const H = require(HELP_RENDER);
  const topics = Object.values(H.CARDS || {}).map(c => c.topic).concat(H.DEFAULT_CARD ? [H.DEFAULT_CARD.topic] : []);
  return [...new Set(topics.filter(Boolean))];
}

/** `[{ key, file, kind }]` for every sentence the templates and scripts ask
 *  for. Keys are normalised; a file that uses the same sentence twice lists
 *  it once. */
function inventory() {
  const found = [];
  const seen = new Set();
  const add = (key, file, kind) => {
    const k = normalizeKey(key);
    if (!k) throw new Error(`${file}: an empty ${kind} string`);
    const id = file + '\0' + k;
    if (seen.has(id)) return;
    seen.add(id);
    found.push({ key: k, file: path.relative(path.join(__dirname, '..'), file), kind });
  };
  for (const key of Object.values(SUGGEST_KEYS)) add(key, __filename, 'site');
  for (const [key, file] of dataStrings()) add(key, file, 'data');
  for (const key of cardStrings()) add(key, HELP_RENDER, 'card');
  for (const f of njkFiles(SRC)) {
    // Read the way Nunjucks reads it: the frontmatter is data, not template,
    // and a `{# … #}` comment renders nothing — so a `{% t %}` written inside
    // either (this file's own docs, a template's reasoning) is not a block.
    const text = fs.readFileSync(f, 'utf8')
      .replace(/^---\n[\s\S]*?\n---/, '')
      .replace(/\{#-?[\s\S]*?-?#\}/g, '');
    for (const m of text.matchAll(/\{%-?\s*t\s*-?%\}([\s\S]*?)\{%-?\s*endt\s*-?%\}/g))
      add(resolveSite(m[1], path.relative(SRC, f)), f, 'block');
    if (/\{%-?\s*t\s*-?%\}/.test(text.replace(/\{%-?\s*t\s*-?%\}([\s\S]*?)\{%-?\s*endt\s*-?%\}/g, '')))
      throw new Error(`${path.relative(SRC, f)}: a {% t %} without its {% endt %}`);
    for (const m of text.matchAll(/(["'])((?:(?!\1)[^\\]|\\.)*)\1\s*\|\s*t\b/g)) add(m[2], f, 'filter');
  }
  for (const [dir, kind] of [[JS_DIR, 'script'], [FN_DIR, 'mail']]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.js')).sort()) {
      const f = path.join(dir, name);
      const text = fs.readFileSync(f, 'utf8');
      for (const m of text.matchAll(/(?<![\w.$])t\(\s*(["'])((?:(?!\1)[^\\\n]|\\.)*)\1/g))
        add(m[2].replace(/\\(['"])/g, '$1'), f, kind);
    }
  }
  return found;
}

/** The keys the browser asks for — the subset a page has to ship inline: what
 *  a script says, and the help cards' topics, which help.js repaints. */
const CLIENT_KINDS = new Set(['script', 'card']);
const clientKeys = () => [...new Set(inventory().filter(e => CLIENT_KINDS.has(e.kind)).map(e => e.key))];

/** `{ key: translation }` for the client keys the catalogue holds. English
 *  ships nothing: `t()` in the browser falls back to the key. */
function clientStrings(code) {
  const cat = catalogueOf(languageOf(code));
  if (!cat) return null;
  const out = {};
  for (const k of clientKeys()) { const v = cat.table.get(k); if (v !== undefined) out[k] = v; }
  return out;
}

/** The coverage report for one language: what the sources ask for that the
 *  catalogue lacks (`missing`), what the catalogue holds that no source says
 *  any more (`stale`), and translations that lost a placeholder (`dropped`). */
function coverage(code) {
  const cat = catalogueOf(code);
  const inv = inventory();
  const keys = new Set(inv.map(e => e.key));
  const table = cat ? cat.table : new Map();
  const missing = inv.filter(e => !table.has(e.key));
  const stale = [...table.keys()].filter(k => !keys.has(k));
  const dropped = [];
  for (const [k, v] of table) {
    const want = placeholders(k), got = placeholders(v);
    if (want.some(p => !got.includes(p))) dropped.push({ key: k, want, got });
  }
  return { code, built: !!cat, total: keys.size, translated: keys.size - new Set(missing.map(e => e.key)).size, missing, stale, dropped };
}

module.exports = {
  LANGUAGES, DEFAULT, STRINGS_DIR, normalizeKey, reload, load, catalogues, catalogueOf, built,
  languageOf, languageName, localeOf, englishPath, twin, translate, t, fill, placeholders,
  inventory, clientKeys, clientStrings, coverage, SUGGEST_KEYS, suggestStrings, dataStrings,
};
