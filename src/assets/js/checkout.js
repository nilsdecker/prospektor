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
})();
