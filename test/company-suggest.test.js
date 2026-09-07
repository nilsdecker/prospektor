// The scan field's typeahead source (#241). What these protect, in the order
// they would break: the visitor's browser never talks to the provider (the
// function is the one door), nothing but the typed characters leaves, a logo
// URL never comes back (the #443 boundary), and a provider that is dead, slow
// or odd is an empty list — never an error the field could show.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { stubFetch, resetEnv } = require('./helpers');
const fn = require('../netlify/functions/company-suggest');

const get = q => fn.handler({ httpMethod: 'GET', queryStringParameters: q === undefined ? {} : { q } });
const body = r => JSON.parse(r.body);

const CLEARBIT = [
  { name: 'Stripe', domain: 'stripe.com', logo: 'https://logo.clearbit.com/stripe.com' },
  { name: 'Stripes', domain: 'stripes.co', logo: null },
  { name: '', domain: 'nameless.example', logo: null },
  { name: 'Domainless', domain: null, logo: null },
];

describe('company-suggest', () => {
  beforeEach(() => { resetEnv(); fn._clearMemo(); });

  test('only answers GET', async () => {
    const calls = stubFetch([['clearbit', { status: 200, body: CLEARBIT }]]);
    assert.equal((await fn.handler({ httpMethod: 'POST', body: '{"q":"stripe"}' })).statusCode, 405);
    assert.equal(calls.length, 0);
  });

  test('asks the provider nothing for under two characters, or for nothing at all', async () => {
    const calls = stubFetch([['clearbit', { status: 200, body: CLEARBIT }]]);
    for (const q of [undefined, '', ' ', 's', '  s  ']) {
      const r = await get(q);
      assert.equal(r.statusCode, 200);
      assert.deepEqual(body(r), { suggestions: [] });
    }
    assert.equal(calls.length, 0);
  });

  test('sends nothing but the characters typed — no header, no identifier', async () => {
    const calls = stubFetch([['clearbit', { status: 200, body: CLEARBIT }]]);
    await get('str ipe');
    assert.equal(calls.length, 1);
    const u = new URL(calls[0].url);
    assert.equal(u.hostname, 'autocomplete.clearbit.com');
    assert.deepEqual([...u.searchParams.entries()], [['query', 'str ipe']]);
    assert.equal(calls[0].method, 'GET');
    assert.deepEqual(calls[0].headers, {});
    assert.equal(calls[0].body, undefined);
  });

  test('answers name and domain only — the logo URL stops at the boundary (#443)', async () => {
    stubFetch([['clearbit', { status: 200, body: CLEARBIT }]]);
    const r = await get('stripe');
    assert.equal(r.statusCode, 200);
    assert.deepEqual(body(r), { suggestions: [
      { name: 'Stripe', domain: 'stripe.com' },
      { name: 'Stripes', domain: 'stripes.co' },
    ] });
    assert.ok(!r.body.includes('logo'), 'a browser-fetchable URL got past the boundary');
    assert.match(r.headers['cache-control'], /max-age=600/);
  });

  test('caps the list, and lower-cases the domain', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `Co ${i}`, domain: `CO${i}.EXAMPLE`, logo: null }));
    stubFetch([['clearbit', { status: 200, body: many }]]);
    const s = body(await get('co')).suggestions;
    assert.equal(s.length, 6);
    assert.equal(s[0].domain, 'co0.example');
  });

  test('a dead provider is an empty list, never an error', async () => {
    stubFetch([['clearbit', new Error('ECONNRESET')]]);
    const r = await get('stripe');
    assert.equal(r.statusCode, 200);
    assert.deepEqual(body(r), { suggestions: [] });
  });

  test('a provider that answers 5xx, or with something that is not a list, is an empty list', async () => {
    stubFetch([['clearbit', { status: 503, body: 'down' }]]);
    assert.deepEqual(body(await get('stripe')), { suggestions: [] });
    stubFetch([['clearbit', { status: 200, body: { error: 'odd' } }]]);
    assert.deepEqual(body(await get('stripe')), { suggestions: [] });
  });

  test('a warm container remembers an answer, so a backspace costs no second call', async () => {
    const calls = stubFetch([['clearbit', { status: 200, body: CLEARBIT }]]);
    await get('stripe');
    await get('Stripe');
    assert.equal(calls.length, 1);
    await get('strip');
    assert.equal(calls.length, 2);
  });

  test('an empty answer is not remembered — the provider may have been down', async () => {
    const calls = stubFetch([['clearbit', { status: 503, body: 'down' }]]);
    await get('stripe');
    stubFetch([['clearbit', { status: 200, body: CLEARBIT }]]);
    assert.equal(body(await get('stripe')).suggestions.length, 2);
    assert.equal(calls.length, 1);
  });

  test('refuses a query longer than a company name could be', async () => {
    const calls = stubFetch([['clearbit', { status: 200, body: CLEARBIT }]]);
    assert.deepEqual(body(await get('x'.repeat(65))), { suggestions: [] });
    assert.equal(calls.length, 0);
  });
});
