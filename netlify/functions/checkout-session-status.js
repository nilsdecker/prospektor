// /checkout/done/'s one question: what did this checkout actually buy? (#244)
//
// Stripe redirects the buyer to /checkout/done/?session_id={CHECKOUT_SESSION_ID}
// and this function trades that id back for the three facts the confirmation
// shows: the amount actually paid (a promo code can make it anything from
// $0.01 to $999 — the page must never invent a number), the address the
// workspace is tied to, and whether the session is in fact paid.
//
// The session id is the authorisation. A cs_… id is a long unguessable token
// Stripe hands only to the buyer's own redirect — the same bearer-token model
// as Stripe's own success pages — so holding it is proof enough for these
// three fields. Everything else on the session (line items, metadata, the
// subscription id) deliberately stays server-side.
//
// Env-gated like every Stripe call here: no key, 503, and the page keeps its
// generic confirmation copy — a missing env var must never blank the page a
// buyer lands on seconds after paying.

const SESSION_ID_RE = /^cs_[a-zA-Z0-9_]{10,250}$/;

exports.handler = async function(event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Not configured' }) };
  }

  const id = ((event.queryStringParameters || {}).session_id || '').trim();
  if (!SESSION_ID_RE.test(id)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bad session id' }) };
  }

  let response, session;
  try {
    response = await fetch('https://api.stripe.com/v1/checkout/sessions/' + id, {
      headers: { 'Authorization': `Bearer ${key}` },
    });
    session = await response.json();
  } catch (e) {
    console.error('Stripe unreachable:', e.message);
    return { statusCode: 502, body: JSON.stringify({ error: 'Could not read the session' }) };
  }
  if (!response.ok || !session || session.object !== 'checkout.session') {
    return { statusCode: 404, body: JSON.stringify({ error: 'No such session' }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      paid: session.payment_status === 'paid',
      amount_total: typeof session.amount_total === 'number' ? session.amount_total : null,
      currency: session.currency || 'usd',
      email: (session.customer_details && session.customer_details.email) || session.customer_email || null,
    }),
  };
};
