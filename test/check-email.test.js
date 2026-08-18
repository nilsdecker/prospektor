// The pre-flight the /checkout/ page uses. It must never expose more than
// "taken or not" about an address the caller already typed.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { stubFetch, post, get, resetEnv } = require('./helpers');
const fn = require('../netlify/functions/check-email');
const body = r => JSON.parse(r.body);

describe('check-email', () => {
  beforeEach(() => { resetEnv(); process.env.STUDIO_PROVISION_SECRET = 'shh'; });

  test('rejects anything that is not an email before calling the studio', async () => {
    const calls = stubFetch([['provision-check', { status: 200, body: { taken: false } }]]);
    assert.equal((await post(fn, { email: 'nope' })).statusCode, 400);
    assert.equal(calls.length, 0);
  });

  test('only answers POST', async () => { assert.equal((await get(fn)).statusCode, 405); });

  test('sends the shared secret server-side, never to the browser', async () => {
    const calls = stubFetch([['provision-check', { status: 200, body: { taken: false } }]]);
    await post(fn, { email: 'a@acme.com' });
    assert.equal(calls[0].headers['x-provision-secret'], 'shh');
    assert.ok(!JSON.stringify(body(await post(fn, { email: 'a@acme.com' }))).includes('shh'));
  });

  test('reports a free address as free, and says the studio was actually asked', async () => {
    stubFetch([['provision-check', { status: 200, body: { taken: false } }]]);
    const r = body(await post(fn, { email: 'a@acme.com' }));
    assert.deepEqual({ taken: r.taken, checked: r.checked, message: r.message }, { taken: false, checked: true, message: '' });
  });

  test('distinguishes this address from a colleague on the same domain', async () => {
    stubFetch([['provision-check', { status: 200, body: { taken: true, name: 'Acme GmbH', reason: 'email' } }]]);
    assert.match(body(await post(fn, { email: 'a@acme.com' })).message, /This email already has a studio/);
    stubFetch([['provision-check', { status: 200, body: { taken: true, name: 'Acme GmbH', reason: 'domain' } }]]);
    assert.match(body(await post(fn, { email: 'b@acme.com' })).message, /Acme GmbH already has a studio/);
  });

  test('a suspended owner reads as free-to-pay, with the welcome-back sentence', async () => {
    stubFetch([['provision-check', { status: 200, body: { taken: true, name: 'Acme GmbH', reason: 'email', suspended: true } }]]);
    const r = body(await post(fn, { email: 'a@acme.com' }));
    assert.equal(r.taken, false, 'checkout is open to them — it is the re-subscribe path');
    assert.equal(r.suspended, true);
    assert.match(r.message, /reactivates it/);
  });

  test('fails open, and says so via checked:false rather than pretending', async () => {
    for (const reply of [{ status: 403, body: {} }, { status: 503, body: {} }, { status: 200, body: { nonsense: 1 } }]) {
      stubFetch([['provision-check', reply]]);
      const r = body(await post(fn, { email: 'a@acme.com' }));
      assert.equal(r.taken, false);
      assert.equal(r.checked, false, 'a non-answer must not masquerade as a clean "free"');
    }
  });

  test('fails open with no secret configured, without calling out', async () => {
    delete process.env.STUDIO_PROVISION_SECRET;
    const calls = stubFetch([['provision-check', { status: 200, body: { taken: true } }]]);
    assert.equal(body(await post(fn, { email: 'a@acme.com' })).checked, false);
    assert.equal(calls.length, 0);
  });
});
