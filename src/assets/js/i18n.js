// ── THE PAGE'S LANGUAGE, IN THE BROWSER (#114) ──
// Two jobs, both small. First: `t()`, the one function every other script on
// the site says its sentences through. The English sentence is the key
// (the studio's convention, #113); the page ships the translations it needs
// in `<script type="application/json" id="i18n">`, written by the build for
// exactly the sentences the scripts ask for, and only on a page that exists
// in more than one language. No block, or a sentence the block lacks, means
// English — the same fallback the build applies.
//
// Second: the suggestion. A visitor whose browser ranks a language first
// that this page exists in, but is not written in, is told so in that
// language and offered the twin. Told — never redirected. The spec is one
// line (`HANDOVER-website-funnel.md`, 23 Aug): "`Accept-Language` may
// SUGGEST a language; it must never silently redirect somebody who typed
// the English URL." Only the first-ranked language counts, for #113's
// reason: reading further down the list would offer Spanish to a machine
// whose owner listed it third. One answer either way is remembered, so the
// bar is seen at most once.
//
// Deferred and first in <head>, so `t` exists before any deferred script
// after it runs; it looks nothing up in the DOM until the document is parsed.
(() => {
  let data = null;
  try {
    const el = document.getElementById('i18n');
    data = el ? JSON.parse(el.textContent) : null;
  } catch (e) { data = null; }
  const strings = (data && data.strings) || {};
  const fill = (s, vars) => vars
    ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
    : String(s);
  window.t = (key, vars) =>
    fill(Object.prototype.hasOwnProperty.call(strings, key) ? strings[key] : key, vars);

  if (!data) return;

  // ── The suggestion bar ──
  const KEY = 'prospektor.lang';
  let remembered = '';
  try { remembered = localStorage.getItem(KEY) || ''; } catch (e) { /* private mode: suggest once per page */ }
  if (remembered) return;

  const here = data.lang;
  const prefs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language];
  const want = String(prefs[0] || '').toLowerCase().split(/[-_]/)[0];
  if (!want || want === here) return;

  // The twins this page has, from its own hreflang links — derived from the
  // build, never a list kept here.
  const twins = {};
  document.querySelectorAll('link[rel="alternate"][hreflang]').forEach(l => {
    const code = l.getAttribute('hreflang');
    if (!code || code === 'x-default') return;
    // As a path on THIS origin: the hreflang href is absolute (that is what
    // a crawler needs), and the offer must stay on whichever host served it —
    // a preview, a local drive, production alike.
    try {
      const u = new URL(l.getAttribute('href'), location.href);
      twins[code] = u.pathname + u.search + u.hash;
    } catch (e) { /* an unreadable href is no twin */ }
  });
  const say = data.suggest && data.suggest[want];
  if (!twins[want] || !say) return;

  const remember = code => { try { localStorage.setItem(KEY, code); } catch (e) { /* nothing to do */ } };

  const bar = document.createElement('div');
  bar.className = 'lang-suggest';
  bar.setAttribute('role', 'region');
  bar.setAttribute('lang', want);
  bar.id = 'langSuggest';
  const line = document.createElement('p');
  line.textContent = say.line;
  const go = document.createElement('a');
  go.href = twins[want];
  go.hreflang = want;
  go.textContent = say.go;
  go.addEventListener('click', () => remember(want));
  const stay = document.createElement('button');
  stay.type = 'button';
  stay.textContent = say.stay;
  stay.addEventListener('click', () => { remember(here); bar.remove(); });
  bar.append(line, go, stay);
  document.body.prepend(bar);
})();
