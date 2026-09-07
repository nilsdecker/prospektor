// Payment success becomes a provisioned studio. The webhook's job is to be
// idempotent, to never provision an unpaid session, and to make a silent
// failure visible in the operator's inbox.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { stubFetch, resetEnv, signedStripeEvent, checkoutSessionCompleted } = require('./helpers');
const fn = require('../netlify/functions/stripe-webhook');

const SECRET = 'whsec_test';
const provisioned = (extra = {}) => ['/api/provision', { status: 201, body: { client: { id: 'acme' }, research: 'pending', ...extra } }];
const mail = calls => calls.filter(c => c.url.includes('postmarkapp')).map(c => JSON.parse(c.body));
const notice = calls => mail(calls).find(m => /order/i.test(m.Subject));
const welcome = calls => mail(calls).find(m => /studio is ready/i.test(m.Subject));

describe('stripe-webhook', () => {
  beforeEach(() => {
    resetEnv();
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    process.env.STUDIO_PROVISION_SECRET = 'shh';
    process.env.POSTMARK_SERVER_TOKEN = 'pm';
  });

  test('refuses an unsigned or badly signed event', async () => {
    const r = await fn.handler({ httpMethod: 'POST', body: '{}', headers: { 'stripe-signature': 't=1,v1=deadbeef' } });
    assert.equal(r.statusCode, 400);
  });

  test('never provisions an unpaid session', async () => {
    const calls = stubFetch([provisioned(), ['postmarkapp', { status: 200, body: {} }]]);
    const r = await fn.handler(signedStripeEvent(SECRET, checkoutSessionCompleted({ email: 'b@acme.com', paid: false })));
    assert.equal(r.statusCode, 200);
    assert.equal(calls.filter(c => c.url.includes('/api/provision')).length, 0);
  });

  test('provisions on payment and sends both mails', async () => {
    const calls = stubFetch([provisioned({ goal: true }), ['postmarkapp', { status: 200, body: {} }]]);
    const r = await fn.handler(signedStripeEvent(SECRET, checkoutSessionCompleted({
      email: 'b@acme.com', metadata: { domain: 'acme.com', company: 'Acme', goal: 'Property managers' } })));
    assert.equal(r.statusCode, 200);
    assert.ok(notice(calls), 'the operator is told about every sale');
    const w = welcome(calls);
    assert.ok(w, 'a new workspace earns a welcome email');
    // The sign-in links carry ?signin=<address> so the studio prefills its
    // emailed-link field — the old flow made the buyer retype the address the
    // mail was literally sent to (operator, 19 Aug).
    assert.ok(w.TextBody.includes('/?signin=' + encodeURIComponent('b@acme.com')), 'the text link prefills');
    assert.ok(w.HtmlBody.includes('/?signin=' + encodeURIComponent('b@acme.com')), 'the button link prefills');
  });

  // #114: a buyer who bought in Spanish is welcomed in Spanish, the operator is
  // told which language, and the studio is offered the language for the
  // workspace (it ignores the field until it learns it). An English buyer's
  // mail is byte for byte the one this always sent — no language is written
  // for English at checkout, so none arrives here.
  test('a Spanish buyer is welcomed in Spanish, and the operator and the studio are told', async () => {
    const calls = stubFetch([provisioned({ goal: true }), ['postmarkapp', { status: 200, body: {} }]]);
    const r = await fn.handler(signedStripeEvent(SECRET, checkoutSessionCompleted({
      email: 'b@acme.com', metadata: { domain: 'acme.com', language: 'es' } })));
    assert.equal(r.statusCode, 200);
    const w = mail(calls).find(m => /estudio está listo/.test(m.Subject));
    assert.ok(w, 'the welcome subject is Spanish');
    assert.ok(w.TextBody.includes('Tu Prospektor Studio está listo.'), 'the text body is Spanish');
    assert.ok(w.HtmlBody.includes('Entrar en tu estudio &rarr;'), 'the button is Spanish');
    assert.ok(w.TextBody.includes('/?signin=' + encodeURIComponent('b@acme.com')), 'the sign-in link still prefills');
    assert.ok(!/Your studio is ready/.test(w.TextBody + w.HtmlBody), 'no English sentence leaks into the Spanish mail');
    const n = notice(calls);
    assert.ok(/Language: Spanish/.test(n.TextBody), 'the operator notice names the language');
    const body = JSON.parse(calls.find(c => c.url.includes('/api/provision')).body);
    assert.equal(body.language, 'es', 'the studio is offered the language');
  });

  test('an English buyer gets the English mail, and no language field anywhere', async () => {
    const calls = stubFetch([provisioned({ goal: true }), ['postmarkapp', { status: 200, body: {} }]]);
    await fn.handler(signedStripeEvent(SECRET, checkoutSessionCompleted({ email: 'b@acme.com', metadata: { domain: 'acme.com' } })));
    const w = welcome(calls);
    assert.ok(w && w.TextBody.startsWith('Your Prospektor Studio is ready.'));
    assert.ok(!/Language:/.test(notice(calls).TextBody), 'nothing to say about English');
    const body = JSON.parse(calls.find(c => c.url.includes('/api/provision')).body);
    assert.ok(!('language' in body), 'an older studio sees nothing new');
  });

  test('a language outside the set is treated as English, never as a fifth language', async () => {
    const calls = stubFetch([provisioned({ goal: true }), ['postmarkapp', { status: 200, body: {} }]]);
    await fn.handler(signedStripeEvent(SECRET, checkoutSessionCompleted({ email: 'b@acme.com', metadata: { domain: 'acme.com', language: 'fr' } })));
    assert.ok(welcome(calls), 'the English welcome went out');
    assert.ok(!('language' in JSON.parse(calls.find(c => c.url.includes('/api/provision')).body)));
  });

  test('sends the shared secret to the studio, and no secret to the buyer', async () => {
    const calls = stubFetch([provisioned(), ['postmarkapp', { status: 200, body: {} }]]);
    await fn.handler(signedStripeEvent(SECRET, checkoutSessionCompleted({ email: 'b@acme.com', metadata: { domain: 'acme.com' } })));
    const p = calls.find(c => c.url.includes('/api/provision'));
    assert.equal(p.headers['x-provision-secret'], 'shh');
    assert.ok(!JSON.stringify(mail(calls)).includes('shh'));
  });

  test('treats an existing workspace as success, warns loudly, and sends no welcome', async () => {
    const calls = stubFetch([['/api/provision', { status: 200, body: { client: { id: 'acme' }, existing: true } }], ['postmarkapp', { status: 200, body: {} }]]);
    const r = await fn.handler(signedStripeEvent(SECRET, checkoutSessionCompleted({ email: 'b@acme.com', metadata: { domain: 'acme.com' } })));
    assert.equal(r.statusCode, 200, 'existing:true is success — webhooks double-fire');
    assert.match(notice(calls).Subject, /needs attention/);
    assert.equal(welcome(calls), undefined, '"your studio is ready" would be a lie here');
  });

  test('passes a ticked marketing box to the studio, and only a ticked one (#204)', async () => {
    const calls = stubFetch([provisioned({ marketing: true }), ['postmarkapp', { status: 200, body: {} }]]);
    await fn.handler(signedStripeEvent(SECRET, checkoutSessionCompleted({
      email: 'b@acme.com', metadata: { domain: 'acme.com', marketing: 'yes' } })));
    const p = JSON.parse(calls.find(c => c.url.includes('/api/provision')).body);
    assert.equal(p.marketing, true, 'the tick reaches the studio');

    // No tick means the field is absent entirely — never false, never a
    // string — so the studio's strict === true check sees nothing at all.
    const quiet = stubFetch([provisioned(), ['postmarkapp', { status: 200, body: {} }]]);
    await fn.handler(signedStripeEvent(SECRET, checkoutSessionCompleted({
      email: 'b@acme.com', metadata: { domain: 'acme.com' } })));
    assert.ok(!('marketing' in JSON.parse(quiet.find(c => c.url.includes('/api/provision')).body)));
  });

  test('reports a target sentence the studio did not record', async () => {
    const calls = stubFetch([provisioned({ goal: false }), ['postmarkapp', { status: 200, body: {} }]]);
    await fn.handler(signedStripeEvent(SECRET, checkoutSessionCompleted({
      email: 'b@acme.com', metadata: { domain: 'acme.com', goal: 'Property managers' } })));
    assert.match(notice(calls).Subject, /target sentence dropped/);
    assert.match(notice(calls).TextBody, /SENT BUT NOT RECORDED/);
  });

  test('does NOT warn when no sentence was sent — that is the direct pay path', async () => {
    const calls = stubFetch([provisioned({ goal: false }), ['postmarkapp', { status: 200, body: {} }]]);
    await fn.handler(signedStripeEvent(SECRET, checkoutSessionCompleted({ email: 'b@acme.com', metadata: { domain: 'visible.xyz' } })));
    assert.match(notice(calls).Subject, /^New order:/);
    assert.match(notice(calls).TextBody, /bought straight from the pricing tile/);
  });

  test('does NOT warn when the studio does not report the field at all', async () => {
    const calls = stubFetch([provisioned(), ['postmarkapp', { status: 200, body: {} }]]);
    await fn.handler(signedStripeEvent(SECRET, checkoutSessionCompleted({
      email: 'b@acme.com', metadata: { domain: 'acme.com', goal: 'Property managers' } })));
    assert.match(notice(calls).Subject, /^New order:/);
    assert.doesNotMatch(notice(calls).TextBody, /NOT RECORDED/);
  });

  test('returns non-2xx when provisioning fails, so Stripe keeps retrying', async () => {
    const calls = stubFetch([['/api/provision', { status: 400, body: { error: 'no company or website' } }], ['postmarkapp', { status: 200, body: {} }]]);
    const r = await fn.handler(signedStripeEvent(SECRET, checkoutSessionCompleted({ email: 'b@acme.com', metadata: {} })));
    assert.ok(r.statusCode >= 400, 'a paid buyer with no workspace must not be marked delivered');
    assert.equal(mail(calls).length, 0);
  });

  test('is retryable when the provision secret is missing, so it self-heals', async () => {
    delete process.env.STUDIO_PROVISION_SECRET;
    stubFetch([provisioned(), ['postmarkapp', { status: 200, body: {} }]]);
    const r = await fn.handler(signedStripeEvent(SECRET, checkoutSessionCompleted({ email: 'b@acme.com', metadata: { domain: 'acme.com' } })));
    assert.ok(r.statusCode >= 400);
  });

  test('stays silent, not broken, when no mail provider is configured', async () => {
    delete process.env.POSTMARK_SERVER_TOKEN;
    stubFetch([provisioned()]);
    const r = await fn.handler(signedStripeEvent(SECRET, checkoutSessionCompleted({ email: 'b@acme.com', metadata: { domain: 'acme.com' } })));
    assert.equal(r.statusCode, 200, 'a missing mail token must never fail a paid webhook');
  });
});

