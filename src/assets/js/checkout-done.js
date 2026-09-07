// ── /checkout/done/ — the confirmation (#244) ──
// Trades Stripe's ?session_id= back for what this checkout actually was:
// the amount that left the card and the sign-in address. Every path that
// yields nothing (no id, bad id, 503 while keys are unset, network) leaves
// the page's generic confirmation exactly as served — a buyer seconds after
// paying must never see this page degrade.
(() => {
  const card = document.getElementById('confirmCard');
  if (!card) return;

  // The scan and goal have done their job — a later visit to /checkout/
  // should start fresh, not from a paid-for session.
  try {
    sessionStorage.removeItem('prospektor.goal');
    sessionStorage.removeItem('prospektor.scan');
  } catch (e) {}

  const id = new URLSearchParams(location.search).get('session_id') || '';
  if (!/^cs_[a-zA-Z0-9_]{10,250}$/.test(id)) return;

  fetch('/.netlify/functions/checkout-session-status?session_id=' + encodeURIComponent(id))
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      if (!d || !d.paid) return;
      if (typeof d.amount_total === 'number') {
        let amount;
        try {
          // The page's own language decides how the number reads (#114):
          // an English page formats as it always did.
          amount = new Intl.NumberFormat(document.documentElement.lang === 'en' ? 'en-US' : document.documentElement.lang, {
            style: 'currency', currency: (d.currency || 'usd').toUpperCase(),
          }).format(d.amount_total / 100);
        } catch (e) {
          amount = '$' + (d.amount_total / 100).toFixed(2);
        }
        document.getElementById('confirmAmount').textContent = amount;
        document.getElementById('confirmPaid').hidden = false;
      }
      if (d.email) {
        document.getElementById('confirmAddress').textContent = d.email;
        document.getElementById('confirmEmail').hidden = false;
      }
    })
    .catch(() => {});
})();
