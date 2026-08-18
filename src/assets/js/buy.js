// ── THE DIRECT PAY PATH ──
// The pricing tile's CTA opens Stripe Checkout, not an onboarding page. One
// field: the address that becomes the studio's sign-in. Submitting it asks
// the server for a Checkout Session and jumps straight to Stripe.
//
// Why a field at all, when the point is "straight to Stripe": one email owns
// one workspace, and an address that already has a studio has to be stopped
// BEFORE $999 moves — a real buyer was once charged for nothing. Letting
// Stripe collect the address would leave that check nowhere to run but the
// webhook, where the only remedy left is a refund. So the field Stripe would
// have shown anyway is shown one step earlier, and the server refuses to mint
// a session for an address that is taken.
//
// Degradation is deliberate. The markup ships with a plain link to /checkout/
// visible and the form hidden; only a 200 from the availability probe (Stripe
// keys exist server-side) swaps them. No JS, no keys, or a probe that fails —
// the visitor gets the working multi-step page, exactly as before.
(() => {
  const form = document.getElementById('buyForm');
  if (!form) return;

  const link = document.getElementById('buyLink');
  const emailInput = document.getElementById('buyEmail');
  const siteInput = document.getElementById('buySite');
  const btn = document.getElementById('buyBtn');
  const msg = document.getElementById('buyMsg');
  const live = document.getElementById('buyLive');
  const btnLabel = btn.textContent;

  fetch('/.netlify/functions/create-checkout-session')
    .then(r => {
      if (!r.ok) return;
      link.hidden = true;
      form.hidden = false;
      live.hidden = false;
    })
    .catch(() => {});

  // One message element, three jobs: field errors, the server's "personal
  // address, what's your website?" ask, and the ownership block (which is the
  // only one that earns a sign-in link).
  function note(text, signinUrl) {
    msg.textContent = '';
    msg.append(text);
    if (signinUrl) {
      const a = document.createElement('a');
      a.href = signinUrl;
      a.textContent = 'Sign in instead';
      msg.append(' ', a, '.');
    }
    msg.hidden = false;
  }

  function reset() {
    btn.disabled = false;
    btn.textContent = btnLabel;
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      note('That doesn’t look like an email address — this one becomes your studio’s sign-in.');
      emailInput.focus();
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Opening secure checkout…';
    msg.hidden = true;

    let response, data;
    try {
      response = await fetch('/.netlify/functions/create-checkout-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // No goal sentence on this path, on purpose: sharpening the target is
        // the step the price must not detour through. /api/provision infers a
        // goal from the site and the buyer confirms it on first sign-in, which
        // is what it does for anyone who skips the scan.
        body: JSON.stringify({
          email: email,
          domain: siteInput.hidden ? '' : siteInput.value.trim(),
          from: 'pricing',
        }),
      });
      data = await response.json().catch(() => null);
    } catch (err) {
      reset();
      note('That didn’t open. Try again — or email hello@prospektor.ai and we’ll sort it by hand.');
      return;
    }

    // Keys pulled since the probe: hand them the page that still works.
    if (response.status === 503) {
      form.hidden = true;
      live.hidden = true;
      link.hidden = false;
      note('Checkout is reopening — start here and we’ll take it from the payment step.');
      return;
    }

    // A personal address names no company, so the studio has nothing to
    // research. Ask for the website and let them submit again.
    if (response.status === 422) {
      reset();
      siteInput.hidden = false;
      note((data && data.error) || 'What’s your company’s website?');
      siteInput.focus();
      return;
    }

    // Already owns a studio. The server wrote the sentence, because it knows
    // whether this is their own address or a colleague's company domain.
    if (response.status === 409) {
      reset();
      note((data && data.error) || 'This email already has a studio.',
        (data && data.signin) || 'https://studio.prospektor.ai');
      return;
    }

    if (!response.ok || !data || !data.url) {
      reset();
      note((data && data.error)
        || 'That didn’t open. Try again — or email hello@prospektor.ai and we’ll sort it by hand.');
      return;
    }

    location.assign(data.url);
  });
})();
