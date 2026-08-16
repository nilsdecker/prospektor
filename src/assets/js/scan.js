// ── SCAN FIELD ──
// Submits to the studio's scan endpoint, polls until done/failed, renders
// the inferred goal as a guess. Spec: HANDOVER-website-funnel.md §1 in
// prospektor-ai/studio. Scans are cached and capped studio-side — no
// client-side caching or retry loops here.
(() => {
  const API = 'https://studio.prospektor.ai/api/scan';
  const POLL_MS = 2000;
  const DEADLINE_MS = 90000;

  const form = document.getElementById('scanForm');
  if (!form) return;

  const input = document.getElementById('scanInput');
  const btn = document.getElementById('scanBtn');
  const hintEl = document.getElementById('scanHint');
  const errorEl = document.getElementById('scanError');
  const statusEl = document.getElementById('scanStatus');
  const statusMsg = document.getElementById('scanStatusMsg');
  const resultEl = document.getElementById('scanResult');
  const heroEl = document.querySelector('.hero');
  const resultMeta = document.getElementById('scanResultMeta');
  const factsEl = document.getElementById('scanFacts');
  const guessEl = document.getElementById('scanGuess');
  const signalsEl = document.getElementById('scanSignals');
  const ctaEl = document.getElementById('scanCta');
  const fallbackEl = document.getElementById('scanFallback');
  const fallbackMsg = document.getElementById('scanFallbackMsg');
  const fallbackCta = document.getElementById('scanFallbackCta');

  // Bumped on every submit; stale polls and status tickers check it and stop.
  let generation = 0;
  let statusTimer = null;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function checkoutUrl(domain, company) {
    const p = new URLSearchParams();
    if (domain) p.set('domain', domain);
    if (company) p.set('company', company);
    const q = p.toString();
    return '/checkout/' + (q ? '?' + q : '');
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

  function showStatus(domain, gen) {
    const msgs = [
      'reading ' + domain + '…',
      'looking at what ' + domain + ' sells…',
      'working out the targets we’d propose…',
    ];
    let i = 0;
    statusMsg.textContent = msgs[0];
    statusEl.hidden = false;
    statusTimer = setInterval(() => {
      if (gen !== generation) { clearInterval(statusTimer); return; }
      i = (i + 1) % msgs.length;
      statusMsg.textContent = msgs[i];
    }, 4000);
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
  // reduced to X itself. A goal that doesn't match the pattern renders as-is.
  function toProposal(goal) {
    const stripped = goal.replace(
      /^they(?:\s+(?:most\s+likely|likely|probably))?(?:\s+(?:want|need|hope|aim|appear\s+to\s+want|seem\s+to\s+want|are\s+looking|are\s+hunting))?(?:\s+(?:to\s+)?(?:find|reach|meet|attract|connect\s+with|for))?\s*[:,–—-]?\s*/i,
      ''
    ).trim();
    if (stripped.length < 12 || stripped === goal) return goal;
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
    resultMeta.textContent = result.name ? domain + ' · ' + result.name : domain;
    // Short fact fragments (a future scan field) render as a stat strip —
    // they know who they are; the strip only shows we do too. Until the
    // studio returns them, the prose summary stays off the page.
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
    signalsEl.textContent = '';
    signals.forEach(s => {
      const li = document.createElement('li');
      li.textContent = s;
      signalsEl.appendChild(li);
    });
    signalsEl.hidden = signalsEl.childElementCount === 0;
    ctaEl.href = checkoutUrl(domain, result.name);
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
        body: JSON.stringify({ website: raw }),
      });
      data = await res.json().catch(() => null);
    } catch (err) {
      if (gen === generation) showFallback(roughDomain);
      return;
    }
    if (gen !== generation) return;

    if (res.status === 400) {
      showError('That doesn’t look like a domain — try something like acme.com.');
    } else if (res.status === 429) {
      showFallback(roughDomain, (data && data.error) || 'At capacity today — scans are back tomorrow.');
    } else if (res.status === 200 && data && data.status === 'done' && data.result) {
      renderResult(data.domain || roughDomain, data.result);
    } else if (res.status === 202 && data && data.domain) {
      poll(data.domain, gen, Date.now() + DEADLINE_MS);
    } else {
      showFallback(roughDomain);
    }
  });
})();