// The billing gate: failure events lock a workspace, recovery unlocks it.
// The webhook's whole contribution is naming the right action and the right
// address — the studio's PATCH is idempotent, so double-fires are free.
describe('stripe-webhook billing gate', () => {
  beforeEach(() => {
    resetEnv();
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    process.env.STUDIO_PROVISION_SECRET = 'shh';
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  });

  const patchCalls = calls => calls.filter(c => c.url.includes('/api/provision') && c.method === 'PATCH');
  const suspended = (body = {}) => ['/api/provision', { status: 200, body: { action: 'suspend', existed: true, ...body } }];

  test('a failed renewal suspends the workspace by the buyer email', async () => {
    const calls = stubFetch([suspended()]);
    const r = await fn.handler(signedStripeEvent(SECRET, {
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_1', customer_email: 'b@acme.com' } },
    }));
    assert.equal(r.statusCode, 200);
    const [patch] = patchCalls(calls);
    assert.ok(patch, 'the studio was told');
    assert.equal(patch.headers['x-provision-secret'], 'shh');
    assert.deepEqual(JSON.parse(patch.body), { email: 'b@acme.com', action: 'suspend', reason: 'payment_failed' });
  });

  test('a chargeback suspends, resolving the customer when the event has no email', async () => {
    const calls = stubFetch([
      ['api.stripe.com/v1/customers/cus_9', { status: 200, body: { email: 'B@Acme.com' } }],
      suspended(),
    ]);
    const r = await fn.handler(signedStripeEvent(SECRET, {
      type: 'charge.dispute.created',
      data: { object: { id: 'dp_1', customer: 'cus_9' } },
    }));
    assert.equal(r.statusCode, 200);
    const body = JSON.parse(patchCalls(calls)[0].body);
    assert.equal(body.email, 'b@acme.com', 'resolved via the customer, lowercased');
    assert.equal(body.reason, 'chargeback');
  });

  test('a cancelled subscription suspends; a recovered one resumes', async () => {
    let calls = stubFetch([
      ['api.stripe.com/v1/customers/cus_9', { status: 200, body: { email: 'b@acme.com' } }],
      suspended(),
    ]);
    await fn.handler(signedStripeEvent(SECRET, {
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', customer: 'cus_9', status: 'canceled' } },
    }));
    assert.equal(JSON.parse(patchCalls(calls)[0].body).reason, 'subscription_canceled');

    // past_due -> active after a successful retry: unlock without anyone writing in.
    calls = stubFetch([
      ['api.stripe.com/v1/customers/cus_9', { status: 200, body: { email: 'b@acme.com' } }],
      ['/api/provision', { status: 200, body: { action: 'resume', existed: true } }],
    ]);
    await fn.handler(signedStripeEvent(SECRET, {
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_9', status: 'active' } },
    }));
    const resume = JSON.parse(patchCalls(calls)[0].body);
    assert.equal(resume.action, 'resume');
    assert.equal(resume.reason, undefined, 'a resume carries no reason');
  });

  test('a paused subscription reporting active is NOT recovery — the workspace stays locked', async () => {
    // pause_collection is the studio's own suspend reaching Stripe
    // (billing-action.js); the update event it fires must not undo the lock.
    const calls = stubFetch([]);
    const r = await fn.handler(signedStripeEvent(SECRET, {
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_9', status: 'active', pause_collection: { behavior: 'void' } } },
    }));
    assert.equal(r.statusCode, 200);
    assert.equal(calls.length, 0, 'no resume was sent for a paused subscription');
  });

  test('a subscription update that is not active does nothing', async () => {
    const calls = stubFetch([]);
    const r = await fn.handler(signedStripeEvent(SECRET, {
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_9', status: 'past_due' } },
    }));
    assert.equal(r.statusCode, 200);
    assert.equal(calls.length, 0, 'past_due on its own is Stripe mid-retry — the invoice event decides');
  });

  test('an unresolvable email is acknowledged, not retried for ever', async () => {
    const calls = stubFetch([['api.stripe.com/v1/customers/cus_9', { status: 404, body: {} }]]);
    const r = await fn.handler(signedStripeEvent(SECRET, {
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_9' } },
    }));
    assert.equal(r.statusCode, 200, 'a retry would find the same nothing');
    assert.equal(patchCalls(calls).length, 0);
  });

  test('a studio failure returns non-2xx so Stripe re-delivers', async () => {
    stubFetch([['/api/provision', { status: 503, body: { error: 'not configured' } }]]);
    const r = await fn.handler(signedStripeEvent(SECRET, {
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_1', customer_email: 'b@acme.com' } },
    }));
    assert.equal(r.statusCode, 502);
  });

  test('checkout provisions as paid — the one door money actually comes through', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'pm';
    const calls = stubFetch([provisioned(), ['postmarkapp', { status: 200, body: {} }]]);
    await fn.handler(signedStripeEvent(SECRET, checkoutSessionCompleted({ email: 'b@acme.com', metadata: { domain: 'acme.com' } })));
    const post = calls.find(c => c.url.includes('/api/provision') && c.method === 'POST');
    assert.equal(JSON.parse(post.body).plan, 'paid');
  });
});

