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


// ── One Eleventy build for the whole suite (#324) ─────────────────────────
//
// Seven test files each shelled out to `npx eleventy` in their own `before()`
// hook, and Node runs test FILES in parallel — so `npm test` was seven
// concurrent full builds. When one of them died, `stdio: 'ignore'` threw the
// reason away and Node summarised the hook failure as `# fail 0` and
// `# cancelled 10`: the consent gate's entire suite unproven, and nothing
// red-looking on the line a reader checks. `test/run.js` now builds once,
// before any test process starts, and hands the directory down in
// PPS_TEST_SITE.
//
// A file run on its own — `node --test test/consent.test.js` — still works:
// with no PPS_TEST_SITE it builds its own copy and cleans it up after.
const ELEVENTY = require('node:path').join(__dirname, '..', 'node_modules', '.bin', 'eleventy');

// The binary directly rather than through `npx`: one less resolver between a
// test and its build, and no npx cache for seven processes to contend on.
function buildInto(outDir, env) {
  const { execFileSync } = require('node:child_process');
  try {
    execFileSync(ELEVENTY, ['--quiet', '--output=' + outDir], {
      cwd: require('node:path').join(__dirname, '..'),
      stdio: 'pipe',
      env: { ...process.env, ...env },
    });
  } catch (err) {
    // Why the build failed is the one thing worth having, and it is exactly
    // what `stdio: 'ignore'` used to discard — which is why #324 could not be
    // diagnosed from its own output.
    const said = [err.stderr, err.stdout].map(b => b && b.toString().trim()).filter(Boolean).join('\n');
    throw new Error(`eleventy build failed (${outDir}):\n` + (said || err.message));
  }
}

function siteBuild(prefix) {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  if (process.env.PPS_TEST_SITE) return { dir: process.env.PPS_TEST_SITE, cleanup() {} };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix + '-'));
  buildInto(dir);
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

module.exports = { siteBuild, buildInto, stubFetch, post, get, signedStripeEvent, checkoutSessionCompleted, resetEnv };
