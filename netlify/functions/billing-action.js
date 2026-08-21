// The studio's hand on a subscription — pause, resume, or cancel billing for
// a workspace the operator is suspending, resuming or deleting (studio queue
// #29). Until this, causality ran one way only: billing events → workspace
// state, via the webhook. An operator who suspended a workspace by hand had
// closed the door and left the meter running — the customer kept being
// charged until somebody remembered the Stripe dashboard.
//
// Server to server only, the resubscribe pattern in reverse: the studio asks,
// this site acts, and the Stripe key never leaves this repo. The caller
// proves itself with the same shared secret the webhook uses to call the
// studio — one secret, two names (PROVISION_SECRET there,
// STUDIO_PROVISION_SECRET here), rotated together per the 19 Aug incident
// lesson — so arming this endpoint adds no new secret to either deploy.
//
// One email can back several Stripe customers (each checkout mints one), and
// a re-subscribe can leave an old subscription beside the new — the webhook's
// own notice asks the operator to hand-cancel exactly that case. So every
// action here walks ALL the customers behind the address and acts on every
// subscription that is not already canceled: pausing a workspace's billing
// must not leave a second subscription quietly charging.
//
// pause uses Stripe's pause_collection with behavior:'void' — the
// subscription stays alive (so resume is cheap and the customer's history
// survives) but invoices are voided instead of collected. A paused
// subscription still reports status 'active'; the webhook knows not to read
// that as recovery.

const crypto = require('node:crypto');

const STRIPE = 'https://api.stripe.com/v1';
const ACTIONS = ['pause', 'resume', 'cancel'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Same posture as the studio's own door: an unset or too-short secret means
// the endpoint does not exist rather than standing guessably open.
function secretMatches(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

async function stripe(key, method, path, params) {
  const response = await fetch(STRIPE + path, {
    method,
    headers: {
      'Authorization': `Bearer ${key}`,
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: params ? params.toString() : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const detail = data && data.error && data.error.message;
    throw new Error(`Stripe ${method} ${path} answered ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return data;
}

// Every not-yet-canceled subscription behind an address, across every
// customer that address has minted. `status=all` because a past_due or
// trialing subscription still bills; the canceled ones are already done.
async function subscriptionsFor(key, email) {
  const customers = await stripe(key, 'GET', '/customers?' + new URLSearchParams({ email, limit: '100' }));
  const found = [];
  for (const customer of customers.data || []) {
    const subscriptions = await stripe(key, 'GET', '/subscriptions?' + new URLSearchParams({
      customer: customer.id, status: 'all', limit: '100',
    }));
    for (const subscription of subscriptions.data || []) {
      if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') continue;
      found.push(subscription);
    }
  }
  return found;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  const secret = process.env.STUDIO_PROVISION_SECRET || '';
  if (secret.length < 32) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Billing actions are not configured on this deploy' }) };
  }
  const given = (event.headers && (event.headers['x-provision-secret'] || event.headers['X-Provision-Secret'])) || '';
  if (!secretMatches(given, secret)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Wrong or missing provisioning secret' }) };
  }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Stripe is not configured on this deploy' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  const email = String(data.email || '').trim().toLowerCase();
  const action = String(data.action || '').trim();
  if (!EMAIL_RE.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Say whose subscription: email' }) };
  }
  if (!ACTIONS.includes(action)) {
    return { statusCode: 400, body: JSON.stringify({ error: `action must be one of: ${ACTIONS.join(', ')}` }) };
  }

  try {
    let subscriptions = await subscriptionsFor(key, email);
    // Resuming only unpauses — a subscription that is not paused needs
    // nothing, and touching it would invent work out of idempotent retries.
    if (action === 'resume') subscriptions = subscriptions.filter(s => s.pause_collection);

    const acted = [];
    for (const subscription of subscriptions) {
      if (action === 'cancel') {
        await stripe(key, 'DELETE', '/subscriptions/' + encodeURIComponent(subscription.id));
      } else if (action === 'pause') {
        await stripe(key, 'POST', '/subscriptions/' + encodeURIComponent(subscription.id),
          new URLSearchParams({ 'pause_collection[behavior]': 'void' }));
      } else {
        // Clearing pause_collection is Stripe's "resume": an empty value
        // unsets the property and collection picks up at the next cycle.
        await stripe(key, 'POST', '/subscriptions/' + encodeURIComponent(subscription.id),
          new URLSearchParams({ pause_collection: '' }));
      }
      acted.push(subscription.id);
    }
    console.log(`billing-action: ${action} for ${email} touched ${acted.length} subscription(s)`, acted.join(', ') || '(none)');
    return { statusCode: 200, body: JSON.stringify({ action, email, matched: acted.length, subscriptions: acted }) };
  } catch (e) {
    // Partial failure is a 502 on purpose: the studio reports it loudly and
    // the operator finishes in the Stripe dashboard — a quiet half-done
    // answer here would read as "billing stopped" while it had not.
    console.error('billing-action failed:', e.message);
    return { statusCode: 502, body: JSON.stringify({ error: 'Stripe could not be asked — finish this in the Stripe dashboard' }) };
  }
};
