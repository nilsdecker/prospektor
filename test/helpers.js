// Shared stubs. Every function under test reads process.env inside its
// handler and calls global fetch, so a test can set both per case without
// busting the require cache.

// Swap in a fetch that routes by URL. Returns a `calls` array of
// {url, method, headers, body} so a test can assert what left the process —
// which is the only way to prove a guard refused BEFORE Stripe was called.
function stubFetch(routes) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
    for (const [match, reply] of routes) {
      if (u.includes(match)) {
        const r = typeof reply === 'function' ? reply(opts, calls) : reply;
        if (r instanceof Error) throw r;
        return {
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          json: async () => r.body,
          text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
        };
      }
    }
    throw new Error('unstubbed fetch to ' + u);
  };
  return calls;
}

const post = (fn, body, extra = {}) =>
  fn.handler({ httpMethod: 'POST', body: JSON.stringify(body), ...extra });
const get = fn => fn.handler({ httpMethod: 'GET' });

// Stripe signs `${timestamp}.${rawBody}` with the webhook secret.
function signedStripeEvent(secret, event) {
  const crypto = require('node:crypto');
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return { httpMethod: 'POST', body: payload, headers: { 'stripe-signature': `t=${t},v1=${v1}` } };
}

function checkoutSessionCompleted({ email, metadata = {}, paid = true }) {
  return {
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_1', payment_status: paid ? 'paid' : 'unpaid',
      customer_details: { email }, metadata } },
  };
}

function resetEnv() {
  for (const k of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STUDIO_PROVISION_SECRET',
                   'POSTMARK_SERVER_TOKEN','SENDGRID_API_KEY','OPERATOR_EMAIL','URL'])
    delete process.env[k];
}

module.exports = { stubFetch, post, get, signedStripeEvent, checkoutSessionCompleted, resetEnv };
