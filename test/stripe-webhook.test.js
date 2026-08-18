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
    assert.ok(welcome(calls), 'a new workspace earns a welcome email');
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
