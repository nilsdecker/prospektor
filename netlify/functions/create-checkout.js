// Creates a Stripe Checkout Session for the studio funnel and returns its URL.
// The scan panel calls this with the buyer's domain and company name so they
// never retype their company — both ride along as session metadata and come
// back to us on the checkout.session.completed webhook (stripe-webhook.js).
//
// Env (server-side only):
//   STRIPE_SECRET_KEY     — sk_... API key
//   STRIPE_PRICE_ID       — the price the CTA sells
//   STRIPE_CHECKOUT_MODE  — optional; 'payment' (default) or 'subscription'

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Checkout is not configured' }) };
  }

  let data = {};
  try { data = JSON.parse(event.body || '{}'); } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const website = String(data.website || '').trim().slice(0, 200);
  const company = String(data.company || '').trim().slice(0, 200);

  const siteUrl = process.env.URL || 'https://prospektor.ai';

  const params = new URLSearchParams({
    mode: process.env.STRIPE_CHECKOUT_MODE || 'payment',
    'line_items[0][price]': STRIPE_PRICE_ID,
    'line_items[0][quantity]': '1',
    success_url: `${siteUrl}/welcome/`,
    cancel_url: `${siteUrl}/#scan`,
    'custom_text[submit][message]': 'Use your work email so your team can get in.',
  });
  if (website) params.set('metadata[website]', website);
  if (company) params.set('metadata[company]', company);

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  const session = await response.json();
  if (!response.ok || !session.url) {
    console.error('Stripe checkout session error:', JSON.stringify(session.error || session));
    return { statusCode: 502, body: JSON.stringify({ error: 'Could not start checkout' }) };
  }

  return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
};
