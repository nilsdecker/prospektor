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

  // A live scan takes up to a minute or so. The bar climbs asymptotically
  // toward ~92% on elapsed time (the status endpoint reports no stages) and
  // the message advances so the wait reads as work, not a hang.
  function showStatus(domain, gen) {
    const stages = [
      [0,  t('opening {domain}…', { domain: domain })],
      [6,  t('reading what you sell…')],
      [20, t('checking who you sell to…')],
      [38, t('looking one search beyond your site…')],
      [55, t('drafting your proposal…')],
      [75, t('almost there — tightening the wording…')],
    ];
    const t0 = Date.now();
    statusEl.hidden = false;
    if (barEl) barEl.style.width = '2%';
    const tick = () => {
      if (gen !== generation) { clearInterval(statusTimer); return; }
      const elapsed = (Date.now() - t0) / 1000;
      let msg = stages[0][1];
      for (const [at, m] of stages) if (elapsed >= at) msg = m;
      statusMsg.textContent = msg;
      if (barEl) barEl.style.width = (92 * (1 - Math.exp(-elapsed / 30))).toFixed(1) + '%';
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
        const r = await fetch(API + '?domain=' + encodeURIComponent(domain));
        if (r.ok) data = await r.json();
      } catch (e) { /* transient network hiccup — keep polling until the deadline */ }
      if (gen !== generation) return;
      if (data) {
        if (data.status === 'done' && data.result) { renderResult(data.domain || domain, data.result); return; }
        if (data.status === 'failed') { showFallback(domain); return; }
      }
    }
    if (gen === generation) showFallback(domain);
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const raw = input.value.trim();
    if (!raw) { input.focus(); return; }

    const gen = ++generation;
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
