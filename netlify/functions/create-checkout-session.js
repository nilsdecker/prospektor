// Opens Stripe Checkout — for the pricing tile's one-field buy form and for
// the /checkout/ payment step alike.
//
// One product, one price: a Prospektor Studio workspace, $999/month,
// as a subscription (CEO decision, 16 Aug 2026). The price is inline
// price_data so no dashboard product needs to exist; promotion codes are on
// so founding-client rates are coupons the operator creates in the Stripe
// dashboard, never a code change.
//
// Env-gated: with no STRIPE_SECRET_KEY this returns 503 and every caller
// falls back to what it showed before keys existed. GET is the availability
// probe the pages use to decide which UI to show; it never creates a session.
//
// This function is the last server-side thing that happens before money can
// move, so the two things a paid session must have are enforced HERE rather
// than in whichever page called it:
//
//   1. An address that does not already own a studio (§2b ownership check).
//      The pricing CTA goes straight to Stripe, so there is no onboarding
//      page left to run that check on — it has to be structural, not a
//      convention a client remembers to follow.
//   2. A company or website to provision from. /api/provision returns 400
//      without one; the webhook would then keep returning non-2xx and Stripe
//      would redeliver for days against a buyer who has been charged $999 and
//      has no workspace. Refusing to open checkout is the cheap failure.
//
// The buyer's email is passed to Stripe as customer_email, which locks the
// field there — that is what keeps the check above meaningful, since the
// address that pays is then the address that was checked.

const { checkOwnership, ownershipMessage } = require('../lib/ownership');
const { companyDomainFromEmail, cleanDomain } = require('../lib/email-domain');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.handler = async function(event) {
  const key = process.env.STRIPE_SECRET_KEY;

  if (event.httpMethod === 'GET') {
    return key
      ? { statusCode: 200, body: JSON.stringify({ configured: true }) }
      : { statusCode: 503, body: JSON.stringify({ error: 'Checkout is not open yet' }) };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  if (!key) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Checkout is not open yet' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // 500 is Stripe's metadata value ceiling.
  const meta = v => String(v || '').trim().slice(0, 500);
  const company = meta(data.company);
  const goal = meta(data.goal);
  const email = String(data.email || '').trim().toLowerCase();

  // Required now, where it used to be optional. Stripe can collect an address
  // itself, but an address Stripe collects is one nothing has checked — and
  // the ownership guard below is the whole reason the price can lead straight
  // here without an onboarding page in front of it.
  if (!EMAIL_RE.test(email)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'That doesn’t look like an email address — this one becomes your studio’s sign-in.' }),
    };
  }

  // Who are we researching? A website if one was passed (the scan path, or a
  // buyer who answered the ask below); otherwise the company behind a work
  // address. A free-mail address names no company, so that buyer is asked —
  // 422 is the page's cue to reveal one more field, and it costs no studio
  // call because it is answered before the check below.
  let website = cleanDomain(data.domain);
  if (!website && !company) {
    website = companyDomainFromEmail(email);
    if (!website) {
      return {
        statusCode: 422,
        body: JSON.stringify({
          need: 'website',
          error: 'That’s a personal address, so it doesn’t tell us who to research. What’s your company’s website?',
        }),
      };
    }
  }

  const owned = await checkOwnership(email);
  // Suspended is the exception to one-email-one-workspace: this owner's
  // subscription lapsed, their studio is locked, and completing this checkout
  // is what unlocks it — the studio resumes the workspace instead of creating
  // a duplicate. Blocking them here would seal the front door of the very
  // path the locked screen sends them down.
  if (owned.taken && !owned.suspended) {
    return {
      statusCode: 409,
      body: JSON.stringify({
        error: ownershipMessage(owned),
        reason: owned.reason,
        signin: 'https://studio.prospektor.ai',
      }),
    };
  }

  const site = process.env.URL || 'https://prospektor.ai';
  // Cancelling should land where they started, not somewhere they have never
  // been: the pricing tile sends them back to the price, /checkout/ back to
  // its payment step, and a re-subscribe (minted server-to-server by the
  // studio's locked screen) back to the studio. Whitelisted, so the field
  // cannot become an open redirect.
  const cancelUrl = data.from === 'resubscribe'
    ? 'https://studio.prospektor.ai/'
    : site + (data.from === 'pricing' ? '/#pricing' : '/checkout/');

  const params = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': '99900',
    'line_items[0][price_data][recurring][interval]': 'month',
    'line_items[0][price_data][product_data][name]': 'Prospektor Studio — one workspace',
    allow_promotion_codes: 'true',
    success_url: data.from === 'resubscribe' ? 'https://studio.prospektor.ai/' : site + '/checkout/done/',
    cancel_url: cancelUrl,
  });
  for (const [k, v] of [['domain', website], ['company', company], ['goal', goal]]) {
    if (v) {
      params.set('metadata[' + k + ']', v);
      params.set('subscription_data[metadata][' + k + ']', v);
    }
  }
  params.set('customer_email', email);

  let response, session;
  try {
    response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    session = await response.json();
  } catch (e) {
    console.error('Stripe unreachable:', e.message);
    return { statusCode: 502, body: JSON.stringify({ error: 'Could not open checkout' }) };
  }

  if (!response.ok || !session || !session.url) {
    console.error('Stripe session create failed:', response.status,
      JSON.stringify((session && session.error) || session || null).slice(0, 500));
    return { statusCode: 502, body: JSON.stringify({ error: 'Could not open checkout' }) };
  }

  return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
};
