// ── SCAN FIELD ──
// Submits to the studio's scan endpoint, polls until done/failed, renders
// the inferred goal as a guess. Spec: HANDOVER-website-funnel.md §1 in
// prospektor-ai/studio. Scans are cached and capped studio-side — no
// client-side caching or retry loops here.
(() => {
  const API = 'https://studio.prospektor.ai/api/scan';
  // #419: the free run — the whole WHO half, to a stranger with no account.
  // It takes ?domain= and starts on arrival, so the visitor never types
  // their site twice. Entry point only: a started run has its own address
  // (/r/<token>) which the run page writes, and which must never be
  // published anywhere (HANDOVER-website-funnel.md, PUBLIC-PAGES.md §5c).
  const RUN = 'https://studio.prospektor.ai/r';
  const POLL_MS = 2000;
  const DEADLINE_MS = 90000;
  // #114: the page's language rides to the scan, so the studio can answer in
  // it once it learns to (HANDOVER-website-funnel.md, 7 Sep 2026). English
  // sends nothing, so an English scan is the request it always was.
  const LANG = document.documentElement.lang || 'en';
  // What the scan's GET adds for this page's language — nothing at all for
  // English (#114's rule: English is byte for byte the request it was).
  const langQuery = () => (LANG === 'en' ? '' : '&language=' + encodeURIComponent(LANG));

  const form = document.getElementById('scanForm');
  if (!form) return;

  const input = document.getElementById('scanInput');
  const btn = document.getElementById('scanBtn');
  const hintEl = document.getElementById('scanHint');
  const errorEl = document.getElementById('scanError');
  const statusEl = document.getElementById('scanStatus');
  const statusMsg = document.getElementById('scanStatusMsg');
  const barEl = document.getElementById('scanBarFill');
  const resultEl = document.getElementById('scanResult');
  const heroEl = document.querySelector('.hero');
  const nameEl = document.getElementById('scanName');
  const domainEl = document.getElementById('scanDomain');
  const factsEl = document.getElementById('scanFacts');
  const guessEl = document.getElementById('scanGuess');
  const ctaEl = document.getElementById('scanCta');
  const runCtaEl = document.getElementById('scanRunCta');
  const fallbackEl = document.getElementById('scanFallback');
  const fallbackMsg = document.getElementById('scanFallbackMsg');
  const fallbackCta = document.getElementById('scanFallbackCta');
  // Where checkout is on THIS page's language — the template wrote the
  // localized href (#114), so the script reads it rather than assuming /checkout/.
  const CHECKOUT = (ctaEl && ctaEl.getAttribute('href')) || '/checkout/';

  // ── Arriving at #scan means "I want to scan" ──
  // #207: the fragment jump moves the viewport and nothing else — keyboard
  // focus stays on <body>, so somebody who follows "Scan your site" and then
  // presses Tab starts again at the nav rather than in the field the link
  // just promised them. Put the caret where the link said it would be.
  // preventScroll because the navigation has already done the scrolling and
  // focus must not second-guess it. Skipped on coarse pointers: springing the
  // on-screen keyboard open would shove the hero straight back off the
  // screen, which is the shape of the bug this came from.
  const focusField = () => {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
    // Next frame, never this one. The browser's own fragment handling runs
    // after both the deferred script and the click that caused it: it scrolls
    // to the target and, because a <section> is not focusable, resets focus
    // to <body>. Focusing synchronously is measurably undone a moment later.
    requestAnimationFrame(() => {
      try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
    });
  };
  const wantsScan = () => location.hash === '#scan';
  if (wantsScan()) focusField();
  window.addEventListener('hashchange', () => { if (wantsScan()) focusField(); });
  // A /#scan link pressed while the hash is already #scan fires no
  // hashchange, and the mid-page CTA is exactly that press.
  document.addEventListener('click', e => {
    if (e.target.closest && e.target.closest('a[href$="#scan"]')) focusField();
  });

  // ── The typeahead (#241) ──
  // Companies matching what has been typed so far, one line each — name,
  // domain — under the field, from the site's own function (never the
  // provider directly: the function is the one door, so nothing but the
  // characters typed leaves the visitor's browser). Picking one fills the
  // field with the domain, because the scan is domain-keyed underneath, and
  // changes nothing else: the visitor still presses Scan. Every failure is
  // simply no list — the field was a plain text box until today and still is.
  const SUGGEST = '/.netlify/functions/company-suggest?q=';
  const SUGGEST_MIN = 2;
  const SUGGEST_DEBOUNCE_MS = 200;
  const listEl = document.getElementById('scanSuggest');
  const suggest = (() => {
    if (!listEl) return { close: () => {} };
    listEl.setAttribute('aria-label', t('Suggestions'));
    let timer = null, inflight = null, shown = [], active = -1;

    function close() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (inflight) { inflight.abort(); inflight = null; }
      listEl.hidden = true;
      listEl.textContent = '';
      shown = []; active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function mark(i) {
      active = i;
      const items = listEl.children;
      for (let k = 0; k < items.length; k++) items[k].setAttribute('aria-selected', k === i ? 'true' : 'false');
      if (i >= 0) input.setAttribute('aria-activedescendant', items[i].id);
      else input.removeAttribute('aria-activedescendant');
    }

    function pick(entry) {
      if (!entry) return;
      input.value = entry.domain;
      close();
      input.focus();
    }

    function render(entries) {
      listEl.textContent = '';
      entries.forEach((entry, i) => {
        const li = document.createElement('li');
        li.id = 'scanSuggest-' + i;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.dataset.i = String(i);
        const name = document.createElement('span');
        name.className = 'scan-suggest-name';
        name.textContent = entry.name;
        const domain = document.createElement('span');
        domain.className = 'scan-suggest-domain';
        domain.textContent = entry.domain;
        li.appendChild(name);
        li.appendChild(domain);
        listEl.appendChild(li);
      });
      shown = entries; active = -1;
      listEl.hidden = entries.length === 0;
      input.setAttribute('aria-expanded', entries.length ? 'true' : 'false');
    }

    async function ask(q) {
      if (inflight) inflight.abort();
      const ctl = new AbortController();
      inflight = ctl;
      let entries = [];
      try {
        const r = await fetch(SUGGEST + encodeURIComponent(q), { signal: ctl.signal });
        const data = r.ok ? await r.json() : null;
        entries = (data && Array.isArray(data.suggestions) ? data.suggestions : [])
          .filter(e => e && e.name && e.domain).slice(0, 6);
      } catch (e) { /* aborted, offline, or the function is down — no list */ }
      if (inflight !== ctl) return;
      inflight = null;
      // Only for the characters still in the field, and only while it has focus.
      if (input.value.trim() !== q || document.activeElement !== input) return;
      render(entries);
    }

    input.addEventListener('input', () => {
      const q = input.value.trim();
      if (timer) clearTimeout(timer);
      if (q.length < SUGGEST_MIN) { close(); return; }
      timer = setTimeout(() => { timer = null; ask(q); }, SUGGEST_DEBOUNCE_MS);
    });
    input.addEventListener('keydown', e => {
      if (listEl.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); mark((active + 1) % shown.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); mark(active <= 0 ? shown.length - 1 : active - 1); }
      else if (e.key === 'Enter') { if (active >= 0) { e.preventDefault(); pick(shown[active]); } else close(); }
      else if (e.key === 'Escape') { close(); }
    });
    input.addEventListener('blur', close);
    // A press on the list must not blur the field — the click that follows
    // needs the list still there.
    listEl.addEventListener('mousedown', e => e.preventDefault());
    listEl.addEventListener('click', e => {
      const li = e.target.closest && e.target.closest('li[data-i]');
      if (li) pick(shown[Number(li.dataset.i)]);
    });
    return { close };
  })();

  // Bumped on every submit; stale polls and status tickers check it and stop.
  let generation = 0;
  let statusTimer = null;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function checkoutUrl(domain, company) {
    const p = new URLSearchParams();
    if (domain) p.set('domain', domain);
    if (company) p.set('company', company);
    const q = p.toString();
    return CHECKOUT + (q ? '?' + q : '');
  }

  // The domain the scan resolved, not the raw string typed: /r normalises the
  // same way /api/scan does, but sending the resolved one means the run opens
  // on exactly the company the card is describing.
  function runUrl(domain) {
    return RUN + (domain ? '?domain=' + encodeURIComponent(domain) : '');
  }

  function hideAll() {
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
    errorEl.hidden = true;
    statusEl.hidden = true;
    resultEl.hidden = true;
    fallbackEl.hidden = true;
    fallbackMsg.hidden = true;
  }

  function settle() { btn.disabled = false; }

  function showError(msg) {
    hideAll();
    if (heroEl) heroEl.classList.remove('scan-focus');
    errorEl.textContent = msg;
    errorEl.hidden = false;
    settle();
  }

  // ── The wait (#323) ──
  // A scan is bounded at 20 s on the studio's side (#319) and answers in
  // ~9 s at the median (#239's measurement), so the wait is timed against
  // THAT envelope — not the 60–70 s one the first build had, whose stages
  // at 20, 38, 55 and 75 s described a scan that had already failed. The
  // sentence changes when the work does: opening, reading, writing; and
  // past 14 s it says the one thing that is true of nearly every slow scan
  // (9% spend over 7.5 s waiting on the origin) — it is taking longer than
  // usual — rather than inventing a stage. The bar climbs toward ~92% with
  // the median in mind, so a scan that lands at 9 s lands past halfway.
  //
  // And when the studio serves what the scan is actually doing — `notes` on
  // GET /api/scan while it runs, each `{ kind: 'read' | 'search', url |
  // query }` (HANDOVER-website-funnel.md §1) — the LAST note is the
  // sentence, in place of the timed one: "reading acme.com/about…" is
  // better than any guess. Nothing here needs those notes to exist; a poll
  // that carries none leaves the timed sentence in place.
  const STAGES = [
    [0,  d => t('opening {domain}…', { domain: d })],
    [2,  d => t('reading {domain}…', { domain: d })],
    [8,  () => t('writing what it found…')],
    [14, d => t('still reading {domain} — taking longer than usual…', { domain: d })],
  ];
  let liveNote = '';

  // One sentence from the studio's notes, in this page's language, or '' —
  // the timed sentence stands in for anything this cannot read.
  function noteLine(notes) {
    if (!Array.isArray(notes) || !notes.length) return '';
    const last = notes[notes.length - 1];
    if (!last || typeof last !== 'object') return '';
    if (last.kind === 'read' && last.url) {
      try {
        const u = new URL(String(last.url));
        const page = (u.host + u.pathname).replace(/^www\./, '').replace(/\/$/, '');
        return page ? t('reading {page}…', { page: page }) : '';
      } catch (e) { return ''; }
    }
    if (last.kind === 'search' && last.query) return t('searching for “{query}”…', { query: String(last.query) });
    return '';
  }

  function showStatus(domain, gen) {
    const t0 = Date.now();
    statusEl.hidden = false;
    if (barEl) barEl.style.width = '2%';
    const tick = () => {
      if (gen !== generation) { clearInterval(statusTimer); return; }
      const elapsed = (Date.now() - t0) / 1000;
      let msg = STAGES[0][1](domain);
      for (const [at, m] of STAGES) if (elapsed >= at) msg = m(domain);
      statusMsg.textContent = liveNote || msg;
      if (barEl) barEl.style.width = (92 * (1 - Math.exp(-elapsed / 8))).toFixed(1) + '%';
    };
    tick();
    statusTimer = setInterval(tick, 500);
  }

  // Failed / timed out / at capacity: no scan panel, just the plain CTA.
  // With a 429 the server's message is shown; otherwise nothing — never
  // an apology.
  function showFallback(domain, message) {
    hideAll();
    // No scan panel to hold the stage — bring the page back behind the CTA.
    if (heroEl) heroEl.classList.remove('scan-focus');
    if (message) { fallbackMsg.textContent = message; fallbackMsg.hidden = false; }
    fallbackCta.href = checkoutUrl(domain);
    fallbackEl.hidden = false;
    settle();
  }

  // A field carrying tool-call markup means the scan came back malformed —
  // treat it like a failed scan rather than render it.
  const looksBroken = s => /<\/?\w+[^>]*>/.test(s);

  // The result renders under "Here's what Prospektor will find for you:", so
  // a goal phrased about them — "They most likely want to find X" — is
  // reduced to X itself. Stopgap until the scan returns the targets directly:
  // if the remainder would start mid-phrase (a preposition — the verb before
  // it wasn't one we account for), keep the original sentence; grammatical
  // beats fragment.
  function toProposal(goal) {
    const stripped = goal.replace(
      /^they(?:\s+(?:most\s+likely|likely|probably))?(?:\s+(?:want|need|hope|aim|appear\s+to\s+want|seem\s+to\s+want|are\s+looking|are\s+hunting))?(?:\s+(?:to\s+)?(?:find|reach|meet|attract|connect\s+with|for))?\s*[:,–—-]?\s*/i,
      ''
    ).trim();
    if (stripped.length < 12 || stripped === goal) return goal;
    if (/^(?:into|in|at|on|with|for|from|to|of|across|toward|towards|by|via|through|and|or|as)\b/i.test(stripped)) return goal;
    return stripped.charAt(0).toUpperCase() + stripped.slice(1);
  }

  function renderResult(domain, result) {
    const goal = (result.inferredGoal || '').trim();
    const summary = (result.summary || '').trim();
    const signals = (Array.isArray(result.signals) ? result.signals : [])
      .map(s => String(s || '').trim()).filter(Boolean);
    if (!goal || [goal, summary].concat(signals).some(looksBroken)) {
      showFallback(domain);
      return;
    }
    hideAll();
    // #240: the card leads with who they are — name big, domain quiet beside
    // it. With no name the domain takes the name slot rather than doubling.
    nameEl.textContent = result.name || domain;
    domainEl.textContent = result.name ? domain : '';
    domainEl.hidden = !result.name;
    // Short fact fragments render as chips — they know who they are; the
    // chips only show we do too. The signals (evidence bullets) are read and
    // validated above but deliberately not rendered: the reader is the
    // company being described (#240, "the client knows themselves").
    const facts = (Array.isArray(result.facts) ? result.facts : [])
      .map(f => String(f || '').trim()).filter(f => f && !looksBroken(f)).slice(0, 4);
    factsEl.textContent = '';
    facts.forEach(f => {
      const span = document.createElement('span');
      span.textContent = f;
      factsEl.appendChild(span);
    });
    factsEl.hidden = facts.length === 0;
    guessEl.textContent = toProposal(goal);
    ctaEl.href = checkoutUrl(domain, result.name);
    if (runCtaEl) runCtaEl.href = runUrl(domain);
    // The checkout page picks the scan up from here so the buyer's target
    // sentence survives the navigation without a backend.
    try {
      sessionStorage.setItem('prospektor.scan', JSON.stringify({
        domain: domain, name: result.name || '', goal: guessEl.textContent,
        facts: facts, signals: signals, at: Date.now(),
      }));
    } catch (e) { /* private mode — checkout falls back to URL params */ }
    resultEl.hidden = false;
    settle();
  }

  async function poll(domain, gen, deadline) {
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      if (gen !== generation) return;
      let data = null;
      try {
        // #536: the poll names the language too, not just the POST. Since
        // #534 the studio files a Spanish reading BESIDE the English one, so
        // a poll that names no language reads the English record — and a
        // Spanish visitor scanning a domain somebody already scanned in
        // English is shown that English card while their own reading
        // finishes unseen. English still sends nothing, so the English poll
        // is the request it always was; the reply's `language` says which
        // reading answered.
        const r = await fetch(API + '?domain=' + encodeURIComponent(domain) + langQuery());
        if (r.ok) data = await r.json();
      } catch (e) { /* transient network hiccup — keep polling until the deadline */ }
      if (gen !== generation) return;
      if (data) {
        if (data.status === 'done' && data.result) { renderResult(data.domain || domain, data.result); return; }
        if (data.status === 'failed') { showFallback(domain); return; }
        // #323: what the scan is doing right now, when the studio says.
        liveNote = noteLine(data.notes) || liveNote;
      }
    }
    if (gen === generation) showFallback(domain);
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const raw = input.value.trim();
    if (!raw) { input.focus(); return; }

    const gen = ++generation;
    liveNote = '';
    suggest.close();
    hideAll();
    if (hintEl) hintEl.hidden = true;
    // Focus mode: the scan is the page now; the pitch copy steps back.
    if (heroEl) heroEl.classList.add('scan-focus');
    btn.disabled = true;

    // Only for the status line — the server does the real parsing.
    const roughDomain = raw.replace(/^https?:\/\//i, '').split('/')[0];
    showStatus(roughDomain, gen);

    let res, data;
    try {
      res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(LANG === 'en' ? { website: raw } : { website: raw, language: LANG }),
      });
      data = await res.json().catch(() => null);
    } catch (err) {
      if (gen === generation) showFallback(roughDomain);
      return;
    }
    if (gen !== generation) return;

    if (res.status === 400) {
      showError(t('That doesn’t look like a domain — try something like acme.com.'));
    } else if (res.status === 429) {
      showFallback(roughDomain, (data && data.error) || t('At capacity today — scans are back tomorrow.'));
    } else if (res.status === 200 && data && data.status === 'done' && data.result) {
      renderResult(data.domain || roughDomain, data.result);
    } else if (res.status === 202 && data && data.domain) {
      poll(data.domain, gen, Date.now() + DEADLINE_MS);
    } else {
      showFallback(roughDomain);
    }
  });
})();
