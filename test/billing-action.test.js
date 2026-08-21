// The studio's hand on a subscription (studio queue #29). What these guard:
// the door is the shared secret and nothing reaches Stripe before it is
// checked; every non-canceled subscription behind the address is acted on,
// across every customer that address has minted (a re-subscribe can leave
// two); pause is pause_collection:'void', resume only unpauses, cancel
// deletes; and a Stripe failure is a loud 502, never a quiet half-answer.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { stubFetch, resetEnv } = require('./helpers');
const fn = require('../netlify/functions/billing-action');

const SECRET = 's'.repeat(40);

const post = (body, secret = SECRET) => fn.handler({
  httpMethod: 'POST',
  headers: secret === null ? {} : { 'x-provision-secret': secret },
  body: JSON.stringify(body),
});

// One address, two customers (each checkout mints one), three subscriptions:
// an active, a paused, and a long-canceled one that must be left alone.
const stripeRoutes = (extra = []) => [
  ['/v1/customers?', { status: 200, body: { data: [{ id: 'cus_1' }, { id: 'cus_2' }] } }],
  ['/v1/subscriptions?customer=cus_1', { status: 200, body: { data: [
    { id: 'sub_active', status: 'active' },
    { id: 'sub_dead', status: 'canceled' },
  ] } }],
  ['/v1/subscriptions?customer=cus_2', { status: 200, body: { data: [
    { id: 'sub_paused', status: 'active', pause_collection: { behavior: 'void' } },
  ] } }],
  ...extra,
  ['/v1/subscriptions/', { status: 200, body: { id: 'sub_x' } }],
];

const acts = calls => calls.filter(c => c.url.includes('/v1/subscriptions/'));

describe('billing-action', () => {
  beforeEach(() => {
    resetEnv();
    process.env.STUDIO_PROVISION_SECRET = SECRET;
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  });

  test('the door: 405 on GET, 503 unset or short, 403 wrong — and Stripe is never asked first', async () => {
    const calls = stubFetch(stripeRoutes());
    assert.equal((await fn.handler({ httpMethod: 'GET' })).statusCode, 405);

    delete process.env.STUDIO_PROVISION_SECRET;
    assert.equal((await post({ email: 'b@acme.com', action: 'pause' })).statusCode, 503);
    process.env.STUDIO_PROVISION_SECRET = 'short';
    assert.equal((await post({ email: 'b@acme.com', action: 'pause' }, 'short')).statusCode, 503,
      'a weak secret means the door does not exist');
    process.env.STUDIO_PROVISION_SECRET = SECRET;
    assert.equal((await post({ email: 'b@acme.com', action: 'pause' }, 'wrong')).statusCode, 403);
    assert.equal((await post({ email: 'b@acme.com', action: 'pause' }, null)).statusCode, 403);
    assert.equal(calls.length, 0, 'every refusal happened before any Stripe call');
  });

  test('refuses garbage before Stripe: a bad action, a non-address, no key', async () => {
    const calls = stubFetch(stripeRoutes());
    assert.equal((await post({ email: 'b@acme.com', action: 'obliterate' })).statusCode, 400);
    assert.equal((await post({ email: 'not-an-email', action: 'pause' })).statusCode, 400);
    delete process.env.STRIPE_SECRET_KEY;
    assert.equal((await post({ email: 'b@acme.com', action: 'pause' })).statusCode, 503);
    assert.equal(calls.length, 0);
  });

  test('pause voids collection on every live subscription, across customers, skipping the canceled', async () => {
    const calls = stubFetch(stripeRoutes());
    const r = await post({ email: 'B@Acme.com', action: 'pause' });
    assert.equal(r.statusCode, 200);
    const body = JSON.parse(r.body);
    assert.equal(body.matched, 2, 'the active and the already-paused — never the canceled');
    assert.deepEqual(body.subscriptions, ['sub_active', 'sub_paused']);
    const touched = acts(calls);
    assert.ok(touched.every(c => c.method === 'POST' && String(c.body).includes('pause_collection%5Bbehavior%5D=void')),
      'pause is pause_collection, not cancellation');
    assert.ok(!touched.some(c => c.url.includes('sub_dead')), 'the canceled subscription is left alone');
    const customers = calls.find(c => c.url.includes('/v1/customers?'));
    assert.ok(customers.url.includes('email=b%40acme.com'), 'the address is lowercased before Stripe sees it');
  });

  test('resume clears pause_collection on paused subscriptions only', async () => {
    const calls = stubFetch(stripeRoutes());
    const r = await post({ email: 'b@acme.com', action: 'resume' });
    const body = JSON.parse(r.body);
    assert.deepEqual(body.subscriptions, ['sub_paused'], 'an unpaused subscription needs nothing');
    const [touch] = acts(calls);
    assert.equal(touch.method, 'POST');
    assert.equal(String(touch.body), 'pause_collection=', 'an empty value is how Stripe unsets it');
  });

  test('cancel deletes every live subscription', async () => {
    const calls = stubFetch(stripeRoutes());
    const r = await post({ email: 'b@acme.com', action: 'cancel' });
    assert.equal(JSON.parse(r.body).matched, 2);
    assert.ok(acts(calls).every(c => c.method === 'DELETE'));
  });

  test('an address with nothing behind it answers matched 0, calmly', async () => {
    stubFetch([['/v1/customers?', { status: 200, body: { data: [] } }]]);
    const r = await post({ email: 'nobody@acme.com', action: 'cancel' });
    assert.equal(r.statusCode, 200);
    assert.equal(JSON.parse(r.body).matched, 0);
  });

  test('a Stripe failure is a loud 502, so the studio never reports billing stopped when it did not', async () => {
    stubFetch([['/v1/customers?', { status: 500, body: { error: { message: 'boom' } } }]]);
    const r = await post({ email: 'b@acme.com', action: 'pause' });
    assert.equal(r.statusCode, 502);
    assert.match(JSON.parse(r.body).error, /Stripe dashboard/, 'the answer says where to finish the job');
  });
});
