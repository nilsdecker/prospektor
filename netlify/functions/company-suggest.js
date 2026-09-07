// The scan field's typeahead (#241): companies matching what the visitor has
// typed so far, as `{ name, domain }` pairs, from the site's own origin.
//
// The provider is Clearbit's public suggest endpoint — the same one the studio
// has called from `lib/companies.js` since before #42 wrote it down, and the one
// `/privacy/` §08 names as a recipient (#90). Nothing new is added by this file:
// no new third party, no key, no account. What is deliberately kept:
//
// - **The call is server-side.** A browser could call Clearbit directly (the
//   endpoint is CORS-open), and doing so would hand HubSpot the visitor's IP,
//   user-agent and referer on every keystroke. Going through this function,
//   the only thing that reaches them is the characters typed — `/privacy/`
//   §08's sentence, kept true by construction.
// - **A provider entry is a name and a domain, and never a URL** (studio #443).
//   Clearbit's response carries a `logo` URL; rendered as an `<img src>` it
//   would make the visitor's browser fetch from `logo.clearbit.com`, which is
//   the leak the server-side call exists to prevent. It is dropped here, at
//   the boundary, so nothing downstream can render it. `test/company-suggest.test.js`
//   pins it.
// - **Every failure is an empty list.** A dead provider, a slow one, a 5xx or
//   a malformed body all answer `200 { suggestions: [] }` — the field degrades
//   to the plain text box it was until today, and never to an error.
// - **The cost posture per keystroke** (the row's third ask): the client
//   debounces and asks for two characters or more, this file refuses anything
//   under two, and a warm container remembers what it has already asked for
//   ten minutes — a typist's own backspaces and the next visitor typing the
//   same well-known name are what actually repeat. The provider is free and
//   unauthenticated, so the meter here is Netlify invocations, not money.
//
// The typed text is never logged. There is nothing else in the request to log.

const PROVIDER = 'https://autocomplete.clearbit.com/v1/companies/suggest?query=';
const MIN_QUERY = 2;
const MAX_QUERY = 64;
const LIMIT = 6;
const TIMEOUT_MS = 2500;
const MEMO_TTL_MS = 10 * 60 * 1000;
const MEMO_MAX = 200;

const memo = new Map();
function memoGet(key) {
  const hit = memo.get(key);
  if (!hit) return null;
  if (Date.now() > hit.until) { memo.delete(key); return null; }
  return hit.entries;
}
function memoPut(key, entries) {
  if (!entries.length) return;
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value);
  memo.set(key, { entries, until: Date.now() + MEMO_TTL_MS });
}

// Exposed for the tests, which need a cold memo per case.
exports._clearMemo = () => memo.clear();

/** Only what a browser may see: a name and a domain. Anything else the
 *  provider sends — a logo URL above all — stops here. */
function toEntry(raw) {
  const name = String((raw && raw.name) || '').trim();
  const domain = raw && raw.domain ? String(raw.domain).trim().toLowerCase() : '';
  if (!name || !domain) return null;
  return { name, domain };
}

async function suggest(query) {
  const remembered = memoGet(query.toLowerCase());
  if (remembered) return remembered;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(PROVIDER + encodeURIComponent(query), { signal: controller.signal });
    if (!r.ok) return [];
    const body = await r.json();
    const entries = (Array.isArray(body) ? body : []).map(toEntry).filter(Boolean).slice(0, LIMIT);
    memoPut(query.toLowerCase(), entries);
    return entries;
  } catch (e) {
    // Never a blocker, and never a log line carrying what was typed.
    return [];
  } finally {
    clearTimeout(timer);
  }
}

const json = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

exports.handler = async function(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  const q = String((event.queryStringParameters || {}).q || '').replace(/\s+/g, ' ').trim();
  if (q.length < MIN_QUERY || q.length > MAX_QUERY) return json(200, { suggestions: [] });
  const suggestions = await suggest(q);
  // The browser may keep an answer for the same characters a while: a
  // backspace and a retype is the same question, and the answer is public.
  return json(200, { suggestions }, { 'cache-control': 'public, max-age=600' });
};
