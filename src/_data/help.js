/* The help corpus, at build time (#136) — in every language the studio holds it in (#535).

   `/help/` used to be a client-rendered shell: 6,265 bytes whose entire body
   copy was the nav, the H1, one sentence and the word "Loading…". Ten guides
   of real long-tail content were invisible to every crawler, because the
   corpus only arrived from the studio after the page had loaded.

   So the corpus is fetched here, during the Eleventy build, and rendered into
   the served HTML. The runtime fetch in help.js stays exactly where it was —
   that is #76's property and it is worth keeping: a help change is live for a
   *human* the moment the studio deploys, with no website publish step in
   between. What this adds is that the *crawlable* copy is at most one build
   stale, which is the whole trade.

   ── The rule this file exists to enforce ──
   A studio outage must never break a website deploy. An unrelated service
   blinking and taking the marketing site's build down with it is a worse bug
   than the one being fixed here. So there is no code path in this file that
   throws: it tries the live endpoint, falls back to the committed snapshot,
   and failing both returns an empty corpus — which ships the page in exactly
   the runtime-only state it had before this row. Every fallback is logged
   loudly, because a silent fallback would let the snapshot rot for weeks.

   ── Editions (#535) ──
   Since #113 Slice D the studio serves the corpus per language:
   `/api/help?lang=es` answers the same files, each stamped `language: "es"`
   where a translation exists and `"en"` where it does not — the fallback is
   PER DOCUMENT, so a page never goes missing. This file asks for one edition
   per language the site is built in (`lib/i18n.js`'s list, never a list kept
   here) and writes `/<code>/help/` and its guide pages only when the studio
   holds at least one file in that language. German and Dutch answer today
   with every file in English, so they get no edition and no URLs — a hub of
   English text under `/de/` would be duplicate content wearing a flag. The
   day the studio ships one German guide, `/de/help/` exists at the next
   build, with nobody editing this repo. A file the edition holds in English
   is still written, marked as not yet translated, `noindex`, and kept out of
   the sitemap (see src/help-guide.njk). */

const fs = require('node:fs');
const path = require('node:path');
const H = require('../assets/js/help-render.js');
const i18n = require('../../lib/i18n.js');

// `HELP_API` is an override for the tests that rehearse a studio outage — the
// only way to prove the build survives one without waiting for a real one.
const API = process.env.HELP_API || 'https://studio.prospektor.ai/api/help';
const DATA = path.join(__dirname, '..', '..', 'data');
// `data/help-corpus.json` is the English snapshot; a language's is
// `data/help-corpus.<code>.json`, written by `npm run help:snapshot` only for
// a language the studio actually holds — so the file's existence is itself
// the offline answer to "is there an edition".
const snapshotFor = code => path.join(DATA, code === i18n.DEFAULT ? 'help-corpus.json' : `help-corpus.${code}.json`);
const apiFor = code => API + (code === i18n.DEFAULT ? '' : (API.includes('?') ? '&' : '?') + 'lang=' + encodeURIComponent(code));
const TIMEOUT_MS = Number(process.env.HELP_CORPUS_TIMEOUT_MS || 8000);

function loud(what, why) {
  console.warn(
    '\n  ┌─ help corpus ─────────────────────────────────────────────\n' +
    '  │  ' + what + '\n' +
    '  │  ' + why + '\n' +
    '  │  The build continues on purpose (#136): a studio outage must\n' +
    '  │  never fail a website deploy. /help/ will be at most one\n' +
    '  │  corpus behind, and the runtime fetch still corrects it in\n' +
    '  │  the browser. Refresh with `npm run help:snapshot`.\n' +
    '  └───────────────────────────────────────────────────────────\n');
}

/* The endpoint answering 200 is not the same as the endpoint answering with a
   corpus — during #131 the studio served its own app shell on a path that was
   expected to be a file, with a perfectly good status code on it. */
function validate(body) {
  if (!body || typeof body !== 'object') return 'response was not an object';
  if (!Array.isArray(body.files)) return 'response had no files array';
  if (!body.files.length) return 'corpus was empty';
  for (const f of body.files) {
    if (!f || typeof f.name !== 'string' || !f.name) return 'a file had no name';
    if (typeof f.text !== 'string' || !f.text.trim()) return `${f.name} had no text`;
    if (!/^#\s+/m.test(f.text)) return `${f.name} has no markdown heading — probably not a guide`;
  }
  return null;
}

// What is carried through of each file: the name, the text, and the language
// the studio served it in. An older studio (or the 24 Aug snapshot) says no
// language and means English.
const fileOf = f => ({ name: f.name, text: f.text, language: i18n.languageOf(f.language) || i18n.DEFAULT });

async function fetchLive(code) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(apiFor(code), { signal: control.signal });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const body = await r.json();
    const bad = validate(body);
    return bad ? { error: bad } : { files: body.files.map(fileOf) };
  } catch (e) {
    return { error: e.name === 'AbortError' ? `no answer in ${TIMEOUT_MS}ms` : e.message };
  } finally {
    clearTimeout(timer);
  }
}

function readSnapshot(code) {
  try {
    const body = JSON.parse(fs.readFileSync(snapshotFor(code), 'utf8'));
    const bad = validate(body);
    return bad ? { error: bad } : { files: body.files.map(fileOf), fetchedAt: body.fetchedAt };
  } catch (e) {
    return { error: e.code === 'ENOENT' ? 'no snapshot committed' : e.message };
  }
}

/* One language's corpus: live → snapshot → nothing, every fallback logged.
   For a language other than English a live answer that holds not one file in
   that language is a real answer — "the studio has none yet" — and is
   returned as such rather than falling through to a snapshot that would say
   otherwise. */
