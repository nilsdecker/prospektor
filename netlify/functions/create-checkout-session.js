// Opens Stripe Checkout for the /checkout/ payment step.
//
// One product, one price: a Prospektor Partner Studio workspace, $999/month,
// as a subscription (CEO decision, 16 Aug 2026). The price is inline
// price_data so no dashboard product needs to exist; promotion codes are on
// so founding-client rates are coupons the operator creates in the Stripe
// dashboard, never a code change.
//
// Env-gated: with no STRIPE_SECRET_KEY this returns 503 and the page keeps
// the founding-spot capture — the site behaves exactly as before keys exist.
// GET is the availability probe the page uses to decide which payment UI to
// show; it never creates a session.
//
// The buyer's email is collected by Stripe itself. What rides along is the
// scan's domain and company plus the edited target sentence, as session
// metadata — the webhook turns those into the /api/provision call. Metadata
// is mirrored onto the subscription so the operator sees who a subscription
// belongs to in the Stripe dashboard.

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
  const domain = meta(data.domain);
  const company = meta(data.company);
  const goal = meta(data.goal);
  // The payment step collects the email before redirecting (so the
  // ownership check can run pre-payment); passing it locks the field at
  // Stripe, which is what keeps that check meaningful.
  const email = String(data.email || '').trim().toLowerCase();

  const site = process.env.URL || 'https://prospektor.ai';

  const params = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': '99900',
    'line_items[0][price_data][recurring][interval]': 'month',
    'line_items[0][price_data][product_data][name]': 'Prospektor Partner Studio — one workspace',
    allow_promotion_codes: 'true',
    success_url: site + '/checkout/done/',
    cancel_url: site + '/checkout/',
  });
  for (const [k, v] of [['domain', domain], ['company', company], ['goal', goal]]) {
    if (v) {
      params.set('metadata[' + k + ']', v);
      params.set('subscription_data[metadata][' + k + ']', v);
    }
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    params.set('customer_email', email);
  }

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
