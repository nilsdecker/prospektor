/* The help corpus, at build time (#136).

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
   loudly, because a silent fallback would let the snapshot rot for weeks. */

const fs = require('node:fs');
const path = require('node:path');
const H = require('../assets/js/help-render.js');

// `HELP_API` is an override for the tests that rehearse a studio outage — the
// only way to prove the build survives one without waiting for a real one.
const API = process.env.HELP_API || 'https://studio.prospektor.ai/api/help';
const SNAPSHOT = path.join(__dirname, '..', '..', 'data', 'help-corpus.json');
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

async function fetchLive() {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(API, { signal: control.signal });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const body = await r.json();
    const bad = validate(body);
    return bad ? { error: bad } : { files: body.files };
  } catch (e) {
    return { error: e.name === 'AbortError' ? `no answer in ${TIMEOUT_MS}ms` : e.message };
  } finally {
    clearTimeout(timer);
  }
}

function readSnapshot() {
  try {
    const body = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const bad = validate(body);
    return bad ? { error: bad } : { files: body.files, fetchedAt: body.fetchedAt };
  } catch (e) {
    return { error: e.code === 'ENOENT' ? 'no snapshot committed' : e.message };
  }
}

module.exports = async function () {
  let files = [];
  let source = 'none';
  let note = '';

  // `HELP_CORPUS_OFFLINE=1` is what `npm test` sets: the function tests are
  // documented as needing no network, and a test suite that reaches the
  // studio is a test suite that goes red when the studio deploys.
  const offline = process.env.HELP_CORPUS_OFFLINE === '1';
  const live = offline ? { error: 'HELP_CORPUS_OFFLINE=1' } : await fetchLive();

  if (live.files) {
    files = live.files;
    source = 'live';
  } else {
    const snap = readSnapshot();
    if (snap.files) {
      files = snap.files;
      source = 'snapshot';
      note = snap.fetchedAt ? `snapshot taken ${snap.fetchedAt}` : '';
      if (!offline) loud('Falling back to the committed snapshot.', `The studio's /api/help did not answer usefully: ${live.error}.`);
    } else {
      source = 'none';
      if (!offline) loud('Shipping /help/ runtime-only — nothing was prerendered.',
        `Live: ${live.error}. Snapshot: ${snap.error}.`);
      else loud('Shipping /help/ runtime-only — nothing was prerendered.', `Offline build and ${snap.error}.`);
    }
  }

  const guides = H.buildIndex(files).map(g => ({
    slug: g.slug,
    name: g.name,
    title: g.title,
    dek: g.dek,
    emoji: g.emoji,
    topic: g.topic,
    html: g.html,
  }));

  // The same bytes the browser will hash the live corpus against. `<` is
  // escaped so the JSON can sit inside a <script> element without a "</script>"
  // inside a guide ending it early.
  const corpus = { hash: H.corpusHash(files), files };
  const corpusJson = JSON.stringify(corpus).replace(/</g, '\\u003c');

  if (source !== 'none') {
    console.log(`  [help] ${files.length} guides prerendered from the ${source} corpus (${corpus.hash})${note ? ' — ' + note : ''}`);
  }

  return { source, hash: corpus.hash, guides, corpusJson, count: files.length };
};
