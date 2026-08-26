// ── ONBOARDING / CHECKOUT ──
// Steps: Scan (done, on the landing page) → Your target → Payment → Sign in.
// The scan result arrives via sessionStorage (set by scan.js) with URL params
// as the fallback; the edited target sentence is kept in sessionStorage so it
// can ride into checkout metadata when Stripe goes live.
(() => {
  const steps = document.getElementById('steps');
  if (!steps) return;

  const panels = {
    target: document.getElementById('panelTarget'),
    pay: document.getElementById('panelPay'),
    signin: document.getElementById('panelSignin'),
  };
  const metaEl = document.getElementById('obMeta');
  const goalInput = document.getElementById('goalInput');

  const params = new URLSearchParams(location.search);
  let scan = null;
  try { scan = JSON.parse(sessionStorage.getItem('prospektor.scan') || 'null'); } catch (e) {}

  let domain = params.get('domain') || (scan && scan.domain) || '';
  const company = params.get('company') || (scan && scan.name) || '';

  metaEl.textContent = domain ? (company ? domain + ' · ' + company : domain) : '';
  metaEl.hidden = !domain;

  // The direct path: no scan preceded this visit (pricing CTA, a link the
  // operator hands out). The studio researches the buyer from their site,
  // so ask for the one thing provisioning must have — their address.
  const siteAsk = document.getElementById('siteAsk');
  const siteInput = document.getElementById('siteInput');
  const siteMsg = document.getElementById('siteMsg');
  siteAsk.hidden = !!domain;

  function cleanDomain(raw) {
    let s = String(raw || '').trim().toLowerCase();
    s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
    s = s.split(/[/?#\s]/)[0];
    return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(s) ? s : '';
  }

  try {
    const savedGoal = sessionStorage.getItem('prospektor.goal');
    goalInput.value = savedGoal || (scan && scan.goal) || '';
  } catch (e) {}

  function show(name) {
    Object.keys(panels).forEach(k => { panels[k].hidden = k !== name; });
    steps.querySelectorAll('.step[data-step]').forEach(li => {
      const s = li.getAttribute('data-step');
      li.classList.remove('active', 'done');
      const order = ['target', 'pay', 'signin'];
      if (s === name) li.classList.add('active');
      else if (order.indexOf(s) < order.indexOf(name)) li.classList.add('done');
    });
    window.scrollTo({ top: 0 });
  }

  document.getElementById('toPayBtn').addEventListener('click', () => {
    if (!domain) {
      const typed = cleanDomain(siteInput.value);
      if (!typed) {
        siteMsg.textContent = 'That doesn’t look like a web address — just the domain is fine, like acme.com.';
        siteMsg.hidden = false;
        return;
      }
      siteMsg.hidden = true;
      domain = typed;
      metaEl.textContent = domain;
      metaEl.hidden = false;
      siteAsk.hidden = true;
      // Persist like a scan would, so a refresh or the payment step sees it.
      try { sessionStorage.setItem('prospektor.scan', JSON.stringify({ domain: domain, name: '', goal: '', at: Date.now() })); } catch (e) {}
    }
    try { sessionStorage.setItem('prospektor.goal', goalInput.value.trim()); } catch (e) {}
    show('pay');
  });
  document.getElementById('toSigninBtn').addEventListener('click', () => show('signin'));
  document.getElementById('backToPayBtn').addEventListener('click', () => show('pay'));

  // ── Live checkout, env-gated server-side ──
  // The page ships with the founding-spot capture as the only visible payment
  // UI. On load it asks the checkout function (GET probe) whether Stripe keys
  // exist on the server; only a 200 swaps in the real pay button. A 503 or a
  // network failure changes nothing — today's page, untouched.
  const stripePay = document.getElementById('stripePay');
  const stripeBtn = document.getElementById('stripeBtn');
  const stripeMsg = document.getElementById('stripeMsg');
  const payFallbackNote = document.getElementById('payFallbackNote');
  const stripeBtnLabel = stripeBtn.textContent;

  function showStripe() {
    payFallbackNote.hidden = true;
    reserveForm.hidden = true;
    stripePay.hidden = false;
  }
  function showFallback() {
    stripePay.hidden = true;
    payFallbackNote.hidden = false;
    reserveForm.hidden = false;
  }

  fetch('/.netlify/functions/create-checkout-session')
    .then(r => { if (r.ok) showStripe(); })
    .catch(() => {});

  function stripeNote(text, withSignin) {
    stripeMsg.textContent = '';
    stripeMsg.append(text);
    if (withSignin) {
      const a = document.createElement('a');
      a.href = 'https://studio.prospektor.ai';
      a.textContent = 'Sign in instead';
      stripeMsg.append(' ', a, '.');
    }
    stripeMsg.hidden = false;
  }

  document.getElementById('stripeForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('payEmail').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      stripeNote('That doesn’t look like an email address — this one becomes your studio’s sign-in.');
      return;
    }
    stripeBtn.disabled = true;
    stripeBtn.textContent = 'Opening secure checkout…';
    stripeMsg.hidden = true;
    let goal = goalInput.value.trim();
    try { goal = sessionStorage.getItem('prospektor.goal') || goal; } catch (e2) {}
    try {
      // One email, one studio: stop the buyer before payment if this
      // address already owns a workspace. The server fails open while the
      // studio-side check doesn't exist yet.
      try {
        const chk = await fetch('/.netlify/functions/check-email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: email }),
        });
        const owns = await chk.json().catch(() => null);
        if (owns && owns.taken) {
          stripeBtn.disabled = false;
          stripeBtn.textContent = stripeBtnLabel;
          // The server writes the sentence: a colleague's company domain
          // already owning the studio is a different message from this exact
          // address owning it, and only the server knows which it is.
          stripeNote(owns.message
            || 'This email already has a studio — signing in will take you to it, or use a different address to start a new one.', true);
          return;
        }
      } catch (e2) { /* fail open — never block a sale on a hiccup */ }

      // #204: true only when the buyer ticked the optional box — the server
      // carries a tick into checkout metadata and drops everything else.
      const marketingBox = document.getElementById('payMarketing');
      const r = await fetch('/.netlify/functions/create-checkout-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain: domain, company: company, goal: goal, email: email,
          marketing: !!(marketingBox && marketingBox.checked),
        }),
      });
      if (r.status === 503) { showFallback(); return; } // keys pulled since the probe
      const data = await r.json().catch(() => null);
      // create-checkout-session now enforces the ownership guard itself, so a
      // 409 can arrive even when the pre-flight above failed open (the studio
      // recovered in between). Show it rather than falling into the generic
      // "that didn't open".
      if (r.status === 409) {
        stripeBtn.disabled = false;
        stripeBtn.textContent = stripeBtnLabel;
        stripeNote((data && data.error) || 'This email already has a studio.', true);
        return;
      }
      if (!r.ok || !data || !data.url) throw new Error('no session url');
      location.assign(data.url);
    } catch (err) {
      stripeBtn.disabled = false;
      stripeBtn.textContent = stripeBtnLabel;
      stripeNote('That didn’t open. Try again — or email hello@prospektor.ai and we’ll sort it by hand.');
    }
  });

  // Founding-spot capture: one POST to the site's own function. If the send
  // fails for any reason, fall back to a plain mailto so no one is stranded.
  const reserveForm = document.getElementById('reserveForm');
  const reserveEmail = document.getElementById('reserveEmail');
  const reserveBtn = document.getElementById('reserveBtn');
  const reserveMsg = document.getElementById('reserveMsg');

  function reserveNote(text, isError) {
    reserveMsg.textContent = '';
    reserveMsg.append(text);
    if (isError) {
      const a = document.createElement('a');
      a.href = 'mailto:hello@prospektor.ai?subject=' + encodeURIComponent('Hold my founding spot');
      a.textContent = 'hello@prospektor.ai';
      reserveMsg.append(' ', a);
    }
    reserveMsg.classList.toggle('is-error', !!isError);
    reserveMsg.hidden = false;
  }

  reserveForm.addEventListener('submit', async e => {
    e.preventDefault();
    const email = reserveEmail.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      reserveNote('That doesn’t look like an email address — try your work email.');
      return;
    }
    reserveBtn.disabled = true;
    reserveMsg.hidden = true;
    let goal = goalInput.value.trim();
    try { goal = sessionStorage.getItem('prospektor.goal') || goal; } catch (err) {}
    const payload = {
      email: email, domain: domain, company: company, goal: goal,
      hp: document.getElementById('reserveHp').value,
    };

    // Two independent channels, tried in order: the email function
    // (SendGrid), then Netlify Forms (submissions in the Netlify
    // dashboard). Either one landing is a held spot.
    let sent = false;
    try {
      const r = await fetch('/.netlify/functions/reserve-spot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      sent = r.ok;
    } catch (err) { /* fall through to the form channel */ }
    if (!sent) {
      try {
        const r = await fetch('/', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(Object.assign({ 'form-name': 'founding-spot' }, payload)).toString(),
        });
        sent = r.ok;
      } catch (err) { /* fall through to mailto */ }
    }

    if (sent) {
      reserveForm.hidden = true;
      reserveNote('✓ Spot held. One email when checkout opens — nothing else.');
    } else {
      reserveBtn.disabled = false;
      reserveNote('That didn’t send. Email us instead:', true);
    }
  });
})();
