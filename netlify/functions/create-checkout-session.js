// Opens Stripe Checkout — for the pricing tile's one-field buy form and for
// the /checkout/ payment step alike.
//
// One product, two ways to pay for it: a Prospektor workspace, $999/month or
// $9,990/year, as a subscription (CEO decision, 16 Aug 2026; the yearly plan
// is #542, the operator's call on 7 Sep 2026 — "let's do the two months free
// thing for prepayment for the year"). Both prices are inline price_data so
// no dashboard product needs to exist; promotion codes are on so
// founding-client rates are coupons the operator creates in the Stripe
// dashboard, never a code change.
//
// Env-gated: with no STRIPE_SECRET_KEY this returns 503 and every caller
// falls back to what it showed before keys existed. GET is the availability
// probe the pages use to decide which UI to show; it never creates a session.
//
// This function is the last server-side thing that happens before money can
// move, so the two things a paid session must have are enforced HERE rather
// than in whichever page called it:
//
//   1. An address that does not already own a studio (§2b ownership check).
//      The pricing CTA goes straight to Stripe, so there is no onboarding
//      page left to run that check on — it has to be structural, not a
//      convention a client remembers to follow.
//   2. A company or website to provision from. /api/provision returns 400
//      without one; the webhook would then keep returning non-2xx and Stripe
//      would redeliver for days against a buyer who has been charged $999 and
//      has no workspace. Refusing to open checkout is the cheap failure.
//
// The buyer's email is passed to Stripe as customer_email, which locks the
// field there — that is what keeps the check above meaningful, since the
// address that pays is then the address that was checked.

