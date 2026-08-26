// create-checkout-session is the last server-side step before money can move,
// so these tests are mostly about what it REFUSES to do.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { stubFetch, post, get, resetEnv } = require('./helpers');
const fn = require('../netlify/functions/create-checkout-session');

const STRIPE_OK = ['api.stripe.com', { status: 200, body: { url: 'https://checkout.stripe.com/c/pay/cs_test_1' } }];
const FREE = ['provision-check', { status: 200, body: { taken: false } }];
const body = r => JSON.parse(r.body);
const stripeCalls = calls => calls.filter(c => c.url.includes('api.stripe.com'));

describe('create-checkout-session', () => {
  beforeEach(() => { resetEnv(); process.env.STRIPE_SECRET_KEY = 'sk_test_x'; process.env.STUDIO_PROVISION_SECRET = 'shh'; });

  test('is env-gated: no Stripe key means 503, never a broken checkout', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    assert.equal((await get(fn)).statusCode, 503);
    assert.equal((await post(fn, { email: 'a@acme.com' })).statusCode, 503);
  });

  test('GET is a probe that never creates a session', async () => {
    const calls = stubFetch([STRIPE_OK, FREE]);
    assert.equal((await get(fn)).statusCode, 200);
    assert.equal(stripeCalls(calls).length, 0);
  });

  test('requires an email, because an address Stripe collects is one nothing checked', async () => {
    stubFetch([STRIPE_OK, FREE]);
    assert.equal((await post(fn, { domain: 'acme.com' })).statusCode, 400);
    assert.equal((await post(fn, { email: 'nope', domain: 'acme.com' })).statusCode, 400);
  });

  test('derives the website from a work email so provisioning has one', async () => {
    const calls = stubFetch([STRIPE_OK, FREE]);
    assert.equal((await post(fn, { email: 'buyer@acme.com', from: 'pricing' })).statusCode, 200);
    const p = new URLSearchParams(stripeCalls(calls)[0].body);
    assert.equal(p.get('metadata[domain]'), 'acme.com');
    assert.equal(p.get('customer_email'), 'buyer@acme.com', 'email must be locked at Stripe');
  });

  test('asks a free-mail buyer for a website instead of selling blind', async () => {
    const calls = stubFetch([STRIPE_OK, FREE]);
    const r = await post(fn, { email: 'buyer@gmail.com', from: 'pricing' });
    assert.equal(r.statusCode, 422);
    assert.equal(body(r).need, 'website');
    assert.equal(stripeCalls(calls).length, 0, 'nothing may be sold without a company to research');
  });

  test('normalises whatever the buyer pasted into the website field', async () => {
    const calls = stubFetch([STRIPE_OK, FREE]);
    await post(fn, { email: 'b@gmail.com', domain: 'https://www.Acme.com/pricing?x=1', from: 'pricing' });
    assert.equal(new URLSearchParams(stripeCalls(calls)[0].body).get('metadata[domain]'), 'acme.com');
  });

  test('refuses an address that already owns a studio, and mints nothing', async () => {
    const calls = stubFetch([STRIPE_OK, ['provision-check', { status: 200, body: { taken: true, name: 'Acme GmbH', reason: 'email' } }]]);
    const r = await post(fn, { email: 'b@acme.com', from: 'pricing' });
    assert.equal(r.statusCode, 409);
    assert.match(body(r).error, /already has a studio/);
    assert.equal(stripeCalls(calls).length, 0, 'a taken address must never reach Stripe');
  });

  test('tells a colleague their company already has one, by name', async () => {
    stubFetch([STRIPE_OK, ['provision-check', { status: 200, body: { taken: true, name: 'Acme GmbH', reason: 'domain' } }]]);
    const r = await post(fn, { email: 'c@acme.com', from: 'pricing' });
    assert.equal(r.statusCode, 409);
    assert.match(body(r).error, /Acme GmbH already has a studio/);
  });

  test('lets a suspended owner back through — their checkout is the re-subscribe', async () => {
    const calls = stubFetch([STRIPE_OK, ['provision-check', { status: 200, body: { taken: true, name: 'Acme GmbH', reason: 'email', suspended: true } }]]);
    const r = await post(fn, { email: 'b@acme.com', domain: 'acme.com', from: 'pricing' });
    assert.equal(r.statusCode, 200, 'blocking them would seal the door the locked screen points at');
    assert.equal(stripeCalls(calls).length, 1, 'a session is minted; paying it is what unlocks the studio');
  });

  test('a re-subscribe session returns the buyer to the studio, both ways out', async () => {
    const calls = stubFetch([STRIPE_OK, ['provision-check', { status: 200, body: { taken: true, name: 'Acme GmbH', reason: 'email', suspended: true } }]]);
    const r = await post(fn, { email: 'b@acme.com', company: 'Acme GmbH', from: 'resubscribe' });
    assert.equal(r.statusCode, 200);
    const p = new URLSearchParams(stripeCalls(calls)[0].body);
    assert.equal(p.get('success_url'), 'https://studio.prospektor.ai/', 'paying lands them back in their unlocked studio');
    assert.equal(p.get('cancel_url'), 'https://studio.prospektor.ai/', 'cancelling lands on the locked screen, not the onboarding interview');
  });

  test('carries the goal and mirrors metadata onto the subscription', async () => {
    const calls = stubFetch([STRIPE_OK, FREE]);
    await post(fn, { email: 'b@acme.com', domain: 'acme.com', company: 'Acme', goal: 'Property managers' });
    const p = new URLSearchParams(stripeCalls(calls)[0].body);
    assert.equal(p.get('metadata[goal]'), 'Property managers');
    assert.equal(p.get('subscription_data[metadata][goal]'), 'Property managers');
  });

  test('carries a ticked marketing box as metadata, and only a literal true (#204)', async () => {
    const calls = stubFetch([STRIPE_OK, FREE]);
    await post(fn, { email: 'b@acme.com', domain: 'acme.com', marketing: true });
    const p = new URLSearchParams(stripeCalls(calls)[0].body);
    assert.equal(p.get('metadata[marketing]'), 'yes');
    assert.equal(p.get('subscription_data[metadata][marketing]'), 'yes');

    // Unticked, absent, or a string that merely looks true all mean the same
    // thing: no metadata key at all — nothing may ride through checkout and
    // come out the other side as consent nobody gave.
    for (const marketing of [false, undefined, 'true', 1]) {
      await post(fn, { email: 'b@acme.com', domain: 'acme.com', marketing });
      const last = new URLSearchParams(stripeCalls(calls).at(-1).body);
      assert.equal(last.get('metadata[marketing]'), null);
    }
  });

  test('sends a cancelling buyer back where they started', async () => {
    const calls = stubFetch([STRIPE_OK, FREE]);
    await post(fn, { email: 'b@acme.com', from: 'pricing' });
    assert.match(new URLSearchParams(stripeCalls(calls)[0].body).get('cancel_url'), /\/#pricing$/);
    await post(fn, { email: 'b@acme.com', domain: 'acme.com' });
    assert.match(new URLSearchParams(stripeCalls(calls)[1].body).get('cancel_url'), /\/checkout\/$/);
  });

  // Fail-open is a deliberate choice: blocking a paying customer because the
  // studio hiccuped is worse than the collision, which the operator notice
  // already surfaces for a human.
  for (const [name, reply] of [
    ['a 403 (wrong secret)', { status: 403, body: {} }],
    ['a 503 (studio unconfigured)', { status: 503, body: {} }],
    ['a 404 (endpoint gone)', { status: 404, body: {} }],
    ['a shape it does not recognise', { status: 200, body: { hello: 'world' } }],
    ['the studio being unreachable', new Error('ECONNREFUSED')],
  ]) {
    test(`sells anyway on ${name}`, async () => {
      stubFetch([STRIPE_OK, ['provision-check', reply]]);
      assert.equal((await post(fn, { email: 'd@acme.com', from: 'pricing' })).statusCode, 200);
    });
  }

  test('sells anyway when no provision secret is configured', async () => {
    delete process.env.STUDIO_PROVISION_SECRET;
    stubFetch([STRIPE_OK]);
    assert.equal((await post(fn, { email: 'e@acme.com', from: 'pricing' })).statusCode, 200);
  });

  test('surfaces a Stripe failure as 502 rather than a broken redirect', async () => {
    stubFetch([['api.stripe.com', { status: 400, body: { error: { message: 'bad' } } }], FREE]);
    assert.equal((await post(fn, { email: 'f@acme.com', from: 'pricing' })).statusCode, 502);
  });
});
