// ── URL SCAN → CHECKOUT ──
// Calls the studio's public scan endpoint directly (CORS-allowed for this
// origin), polls until done, renders the result, and hands domain + company
// name to checkout. Scans are cached and capped studio-side — no client
// caching or retry loops here.

const SCAN_API = 'https://studio.prospektor.ai/api/scan';
const POLL_INTERVAL_MS = 2000;
const POLL_GIVE_UP_MS = 90000;

const scanForm = document.getElementById('scanForm');
const scanInput = document.getElementById('scanInput');
const scanBtn = document.getElementById('scanBtn');
const scanError = document.getElementById('scanError');
const scanStatus = document.getElementById('scanStatus');
const scanStatusMsg = document.getElementById('scanStatusMsg');
const scanResult = document.getElementById('scanResult');
const scanCta = document.getElementById('scanCta');
const checkoutBtn = document.getElementById('checkoutBtn');
const checkoutError = document.getElementById('checkoutError');

let scanDomain = '';    // what the studio resolved their input to
let scanCompany = '';   // result.name, when the scan produced one
let pollTimer = null;
let statusTimer = null;

if (scanForm) scanForm.addEventListener('submit', onScanSubmit);
if (checkoutBtn) checkoutBtn.addEventListener('click', startCheckout);

async function onScanSubmit(e) {
  e.preventDefault();
  const typed = scanInput.value.trim();
  if (!typed) { scanInput.focus(); return; }

  resetPanels();
  scanBtn.disabled = true;
  scanBtn.textContent = 'Scanning…';

  let res;
  try {
    res = await fetch(SCAN_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ website: typed }),
    });
  } catch (err) {
    // Network failure — no scan, but never a dead end: show the plain CTA.
    finishScanUi();
    showCta();
    return;
  }

  if (res.status === 400) {
    finishScanUi();
    showError(scanError, "That doesn't look like a domain — try something like acme.com.");
    return;
  }

  if (res.status === 429) {
    let msg = "We're at capacity for free scans today.";
    try { msg = (await res.json()).error || msg; } catch (e2) {}
    finishScanUi();
    showError(scanError, msg);
    showCta();
    return;
  }

  let data = null;
  try { data = await res.json(); } catch (e2) {}
  if (!res.ok || !data) {
    finishScanUi();
    showCta();
    return;
  }

  scanDomain = data.domain || typed;

  if (data.status === 'done' && data.result) {
    finishScanUi();
    renderResult(data);
    return;
  }
  if (data.status === 'failed') {
    finishScanUi();
    showCta();
    return;
  }

  startPolling();
}

function startPolling() {
  // Something alive while we wait — a silent spinner reads as broken.
  const msgs = [
    'reading ' + scanDomain + '…',
    'looking at what you sell…',
    'guessing what we’d hunt for you…',
    'still reading ' + scanDomain + '…',
  ];
  let msgIdx = 0;
  scanStatusMsg.textContent = msgs[0];
  scanStatus.hidden = false;
  statusTimer = setInterval(() => {
    msgIdx = (msgIdx + 1) % msgs.length;
    scanStatusMsg.textContent = msgs[msgIdx];
  }, 6000);

  const deadline = Date.now() + POLL_GIVE_UP_MS;

  async function poll() {
    if (Date.now() > deadline) {
      // Give up quietly — plain CTA beats a spinner forever.
      finishScanUi();
      showCta();
      return;
    }
    let data = null;
    try {
      const res = await fetch(SCAN_API + '?domain=' + encodeURIComponent(scanDomain));
      if (res.ok) data = await res.json();
    } catch (err) { /* transient — keep polling until the deadline */ }

    if (data && data.status === 'done' && data.result) {
      finishScanUi();
      renderResult(data);
      return;
    }
    if (data && data.status === 'failed') {
      finishScanUi();
      showCta();
      return;
    }
    pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  }

  pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
}

function renderResult(data) {
  const r = data.result;
  scanCompany = r.name || '';

  document.getElementById('resName').textContent = r.name || data.domain;
  document.getElementById('resDomain').textContent = data.domain;
  document.getElementById('resSummary').textContent = r.summary || '';
  document.getElementById('resGoal').textContent = r.inferredGoal || '';

  const list = document.getElementById('resSignals');
  list.textContent = '';
  (r.signals || []).forEach(sig => {
    const li = document.createElement('li');
    li.textContent = sig;
    list.appendChild(li);
  });

  scanResult.hidden = false;
  showCta();
}

function showCta() {
  scanCta.hidden = false;
}

async function startCheckout() {
  checkoutError.hidden = true;
  checkoutBtn.disabled = true;
  checkoutBtn.textContent = 'One moment…';
  try {
    const res = await fetch('/.netlify/functions/create-checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        website: scanDomain || scanInput.value.trim(),
        company: scanCompany,
      }),
    });
    const data = await res.json();
    if (res.ok && data.url) {
      window.location.href = data.url;
      return;
    }
    throw new Error(data.error || 'Checkout unavailable');
  } catch (err) {
    checkoutBtn.disabled = false;
    checkoutBtn.textContent = 'Get your studio →';
    showError(checkoutError, "Checkout didn't open — please try again, or email hello@prospektor.ai.");
  }
}

function resetPanels() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
  scanError.hidden = true;
  scanStatus.hidden = true;
  scanResult.hidden = true;
  scanCta.hidden = true;
  checkoutError.hidden = true;
  scanDomain = '';
  scanCompany = '';
}

function finishScanUi() {
  if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
  scanStatus.hidden = true;
  scanBtn.disabled = false;
  scanBtn.textContent = 'Scan my site';
}

function showError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}
