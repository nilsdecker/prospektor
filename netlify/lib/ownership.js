// One email, one workspace — the guard that stands between a buyer and a
// $999 charge for a studio they already own.
//
// It proxies the studio's POST /api/provision-check (contract in
// HANDOVER-website-funnel.md §2b, live in production since 18 Aug 2026)
// because the shared secret lives server-side only, and because the studio
// deliberately does not open that endpoint cross-origin: reachable from a
// browser it would let anyone ask, address by address, who is a customer.
//
// This lives in a shared module rather than inside one function because the
// guard is now enforced where the money is committed — create-checkout-session
// will not mint a Stripe session for an address that already owns a studio —
// as well as offered early by check-email for the multi-step /checkout/ page.
// Two callers, one rule; a guard that is copy-pasted is a guard that drifts.
//
// Fail-open by design. A missing secret, an unreachable studio, a 403 or a
// shape we do not recognise all return taken:false with checked:false, and
// the sale proceeds. Blocking a paying customer because the studio hiccuped
// is a worse failure than the collision this catches, which the operator
// notice on the webhook already surfaces for a human.

const CHECK_URL = 'https://studio.prospektor.ai/api/provision-check';

async function checkOwnership(email) {
  const open = { taken: false, checked: false, name: '', reason: '' };

  const secret = process.env.STUDIO_PROVISION_SECRET;
  if (!secret) return open;

  try {
    const response = await fetch(CHECK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-provision-secret': secret,
      },
      body: JSON.stringify({ email }),
    });
    // 403 wrong secret, 503 studio unconfigured, 400 broken email — none of
    // them are "this address is free", but none of them are grounds to
    // refuse a sale either.
    if (!response.ok) return open;

    const result = await response.json().catch(() => null);
    if (!result || typeof result.taken !== 'boolean') return open;

    return {
      taken: result.taken,
      checked: true,
      name: typeof result.name === 'string' ? result.name : '',
      // `reason` is optional studio-side; anything unexpected reads as the
      // plain email case, which is the more cautious sentence of the two.
      reason: result.reason === 'domain' ? 'domain' : 'email',
    };
  } catch (e) {
    return open;
  }
}

// The sentence the buyer sees. It lives next to the check so both callers
// say the same thing, and so the two cases stay distinguishable: a colleague
// having bought the workspace is a different message from your own address
// already owning one — the buyer is about to pay a second time for something
// they can sign in to today, and saying so saves a refund.
function ownershipMessage(result) {
  if (result.reason === 'domain') {
    const who = result.name || 'Your company';
    return who + ' already has a studio and your address gets in — just sign in, there is nothing to buy twice.';
  }
  return 'This email already has a studio — sign in to it, or use a different address to start a new one.';
}

module.exports = { checkOwnership, ownershipMessage, CHECK_URL };
