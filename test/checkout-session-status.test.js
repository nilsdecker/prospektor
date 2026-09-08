// checkout-session-status hands /checkout/done/ the four facts its
// confirmation shows — and nothing else. These tests are mostly about what
// it refuses to say.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { stubFetch, resetEnv } = require('./helpers');
const fn = require('../netlify/functions/checkout-session-status');

const get = (qs = {}) => fn.handler({ httpMethod: 'GET', queryStringParameters: qs });
const body = r => JSON.parse(r.body);

const SESSION = {
  object: 'checkout.session',
  payment_status: 'paid',
  amount_total: 1, // the operator's own $0.01 case — promo codes make this anything
  currency: 'usd',
  customer_details: { email: 'buyer@acme.com' },
  customer_email: null,
  metadata: { goal: 'secret goal sentence' },
  subscription: 'sub_123',
};

describe('checkout-session-status', () => {
  beforeEach(() => { resetEnv(); process.env.STRIPE_SECRET_KEY = 'sk_test_x'; });

  test('is env-gated: no key means 503, and the done page keeps its generic copy', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    assert.equal((await get({ session_id: 'cs_test_abcdefghij' })).statusCode, 503);
  });

  test('only GET', async () => {
    assert.equal((await fn.handler({ httpMethod: 'POST', body: '{}' })).statusCode, 405);
  });

  test('refuses anything that is not a cs_… id before asking Stripe', async () => {
    const calls = stubFetch([['api.stripe.com', { status: 200, body: SESSION }]]);
    for (const bad of [undefined, '', 'sub_123', 'cs_short', 'cs_test_abc!def%20ghi', 'x'.repeat(300)]) {
      assert.equal((await get({ session_id: bad })).statusCode, 400, JSON.stringify(bad));
    }
    assert.equal(calls.length, 0, 'no malformed id may reach Stripe');
  });

  test('returns the paid amount, currency and address — the $0.01 case included', async () => {
    stubFetch([['api.stripe.com', { status: 200, body: SESSION }]]);
    const r = await get({ session_id: 'cs_test_abcdefghij' });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(body(r), { paid: true, amount_total: 1, currency: 'usd', email: 'buyer@acme.com', plan: 'month' });
  });

  test('never leaks the rest of the session — metadata, subscription id, anything', async () => {
    stubFetch([['api.stripe.com', { status: 200, body: SESSION }]]);
    const r = await get({ session_id: 'cs_test_abcdefghij' });
    assert.deepEqual(Object.keys(body(r)).sort(), ['amount_total', 'currency', 'email', 'paid', 'plan']);
    assert.ok(!r.body.includes('secret goal sentence'));
    assert.ok(!r.body.includes('sub_123'));
  });

  // #542: the one field the metadata was widened by, and the only one. The
  // order card on /checkout/done/ used to print "$999/mo" as a constant; a
  // yearly buyer would have read a number they were not charged.
  test('says which plan was bought, and reads anything but "year" as monthly', async () => {
    for (const [metadata, want] of [
      [{ plan: 'year' }, 'year'],
      [{ plan: 'month' }, 'month'],
      [{}, 'month'],                       // every session sold before #542
      [{ plan: 'YEAR' }, 'month'],
      [{ plan: ['year'] }, 'month'],
      [undefined, 'month'],
    ]) {
      stubFetch([['api.stripe.com', { status: 200, body: Object.assign({}, SESSION, { metadata }) }]]);
      const r = await get({ session_id: 'cs_test_abcdefghij' });
      assert.equal(body(r).plan, want, `metadata=${JSON.stringify(metadata)}`);
    }
  });

  test('the plan is the ONLY thing that crosses from the metadata', async () => {
    stubFetch([['api.stripe.com', { status: 200, body: Object.assign({}, SESSION, {
      metadata: { plan: 'year', goal: 'secret goal sentence', domain: 'targetco.example', company: 'Target Co' },
    }) }]]);
    const r = await get({ session_id: 'cs_test_abcdefghij' });
    assert.equal(body(r).plan, 'year');
    for (const leak of ['secret goal sentence', 'targetco.example', 'Target Co'])
      assert.ok(!r.body.includes(leak), `${leak} must stay server-side`);
  });

  test('an unknown or non-session id is a 404, not an error page', async () => {
    stubFetch([['api.stripe.com', { status: 404, body: { error: { type: 'invalid_request_error' } } }]]);
    assert.equal((await get({ session_id: 'cs_test_abcdefghij' })).statusCode, 404);
  });

  test('an unpaid session says so instead of pretending', async () => {
    stubFetch([['api.stripe.com', { status: 200, body: { ...SESSION, payment_status: 'unpaid' } }]]);
    assert.equal(body(await get({ session_id: 'cs_test_abcdefghij' })).paid, false);
  });

  test('Stripe unreachable is a 502 the page swallows quietly', async () => {
    stubFetch([['api.stripe.com', new Error('boom')]]);
    assert.equal((await get({ session_id: 'cs_test_abcdefghij' })).statusCode, 502);
  });
});
