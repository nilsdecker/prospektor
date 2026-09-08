// ── THE PLAN SWITCH (#542) ──
// Monthly or yearly, on /pricing/ and on /checkout/ alike. The operator's
// call, 7 Sep 2026: "let's do the two months free thing for prepayment for
// the year" — $9,990 against $11,988, and /terms/ §02 says the price is then
// fixed for that year.
//
// This file decides NOTHING about what the page says. Both figures and both
// sentences are already in the HTML, written and translated by the build; all
// that happens here is that one of each is hidden. Three things follow, and
// each of them is why it is built this way:
//
//   - a switch can never show a price the build did not write;
//   - it ships no sentence of its own, so there is nothing to translate here
//     and nothing that can render in the wrong language;
//   - with JavaScript off, or before this runs, the page is the monthly page
//     it has always been — which is also the page a crawler reads.
//
// The choice is announced as a `plan` event on the switch rather than reached
// for by the other scripts, and this file is loaded AFTER them in the document
// so a `?plan=year` arriving from /pricing/ is heard: deferred scripts run in
// document order.
(() => {
  const sw = document.getElementById('planSwitch');
  if (!sw) return;

  const opts = Array.prototype.slice.call(sw.querySelectorAll('[data-plan]'));
  if (!opts.length) return;
  const names = opts.map(o => o.dataset.plan);
  // The first option is the default — monthly, everywhere — so a plan nobody
  // built is the plan the page already shows rather than a blank card.
  const known = p => (names.indexOf(p) >= 0 ? p : names[0]);

  let plan = known(new URLSearchParams(location.search).get('plan'));

  function apply(announce) {
    for (const o of opts) o.setAttribute('aria-pressed', String(o.dataset.plan === plan));
    for (const el of document.querySelectorAll('[data-plan-show]'))
      el.hidden = el.dataset.planShow !== plan;
    // The page's own link to /checkout/ carries the choice across, for the
    // visitor who has no Stripe form to submit (no keys, or no JS on the far
    // side): the switch on /checkout/ reads the same `?plan=`.
    const link = document.getElementById('buyLink');
    if (link) {
      const to = new URL(link.getAttribute('href'), location.href);
      if (plan === names[0]) to.searchParams.delete('plan');
      else to.searchParams.set('plan', plan);
      link.setAttribute('href', to.pathname + to.search + to.hash);
    }
    if (announce) sw.dispatchEvent(new CustomEvent('plan', { detail: plan }));
  }

  sw.addEventListener('click', e => {
    const opt = e.target.closest('[data-plan]');
    if (!opt || opt.dataset.plan === plan) return;
    plan = known(opt.dataset.plan);
    apply(true);
  });

  apply(true);
})();
