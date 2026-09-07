// ── THE PAGE'S LANGUAGE, IN THE BROWSER (#114) ──
// Two jobs, both small. First: `t()`, the one function every other script on
// the site says its sentences through. The English sentence is the key
// (the studio's convention, #113); the page ships the translations it needs
// in `<script type="application/json" id="i18n">`, written by the build for
// exactly the sentences the scripts ask for, and only on a page that exists
// in more than one language. No block, or a sentence the block lacks, means
// English — the same fallback the build applies.
//
// Second: the nudge (#114 → #544). A visitor on an ENGLISH page whose
// browser ranks first a language the page is built in is offered the twin,
// in that language — one line that is itself the link, one way to close it,
// nothing to explain. Offered, never redirected: the spec is one line
// (`HANDOVER-website-funnel.md`, 23 Aug) — "`Accept-Language` may SUGGEST a
// language; it must never silently redirect somebody who typed the English
// URL" — and the operator's ask for #544 keeps it: *"do the nudge for
// German/foreign-language browsers - one time only"*. Only the browser's
// first-ranked language counts, for #113's reason: reading further down the
// list would offer Spanish to a machine whose owner listed it third; the IP
// and a geo lookup never count at all — a German VPN is not a German reader.
// One time only means the flag is written the moment the line is drawn, so a
// visitor who neither takes it nor closes it is not asked again on the next
// page; taking it overwrites the flag with the language they went on in.
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

  // ── The nudge ──
  // English pages only: a translated page was chosen — by a click, a link
  // or a typed URL — and the build sends it nothing to nudge with.
  const here = data.lang;
  if (here !== 'en' || !data.suggest) return;
  const KEY = 'prospektor.lang';
  let remembered = '';
  try { remembered = localStorage.getItem(KEY) || ''; } catch (e) { /* private mode: once per page */ }
  if (remembered) return;

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
  const say = data.suggest[want];
  if (!twins[want] || !say) return;

  const remember = code => { try { localStorage.setItem(KEY, code); } catch (e) { /* nothing to do */ } };

  // One line, which is the link; one ×, named for a screen reader; nothing else.
  const bar = document.createElement('div');
  bar.className = 'lang-suggest';
  bar.setAttribute('lang', want);
  bar.id = 'langSuggest';
  const go = document.createElement('a');
  go.href = twins[want];
  go.hreflang = want;
  go.textContent = say.line;
  go.addEventListener('click', () => remember(want));
  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', say.stay);
  close.textContent = '×';
  close.addEventListener('click', () => bar.remove());
  bar.append(go, close);
  document.body.prepend(bar);
  remember(here); // drawn once on this browser — taken, closed or ignored alike
})();