// The re-subscribe landing: existing + resumed is the gate working, not a
// collision — the operator hears good news, and the buyer gets no second
// welcome mail for a studio they already know.
describe('stripe-webhook resume notice', () => {
  beforeEach(() => {
    resetEnv();
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    process.env.STUDIO_PROVISION_SECRET = 'shh';
    process.env.POSTMARK_SERVER_TOKEN = 'pm';
  });

  test('a resumed workspace is reported calmly, with the double-billing hand-check', async () => {
    const calls = stubFetch([
      ['/api/provision', { status: 200, body: { client: { id: 'acme' }, existing: true, resumed: true } }],
      ['postmarkapp', { status: 200, body: {} }],
    ]);
    const r = await fn.handler(signedStripeEvent(SECRET, checkoutSessionCompleted({ email: 'b@acme.com', metadata: { domain: 'acme.com' } })));
    assert.equal(r.statusCode, 200);
    const m = mail(calls).find(x => /resumed/i.test(x.Subject));
    assert.ok(m, 'the operator hears it as good news');
    assert.doesNotMatch(m.Subject, /needs attention/);
    assert.match(m.TextBody, /billed twice/, 'the one hand-check is named');
    assert.equal(welcome(calls), undefined, 'no second welcome for a studio they already know');
  });
});
