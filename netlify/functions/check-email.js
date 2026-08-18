// Pre-checkout ownership check for the multi-step /checkout/ page: does this
// email already own a studio?
//
// The rule itself, the fail-open policy and the buyer-facing sentences live
// in ../lib/ownership — shared with create-checkout-session, which is where
// the guard is actually enforced (no Stripe session is minted for a taken
// address, whichever page asked). This endpoint exists so /checkout/ can say
// so a beat earlier, on its own payment step, rather than only at the moment
// it tries to open Stripe.
//
// It answers about an address the caller already typed, and only ever with
// "taken or not" plus a sentence — never with anything the studio knows that
// the buyer does not already know about themselves.

const { checkOwnership, ownershipMessage } = require('../lib/ownership');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  const email = String(data.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'That does not look like an email address.' }) };
  }

  const result = await checkOwnership(email);
  // A suspended owner is not "taken" to this page: checkout is open to them
  // — it is the re-subscribe path, and the studio unlocks their workspace
  // when this payment lands. `taken:false` lets the page proceed; the
  // message says why paying again is right rather than a duplicate.
  if (result.taken && result.suspended) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        taken: false,
        checked: result.checked,
        suspended: true,
        message: 'Welcome back — this email\u2019s workspace is paused. Completing checkout reactivates it with everything where you left it.',
      }),
    };
  }
  return {
    statusCode: 200,
    body: JSON.stringify({
      taken: result.taken,
      checked: result.checked,
      // The sentence comes from the server so both surfaces say the same
      // thing, and so the domain case ("a colleague already bought this")
      // reads differently from the plain one — a distinction the studio
      // started reporting on 18 Aug and the site was still flattening.
      message: result.taken ? ownershipMessage(result) : '',
    }),
  };
};