const { checkOwnership, ownershipMessage } = require('../lib/ownership');
const { companyDomainFromEmail, cleanDomain } = require('../lib/email-domain');
const { languageOf, LANGUAGES } = require('../../lib/i18n');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The two plans, and the only place either figure is written (#542). Yearly is
// ten months' money for twelve months of workspace — $9,990 against $11,988,
// which is the "two months free" the operator asked for; /terms/ §02 says the
// price is then fixed for that year. Both are inline `price_data`, so adding a
// plan is a row here and never a product somebody has to remember to create in
// the Stripe dashboard — which is what keeps the figure on /pricing/ and the
// figure that leaves a card the same number by construction. Exported because
// `test/seo.test.js` reads this table and asserts the page's schema against it.
const PLANS = {
  month: { unit_amount: '99900', interval: 'month' },
  year: { unit_amount: '999000', interval: 'year' },
};
exports.PLANS = PLANS;

// A plan the table does not hold — a missing one, a typo, anything a browser
// can be made to send — is monthly. So the field can never charge a price this
// file does not carry, the same way `languageOf` keeps `locale` from steering
// a URL. `hasOwnProperty` rather than a truthiness test, so `constructor` is
// not a plan.
const planOf = value => {
  const name = String(value == null ? '' : value).trim();
  return Object.prototype.hasOwnProperty.call(PLANS, name) ? name : 'month';
};

exports.handler = async function(event) {
  const key = process.env.STRIPE_SECRET_KEY;

  if (event.httpMethod === 'GET') {
    return key
      ? { statusCode: 200, body: JSON.stringify({ configured: true }) }
      : { statusCode: 503, body: JSON.stringify({ error: 'Checkout is not open yet' }) };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  if (!key) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Checkout is not open yet' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // 500 is Stripe's metadata value ceiling.
  const meta = v => String(v || '').trim().slice(0, 500);
  const company = meta(data.company);
  const goal = meta(data.goal);
  const email = String(data.email || '').trim().toLowerCase();
  // #114: the language the buyer was reading in. Only a code from the closed
  // set counts, and English counts as nothing — so an English purchase sends
  // Stripe exactly the request it always did, and a Spanish one adds three
  // things: Stripe's own translated hosted page (`locale`), return URLs on the
  // Spanish pages, and a `language` in the metadata for the welcome email and
  // the studio. Whitelisted by the set, so the field can never steer a URL.
  const language = languageOf(data.locale);
  const lang = language && language !== 'en' ? LANGUAGES.find(l => l.code === language) : null;
  const prefix = lang ? lang.prefix : '';
  // #542: monthly or yearly. Monthly is the default and writes nothing extra —
  // the same posture the language field takes — so a monthly purchase is the
  // Stripe request this function always sent, byte for byte.
  const plan = planOf(data.plan);
  const price = PLANS[plan];

  // Required now, where it used to be optional. Stripe can collect an address
  // itself, but an address Stripe collects is one nothing has checked — and
  // the ownership guard below is the whole reason the price can lead straight
  // here without an onboarding page in front of it.
  if (!EMAIL_RE.test(email)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'That doesn’t look like an email address — this one becomes your studio’s sign-in.' }),
    };
  }

  // Who are we researching? A website if one was passed (the scan path, or a
  // buyer who answered the ask below); otherwise the company behind a work
  // address. A free-mail address names no company, so that buyer is asked —
  // 422 is the page's cue to reveal one more field, and it costs no studio
  // call because it is answered before the check below.
  let website = cleanDomain(data.domain);
  if (!website && !company) {
    website = companyDomainFromEmail(email);
    if (!website) {
      return {
        statusCode: 422,
        body: JSON.stringify({
          need: 'website',
          error: 'That’s a personal address, so it doesn’t tell us who to research. What’s your company’s website?',
        }),
      };
    }
  }

  const owned = await checkOwnership(email);
  // Suspended is the exception to one-email-one-workspace: this owner's
  // subscription lapsed, their studio is locked, and completing this checkout
  // is what unlocks it — the studio resumes the workspace instead of creating
  // a duplicate. Blocking them here would seal the front door of the very
  // path the locked screen sends them down.
  if (owned.taken && !owned.suspended) {
    return {
      statusCode: 409,
      body: JSON.stringify({
        error: ownershipMessage(owned),
        reason: owned.reason,
        signin: 'https://studio.prospektor.ai',
      }),
    };
  }

  const site = process.env.URL || 'https://prospektor.ai';
  // Cancelling should land where they started, not somewhere they have never
  // been: the pricing tile sends them back to the price, /checkout/ back to
  // its payment step, and a re-subscribe (minted server-to-server by the
  // studio's locked screen) back to the studio. Whitelisted, so the field
  // cannot become an open redirect.
  const cancelUrl = data.from === 'resubscribe'
    ? 'https://studio.prospektor.ai/'
    : site + prefix + (data.from === 'pricing' ? '/#pricing' : '/checkout/');

  const params = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': price.unit_amount,
    'line_items[0][price_data][recurring][interval]': price.interval,
    'line_items[0][price_data][product_data][name]': 'Prospektor — one workspace',
    allow_promotion_codes: 'true',
    // {CHECKOUT_SESSION_ID} is Stripe's template literal — Stripe substitutes
    // the real cs_… id on redirect, and /checkout/done/ trades it back for
    // the paid amount and sign-in address via checkout-session-status (#244).
    success_url: data.from === 'resubscribe' ? 'https://studio.prospektor.ai/'
      : site + prefix + '/checkout/done/?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: cancelUrl,
  });
  if (lang) params.set('locale', lang.code);
  // #204: the optional marketing box. Only a literal true becomes metadata —
  // "false" from a form, or anything else truthy-looking, must never ride
  // through checkout and come out the other side as consent. Absent means
  // exactly what an unticked box means: nothing is recorded anywhere.
  const marketing = data.marketing === true ? 'yes' : '';
  for (const [k, v] of [['domain', website], ['company', company], ['goal', goal], ['marketing', marketing], ['language', lang ? lang.code : ''], ['plan', plan === 'month' ? '' : plan]]) {
    if (v) {
      params.set('metadata[' + k + ']', v);
      params.set('subscription_data[metadata][' + k + ']', v);
    }
  }
  params.set('customer_email', email);

  let response, session;
  try {
    response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    session = await response.json();
  } catch (e) {
    console.error('Stripe unreachable:', e.message);
    return { statusCode: 502, body: JSON.stringify({ error: 'Could not open checkout' }) };
  }

  if (!response.ok || !session || !session.url) {
    console.error('Stripe session create failed:', response.status,
      JSON.stringify((session && session.error) || session || null).slice(0, 500));
    return { statusCode: 502, body: JSON.stringify({ error: 'Could not open checkout' }) };
  }

  return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
};
