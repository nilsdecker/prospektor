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
  const errorEl = document.getElementById('scanError');
  const statusEl = document.getElementById('scanStatus');
  const statusMsg = document.getElementById('scanStatusMsg');
  const resultEl = document.getElementById('scanResult');
  const resultMeta = document.getElementById('scanResultMeta');
  const guessEl = document.getElementById('scanGuess');
  const summaryEl = document.getElementById('scanSummary');
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
    errorEl.textContent = msg;
    errorEl.hidden = false;
    settle();
  }

  function showStatus(domain, gen) {
    const msgs = [
      'reading ' + domain + '…',
      'looking at what ' + domain + ' sells…',
      'guessing what we’d hunt for you…',
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
    if (message) { fallbackMsg.textContent = message; fallbackMsg.hidden = false; }
    fallbackCta.href = checkoutUrl(domain);
    fallbackEl.hidden = false;
    settle();
  }

  function renderResult(domain, result) {
    hideAll();
    resultMeta.textContent = result.name ? domain + ' · ' + result.name : domain;
    guessEl.textContent = result.inferredGoal || '';
    summaryEl.textContent = result.summary || '';
    summaryEl.hidden = !result.summary;
    signalsEl.textContent = '';
    (Array.isArray(result.signals) ? result.signals : []).forEach(s => {
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
