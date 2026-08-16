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

  const domain = params.get('domain') || (scan && scan.domain) || '';
  const company = params.get('company') || (scan && scan.name) || '';

  metaEl.textContent = domain ? (company ? domain + ' · ' + company : domain) : '';
  metaEl.hidden = !domain;
  if (!domain) {
    // No scan reached this page — the flow starts at the field on the
    // landing page, so say so instead of presenting an empty step.
    const back = document.createElement('p');
    back.className = 'onboard-sub';
    back.innerHTML = 'Start with the scan — <a href="/#scan">give us your URL</a> and this page fills itself in.';
    metaEl.after(back);
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
    try { sessionStorage.setItem('prospektor.goal', goalInput.value.trim()); } catch (e) {}
    show('pay');
  });
  document.getElementById('toSigninBtn').addEventListener('click', () => show('signin'));
  document.getElementById('backToPayBtn').addEventListener('click', () => show('pay'));

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