async function corpusFor(code, offline) {
  const live = offline ? { error: 'HELP_CORPUS_OFFLINE=1' } : await fetchLive(code);
  const own = files => files.filter(f => f.language === code).length;
  if (live.files) {
    if (code !== i18n.DEFAULT && !own(live.files)) return { files: [], source: 'none', note: 'the studio holds no guide in this language' };
    return { files: live.files, source: 'live', note: '' };
  }
  const snap = readSnapshot(code);
  if (snap.files) {
    if (!offline) loud(`Falling back to the committed ${code} snapshot.`, `The studio's /api/help did not answer usefully: ${live.error}.`);
    return { files: snap.files, source: 'snapshot', note: snap.fetchedAt ? `snapshot taken ${snap.fetchedAt}` : '' };
  }
  if (code === i18n.DEFAULT) {
    if (!offline) loud('Shipping /help/ runtime-only — nothing was prerendered.', `Live: ${live.error}. Snapshot: ${snap.error}.`);
    else loud('Shipping /help/ runtime-only — nothing was prerendered.', `Offline build and ${snap.error}.`);
  }
  return { files: [], source: 'none', note: `live: ${live.error}; snapshot: ${snap.error}` };
}

const TITLE_BUDGET = 60;
function seoTitleOf(title) {
  if (!title || title.length <= TITLE_BUDGET) return title;
  const head = title.split(/\s+[—–:]\s+/)[0];
  return head && head.length <= TITLE_BUDGET ? head : title;
}

/* One edition: a language, its corpus, and everything the templates render
   from it. The English edition is also spread over the top level of what this
   file returns, so `help.guides`, `help.hash` and the rest read exactly as
   they did before #535. */
function edition(lang, files, source) {
  // `text` is carried through so the per-guide pages (#166) can stamp the hash
  // of the one guide they show, and so a longer meta description can be cut
  // from the same markdown the card's dek comes from.
  const byName = new Map(files.map(f => [f.name, f]));
  const guides = H.buildIndex(files).map(g => ({
    slug: g.slug,
    name: g.name,
    title: g.title,
    dek: g.dek,
    // The card's dek is cut to 116 characters and the search snippet under it
    // is what sells the click; a meta description gets the ~155 Google renders.
    description: H.dekFor((byName.get(g.name) || {}).text || '', 155),
    // The <title> budget (#137, test/seo.test.js): ~60 characters, or the tail
    // is cut. A guide's title is the studio's and can run past it — the
    // Spanish "Buenas prácticas — cómo los equipos consiguen mejores pitches"
    // is 61 — so a title that does not fit gives search its head, the part
    // before the studio's own dash, which is the guide's name; the <h1> a
    // reader sees is untouched. Rewrite, never clip: no ellipsis, no cut
    // mid-word, and a title with no dash and no fit is kept whole and fails
    // the test by name, which is the right place to decide it.
    seoTitle: seoTitleOf(g.title),
    emoji: g.emoji,
    topic: g.topic,
    language: g.language,
    html: g.html,
    // The same HTML without the guide's own title, for /help/<slug>/ where the
    // title is the page's <h1> rather than the first thing in the body.
    body: H.bodyOf(g.html),
    hash: H.corpusHash([{ name: g.name, text: (byName.get(g.name) || {}).text || '' }]),
  }));

  // The same bytes the browser will hash the live corpus against. `<` is
  // escaped so the JSON can sit inside a <script> element without a "</script>"
  // inside a guide ending it early. The hash is over name + text, as it always
  // was, so an edition whose translations arrive re-renders and one whose
  // files did not move does not.
  const hashed = files.map(f => ({ name: f.name, text: f.text }));
  const corpus = { hash: H.corpusHash(hashed), files };
  const corpusJson = JSON.stringify(corpus).replace(/</g, '\\u003c');

  return {
    code: lang.code, prefix: lang.prefix, own: lang.own, name: lang.name,
    source, hash: corpus.hash, guides, slugs: guides.map(g => g.slug), corpusJson, count: files.length,
    translated: files.filter(f => f.language === lang.code).length,
  };
}

module.exports = async function () {
  // `HELP_CORPUS_OFFLINE=1` is what `npm test` sets: the function tests are
  // documented as needing no network, and a test suite that reaches the
  // studio is a test suite that goes red when the studio deploys.
  const offline = process.env.HELP_CORPUS_OFFLINE === '1';

  const editions = [];
  for (const lang of i18n.built()) {
    const { files, source, note } = await corpusFor(lang.code, offline);
    if (lang.code !== i18n.DEFAULT && !files.length) {
      console.log(`  [help] no ${lang.code} edition — ${note}`);
      continue;
    }
    const e = edition(lang, files, source);
    if (source !== 'none') {
      console.log(`  [help] ${lang.code}: ${files.length} guides prerendered from the ${source} corpus (${e.hash})`
        + (lang.code !== i18n.DEFAULT ? `, ${e.translated} in ${lang.name}` : '') + (note ? ' — ' + note : ''));
    }
    editions.push(e);
  }

  const en = editions[0];
  return {
    // The English edition, spread: what every template read before #535.
    source: en.source, hash: en.hash, guides: en.guides, slugs: en.slugs, corpusJson: en.corpusJson, count: en.count,
    // Every edition, English first; and every guide page the build writes,
    // for src/help-guide.njk to paginate over.
    editions,
    pages: editions.flatMap(e => e.guides.map(guide => ({ edition: e, guide, noindex: guide.language !== e.code }))),
  };
};
