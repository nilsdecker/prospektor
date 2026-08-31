// The Search Console client (#446).
//
// What is worth testing here is exactly the part the brief calls "the only
// fiddly part": the JWT assertion a service account signs and trades for an
// access token. It is the piece with no visible failure — a malformed
// assertion comes back as a flat `invalid_grant` from Google with no clue
// which of the six fields is wrong, and it is the piece a session cannot
// debug against the real API because the credential deliberately never
// reaches a session (it lives in a GitHub Actions secret; see tools/gsc.js).
//
// So the signature is generated against a throwaway key and verified here,
// the way Google would verify it. Nothing in this file touches the network.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const gsc = require('../tools/gsc.js');

// A service-account key file, minus everything the client does not read.
const keypair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY = {
  type: 'service_account',
  client_email: 'seo-agent@prospektor.iam.gserviceaccount.com',
  private_key: keypair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
};

// token() posts to Google, so the assertion is captured off the request rather
// than exported: what ships is what gets tested, not a re-implementation.
async function captureAssertion() {
  const realFetch = global.fetch;
  let sent;
  global.fetch = async (url, opts) => {
    sent = Object.fromEntries(new URLSearchParams(opts.body));
    return { ok: true, status: 200, json: async () => ({ access_token: 'test-token' }) };
  };
  try { await gsc.token(KEY); } finally { global.fetch = realFetch; }
  return sent;
}

describe('gsc — the service-account assertion', () => {
  test('is a three-segment RS256 JWT that verifies against the key', async () => {
    const sent = await captureAssertion();
    assert.strictEqual(sent.grant_type, 'urn:ietf:params:oauth:grant-type:jwt-bearer');

    const parts = sent.assertion.split('.');
    assert.strictEqual(parts.length, 3, 'assertion is header.claims.signature');

    const [header, claims, signature] = parts;
    assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${header}.${claims}`),
      keypair.publicKey, Buffer.from(signature, 'base64url')),
      'signature does not verify — Google would answer invalid_grant');
  });

  test('is base64url with the padding stripped', async () => {
    const { assertion } = await captureAssertion();
    // The spec wants base64url; `+`, `/` or `=` is the classic way this fails,
    // and it fails as an opaque invalid_grant rather than as a parse error.
    assert.ok(!/[+/=]/.test(assertion), `not base64url: ${assertion.slice(0, 40)}`);
  });

  test('claims the read-only scope and an hour of validity', async () => {
    const { assertion } = await captureAssertion();
    const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString());

    assert.strictEqual(claims.iss, KEY.client_email);
    assert.strictEqual(claims.aud, 'https://oauth2.googleapis.com/token');
    // Read-only, deliberately. Full access buys sitemap submission — which
    // Google calls "merely a hint" — and makes a leaked key able to write.
    assert.strictEqual(claims.scope, 'https://www.googleapis.com/auth/webmasters.readonly');
    assert.ok(claims.exp - claims.iat <= 3600, 'Google rejects an assertion valid for over an hour');
    assert.ok(Math.abs(claims.iat - Math.floor(Date.now() / 1000)) < 60, 'iat is not now');
  });
});

describe('gsc — the credential guard', () => {
  // Every one of these is a real mistake with an unhelpful native error, and
  // the point of the guard is that `check` names the step rather than letting
  // a stack trace out.
  const rejects = (env, expect) => {
    const prev = process.env.GSC_SERVICE_ACCOUNT_KEY;
    process.env.GSC_SERVICE_ACCOUNT_KEY = env;
    try {
      assert.throws(() => gsc.credentials(), e => e.message.includes(expect),
        `expected a message mentioning "${expect}"`);
    } finally {
      if (prev === undefined) delete process.env.GSC_SERVICE_ACCOUNT_KEY;
      else process.env.GSC_SERVICE_ACCOUNT_KEY = prev;
    }
  };

  test('an OAuth client key is rejected by name, not by stack trace', () => {
    // The commonest wrong download: Google offers "OAuth client ID" on the
    // same screen, and its JSON has no client_email at all.
    rejects('{"type":"authorized_user","client_id":"x"}', 'client_email');
  });

  test('a truncated paste says it is not JSON', () => {
    rejects('{"client_email": "a@b.com", "private_key"', 'not JSON');
  });

  test('a key with no private_key is named', () => {
    rejects('{"client_email":"a@b.com"}', 'private_key');
  });

  test('a missing credential says which variable to set', () => {
    const prev = process.env.GSC_SERVICE_ACCOUNT_KEY;
    delete process.env.GSC_SERVICE_ACCOUNT_KEY;
    try {
      assert.throws(() => gsc.credentials(), e => e.message.includes('GSC_SERVICE_ACCOUNT_KEY'));
    } finally { if (prev !== undefined) process.env.GSC_SERVICE_ACCOUNT_KEY = prev; }
  });
});
