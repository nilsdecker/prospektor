// The checkout hook — payment success becomes a provisioned studio.
//
// Stripe calls this on checkout.session.completed; the handler verifies the
// signature, then calls the studio's /api/provision with the buyer's email
// and the domain/company/goal that rode through checkout metadata. Provision
// is idempotent by design — webhooks double-fire and buyers re-checkout, and
// a 200 with existing:true is success, not an error — so there is no dedupe
// bookkeeping here, only a plain retry on network failure.
//
// Any provision failure returns non-2xx so Stripe re-delivers (for days, with
// the operator alerted in the dashboard). That makes a not-yet-configured
// studio self-heal: once the secret lands, the next retry provisions.
//
// The welcome email is sent through Postmark, env-gated on POSTMARK_SERVER_TOKEN
// and skipped silently when unset. Its sign-in sentence names both doors —
// Google SSO and the studio's emailed single-use link (live 18 Aug 2026). It
// must never carry a sign-in token itself: those are single-use and expire in
// fifteen minutes, so a link that sat in a mail queue would arrive dead. An email failure never fails the webhook —
// a Stripe retry after a sent email would send it twice.
//
// Secrets (STRIPE_WEBHOOK_SECRET, STUDIO_PROVISION_SECRET, the Postmark
// token) live in this site's server env only, never in browser-delivered code.

const crypto = require('node:crypto');

const PROVISION_URL = 'https://studio.prospektor.ai/api/provision';
const SIGNATURE_TOLERANCE_SECONDS = 300;

// The site's brand, inlined for email clients (no webfonts, no remote
// images — nothing an email client can block or break).
const BRAND = {
  ink: '#1A1A18',
  inkMid: '#52524E',
  inkFaint: '#8F8F8A',
  offWhite: '#F7F5F0',
  stone: '#EDEAE3',
  accent: '#00B37E',
  coral: '#E8533A',
  font: "'Plus Jakarta Sans', -apple-system, 'Segoe UI', sans-serif",
};

// Shared shell: off-white ground, white card, wordmark header, footer line.
function emailShell(inner, footnote) {
  return `
<body style="margin:0;padding:32px 16px;background:${BRAND.offWhite};font-family:${BRAND.font};">
  <div style="max-width:560px;margin:0 auto;">
    <p style="font-size:18px;font-weight:800;letter-spacing:-0.02em;color:${BRAND.ink};margin:0 0 14px 4px;">Prospektor<span style="color:${BRAND.accent};">.</span></p>
    <div style="background:#ffffff;border:1px solid ${BRAND.stone};border-radius:14px;padding:32px;">
      ${inner}
    </div>
    <p style="font-size:12px;color:${BRAND.inkFaint};line-height:1.6;margin:16px 4px 0;">${footnote}</p>
  </div>
</body>`;
}

// Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>…] over `${t}.${rawBody}`.
function verifyStripeSignature(payload, header, secret) {
  if (!header || !secret) return false;
  let timestamp = null;
  const signatures = [];
  for (const part of String(header).split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === 't') timestamp = v;
    else if (k === 'v1') signatures.push(v);
  }
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = Buffer.from(
    crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex')
  );
  return signatures.some(sig => {
    const given = Buffer.from(sig);
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}

// The billing gate's switch on the studio (PATCH /api/provision, live
// 18 Aug 2026): suspend locks a workspace without touching its data, resume
// unlocks it. Addressed by the buyer's email; the studio resolves it with the
// same function every sign-in uses. Idempotent both ways, so double-fired
// events cost nothing.
async function callSuspension({ email, action, reason, secret }) {
  const body = JSON.stringify({ email, action, reason: reason || undefined });
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(PROVISION_URL, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-provision-secret': secret,
        },
        body,
      });
      const data = await response.json().catch(() => ({}));
      return { status: response.status, ok: response.ok, data };
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}

// The email behind a billing event. Renewal invoices carry it directly;
// subscription and dispute events only carry ids, so one authenticated read
// resolves the customer — the only Stripe API call in this codebase besides
// minting checkout sessions.
async function customerEmail(customerId) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !customerId) return '';
  try {
    const response = await fetch('https://api.stripe.com/v1/customers/' + encodeURIComponent(customerId), {
      headers: { authorization: 'Bearer ' + key },
    });
    if (!response.ok) return '';
    const customer = await response.json().catch(() => ({}));
    return String(customer.email || '').trim().toLowerCase();
  } catch (e) {
    return '';
  }
}

async function callProvision({ email, company, website, goal, secret }) {
  // `plan: 'paid'` because this caller is the one door money actually came
  // through — the studio defaults everything else to 'comped', and without
  // this line every checkout-provisioned workspace was landing as comped
  // while the board said otherwise (caught 18 Aug 2026).
  const body = JSON.stringify({ email, company, website, goal: goal || undefined, plan: 'paid' });
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(PROVISION_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-provision-secret': secret,
        },
        body,
      });
      const data = await response.json().catch(() => ({}));
      return { status: response.status, ok: response.ok, data };
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}

// One transport for operator/system mail: Postmark when its token exists,
// else the SendGrid key that already serves reserve-spot. Returns true when
// a channel accepted the message; failures are logged, never thrown.
async function sendMail({ to, subject, textBody, htmlBody, replyTo }) {
  const postmarkToken = process.env.POSTMARK_SERVER_TOKEN;
  const from = process.env.POSTMARK_FROM || 'hello@prospektor.ai';
  if (postmarkToken) {
    try {
      const response = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': postmarkToken,
        },
        body: JSON.stringify({
          From: `Prospektor <${from}>`,
          To: to,
          ReplyTo: replyTo || undefined,
          Subject: subject,
          TextBody: textBody,
          HtmlBody: htmlBody,
          MessageStream: 'outbound',
        }),
      });
      if (response.ok) return true;
      console.error('Postmark send failed:', response.status, (await response.text()).slice(0, 300));
    } catch (e) {
      console.error('Postmark unreachable:', e.message);
    }
    return false;
  }
  const sendgridKey = process.env.SENDGRID_API_KEY;
  if (!sendgridKey) return false;
  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sendgridKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from, name: 'Prospektor' },
        reply_to: replyTo ? { email: replyTo } : undefined,
        subject,
        content: [{ type: 'text/plain', value: textBody }, { type: 'text/html', value: htmlBody }],
      }),
    });
    if (response.status === 202) return true;
    console.error('SendGrid send failed:', response.status, (await response.text()).slice(0, 300));
  } catch (e) {
    console.error('SendGrid unreachable:', e.message);
  }
  return false;
}

// The seller's side of the sale: one notice per successful provision, written
// so the whole funnel can be checked from an inbox rather than from logs.
//
// Two things get a louder subject. `existing: true` — the buyer paid for a new
// studio but their address already owned one, so a human has to look. And a
// target sentence that was sent but not recorded: /api/provision answers with
// `goal: true` when a usable sentence arrived, so comparing what we sent with
// what it reports turns a silently-ignored field into a line in an email.
//
// That comparison is three-state, not a boolean, because the pricing tile's
// direct path deliberately sends no sentence at all — the studio infers one
// and asks the buyer to confirm it on first sign-in. Treating that as a
// failure would fire a warning on every direct purchase, which is the fastest
// way to teach someone to ignore the warning.
async function sendOperatorNotice({ email, company, website, goal, clientId, existing, resumed, goalRecorded }) {
  const operator = process.env.OPERATOR_EMAIL || 'hello@prospektor.ai';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Sent a sentence and the studio did not record it — the one case worth
  // shouting about, because the buyer typed something and it went nowhere.
  const goalDropped = !!goal && goalRecorded === false;
  const who = company ? ' — ' + company : website ? ' — ' + website : '';
  const subject = resumed
    ? `Subscription resumed: ${email}${who} paid and their workspace is unlocked`
    : existing
    ? `⚠️ Order needs attention: ${email} paid but already had a studio`
    : goalDropped
      ? `⚠️ Order fine, target sentence dropped: ${email}${who}`
      : `New order: ${email}${who}`;

  const targetLine = goal
    ? (goalRecorded === true
        ? `${goal}\n(recorded — it seeds their brief and they are not asked again)`
        : goalRecorded === false
          ? `${goal}\n⚠️ SENT BUT NOT RECORDED — the studio will infer a goal and ask them to confirm it instead`
          : goal)
    : 'none sent — bought straight from the pricing tile, so the studio infers one and asks them to confirm it';

  const lines = [
    ['Buyer email', email],
    ['Company', company],
    ['Domain', website],
    ['Their target', targetLine],
    ['Workspace', clientId ? `${clientId} (${resumed ? 'RESUMED — was suspended, this payment unlocked it' : existing ? 'EXISTING — no new workspace was created' : 'newly created'})` : ''],
  ];
  const textBody = [
    resumed
      ? 'A suspended customer completed checkout — their workspace is resumed and they are back in. One thing to check by hand: if their old subscription still exists in Stripe (a failed-payment suspension rather than a cancellation), cancel it so they are not billed twice.'
      : existing
      ? 'A buyer completed checkout, but their email already had a workspace — the studio returned the existing one and did NOT create a workspace for what they just bought. Reach out and sort it by hand.'
      : goalDropped
        ? 'A buyer completed checkout and their studio was provisioned — but the target sentence they typed was not recorded against it. They will be asked to confirm an inferred goal instead, so nothing is broken for them; something is broken for us.'
        : 'A buyer completed checkout and their studio was provisioned.',
    '',
    ...lines.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
  ].join('\n');
  const htmlBody = emailShell(`
    <p style="font-size:17px;font-weight:800;letter-spacing:-0.01em;color:${(existing && !resumed) || goalDropped ? BRAND.coral : BRAND.ink};margin:0 0 16px;">${resumed ? 'Subscription resumed' : existing ? '⚠️ Order needs attention' : goalDropped ? '⚠️ Order fine, target sentence dropped' : 'New order'}</p>
    ${resumed ? `<p style="font-size:13px;color:${BRAND.ink};line-height:1.65;margin:0 0 16px;">A suspended customer paid again and their workspace is unlocked. One hand-check: if their old subscription still exists in Stripe (failed payment rather than cancellation), cancel it so they are not billed twice.</p>` : existing ? `<p style="font-size:13px;color:${BRAND.ink};line-height:1.65;margin:0 0 16px;">The buyer paid, but this email already had a workspace — the studio returned the existing one and <strong>did not create a workspace for what they just bought</strong>. Reach out and sort it by hand.</p>` : ''}
    ${goalDropped ? `<p style="font-size:13px;color:${BRAND.ink};line-height:1.65;margin:0 0 16px;">The workspace was created, but the sentence this buyer typed <strong>was not recorded against it</strong> — <code>/api/provision</code> answered <code>goal:false</code> for a sentence we did send. They will be asked to confirm an inferred goal instead, so their experience is intact; the field is what is broken.</p>` : ''}
    <table style="width:100%;border-collapse:collapse;">
      ${lines.filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:8px 12px 8px 0;font-family:monospace;font-size:11px;color:${BRAND.inkFaint};text-transform:uppercase;vertical-align:top;white-space:nowrap;">${k}</td><td style="padding:8px 0;font-size:14px;color:${BRAND.ink};line-height:1.5;">${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}
    </table>`,
    'Sent by the Stripe webhook on prospektor.ai. Reply goes to the buyer.');
  const sent = await sendMail({ to: operator, subject, textBody, htmlBody, replyTo: email });
  if (!sent) console.error('Operator notice could not be sent for', email, existing ? '(EXISTING-workspace collision!)' : '');
}

// Buyer-facing, so Postmark only (deliverability is the point of that choice)
// — silent until the token is set. Sent only when a workspace was actually
// created: on existing:true the promise "your studio is ready" would be
// false, and a webhook double-fire would mail the same buyer twice.
async function sendWelcomeEmail(email) {
  if (!process.env.POSTMARK_SERVER_TOKEN) return;

  const textBody = [
    'Your Prospektor Partner Studio is ready.',
    '',
    'Sign in here: https://studio.prospektor.ai/?signin=' + encodeURIComponent(email),
    'Sign in with Google, using this address — the one you paid with — or have the studio email you a sign-in link from that page. Either way, that is the whole setup.',
    '',
    'While you were paying, your studio read your site and drafted your brief.',
    'First thing you’ll do is confirm your target sentence — one line, your words.',
    'Then three researched prospects are waiting to run your first pitches.',
    '',
    'Paid with your work email? Every colleague on your domain can sign in the same way.',
    '',
    '— Prospektor',
  ].join('\n');
  const htmlBody = emailShell(`
    <p style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${BRAND.ink};line-height:1.25;margin:0 0 14px;">Your studio is ready.</p>
    <p style="font-size:14px;color:${BRAND.ink};line-height:1.7;margin:0 0 22px;">
      Sign in at <a href="https://studio.prospektor.ai/?signin=${encodeURIComponent(email)}" style="color:${BRAND.ink};border-bottom:1px solid ${BRAND.accent};text-decoration:none;">studio.prospektor.ai</a> —
      <strong>with Google, using this address</strong> (the one you paid with), <strong>or have the studio email you a sign-in link</strong> from that same page. That&#39;s the whole setup: no token, no wizard.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 26px;"><tr><td style="border-radius:100px;background:${BRAND.coral};">
      <a href="https://studio.prospektor.ai/?signin=${encodeURIComponent(email)}" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:100px;">Sign in to your studio &rarr;</a>
    </td></tr></table>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
      ${[
        'While you were paying, your studio read your site and drafted your brief.',
        'First thing you&#39;ll do is confirm your target sentence — one line, your words.',
        'Three researched prospects are waiting to run your first pitches.',
      ].map(li => `<tr><td style="width:16px;vertical-align:top;padding:5px 0;"><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:${BRAND.accent};margin-bottom:2px;"></span></td><td style="font-size:14px;color:${BRAND.ink};line-height:1.6;padding:3px 0;">${li}</td></tr>`).join('')}
    </table>
    <p style="font-size:13px;color:${BRAND.inkFaint};line-height:1.65;margin:20px 0 0;">
      Paid with your work email? Every colleague on your domain can sign in the same way.
    </p>`,
    'You&#39;re getting this one email because you started a Prospektor Partner Studio. Questions? Just reply — it reaches a human at hello@prospektor.ai.');

  await sendMail({ to: email, subject: 'Your studio is ready — sign in', textBody, htmlBody });
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Webhook not configured' }) };
  }

  const payload = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  const signature = (event.headers && (event.headers['stripe-signature'] || event.headers['Stripe-Signature'])) || '';
  if (!verifyStripeSignature(payload, signature, webhookSecret)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bad signature' }) };
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(payload);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  /*
   * The billing gate (operator ask, 18 Aug 2026: a buyer who charges back or
   * declines to be billed is locked out and pointed at re-subscribing).
   * Three events suspend, and recovery resumes:
   *
   * - invoice.payment_failed — a renewal declined. Suspend on the first
   *   failure, deliberately: the operator's spec is lockout, the locked
   *   screen says exactly how to fix it, and Stripe's own retries clear the
   *   suspension the moment one succeeds (invoice.paid → resume).
   * - charge.dispute.created — a chargeback. No grace at all.
   * - customer.subscription.deleted — cancelled. The workspace waits, locked,
   *   for the re-subscribe checkout (which resumes it via the provision POST).
   * - invoice.paid / subscription becoming active again — resume, so a card
   *   fixed inside Stripe's retry window unlocks without anyone writing in.
   *
   * All of it is fire-toward-the-studio with the same idempotency as
   * provisioning; a non-2xx makes Stripe re-deliver, so a studio hiccup
   * self-heals. NOTE for the operator: these event types must be added to
   * the webhook endpoint's subscription in the Stripe dashboard — a webhook
   * only receives what it is subscribed to.
   */
  const billing = {
    'invoice.payment_failed': { action: 'suspend', reason: 'payment_failed' },
    'charge.dispute.created': { action: 'suspend', reason: 'chargeback' },
    'customer.subscription.deleted': { action: 'suspend', reason: 'subscription_canceled' },
    'invoice.paid': { action: 'resume' },
  }[stripeEvent.type]
    // A subscription clawing its way back to active (past_due → active after
    // a successful retry, or un-cancelled before period end) is a resume too.
    || (stripeEvent.type === 'customer.subscription.updated'
        && stripeEvent.data && stripeEvent.data.object && stripeEvent.data.object.status === 'active'
      ? { action: 'resume' }
      : null);

  if (billing) {
    const object = (stripeEvent.data && stripeEvent.data.object) || {};
    const secret = process.env.STUDIO_PROVISION_SECRET;
    if (!secret) {
      console.error('STUDIO_PROVISION_SECRET is not set — cannot', billing.action);
      return { statusCode: 500, body: JSON.stringify({ error: 'Not configured' }) };
    }
    // Renewal invoices carry the address; subscription and dispute events
    // only carry ids, so resolve the customer with one authenticated read.
    // A dispute names its customer via the charge's expandable field — take
    // what is inline and fall back to the customer lookup.
    const email = String(object.customer_email || '').trim().toLowerCase()
      || await customerEmail(object.customer)
      || String(((object.billing_details || {}).email) || '').trim().toLowerCase();
    if (!email) {
      // Nothing to act on and nothing a retry would find: acknowledge, and
      // leave the trail in the function log for the operator.
      console.error(stripeEvent.type, 'carried no resolvable email — no workspace touched.');
      return { statusCode: 200, body: JSON.stringify({ received: true, acted: false }) };
    }
    let result;
    try {
      result = await callSuspension({ email, action: billing.action, reason: billing.reason, secret });
    } catch (e) {
      console.error('Studio unreachable for', billing.action, 'after retries:', e.message);
      return { statusCode: 502, body: JSON.stringify({ error: 'Studio unreachable' }) };
    }
    if (!result.ok) {
      console.error(billing.action, 'failed:', result.status, JSON.stringify(result.data).slice(0, 300));
      return { statusCode: 502, body: JSON.stringify({ error: 'Suspension call failed' }) };
    }
    console.log(stripeEvent.type, '->', billing.action, 'for', email,
      JSON.stringify(result.data).slice(0, 200));
    return { statusCode: 200, body: JSON.stringify({ received: true, acted: billing.action }) };
  }

  // async_payment_succeeded covers delayed methods: their `completed` event
  // arrives unpaid (skipped below) and this one is the actual payment.
  const relevant = stripeEvent.type === 'checkout.session.completed'
    || stripeEvent.type === 'checkout.session.async_payment_succeeded';
  if (!relevant) {
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  const session = (stripeEvent.data && stripeEvent.data.object) || {};
  if (session.payment_status && session.payment_status !== 'paid') {
    // Pay-first rule: never provision an unpaid checkout.
    console.log('Session', session.id, 'not paid yet (', session.payment_status, ') — waiting.');
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  const email = String(
    (session.customer_details && session.customer_details.email) || session.customer_email || ''
  ).trim().toLowerCase();
  const metadata = session.metadata || {};
  const company = String(metadata.company || '').trim();
  const website = String(metadata.domain || '').trim();
  const goal = String(metadata.goal || '').trim();

  const provisionSecret = process.env.STUDIO_PROVISION_SECRET;
  if (!provisionSecret) {
    // Retryable on purpose: once the operator sets the env var, Stripe's next
    // re-delivery provisions this buyer with no manual step.
    console.error('STUDIO_PROVISION_SECRET is not set — cannot provision', email);
    return { statusCode: 500, body: JSON.stringify({ error: 'Provisioning not configured' }) };
  }
  if (!email) {
    console.error('Session', session.id, 'completed without an email — cannot provision.');
    return { statusCode: 502, body: JSON.stringify({ error: 'No buyer email on session' }) };
  }

  let provision;
  try {
    provision = await callProvision({ email, company, website, goal, secret: provisionSecret });
  } catch (e) {
    console.error('Studio unreachable after retries:', e.message);
    return { statusCode: 502, body: JSON.stringify({ error: 'Studio unreachable' }) };
  }

  if (!provision.ok) {
    console.error('Provision failed:', provision.status, JSON.stringify(provision.data).slice(0, 300));
    return { statusCode: 502, body: JSON.stringify({ error: 'Provision failed' }) };
  }

  const clientId = provision.data && provision.data.client && provision.data.client.id;
  const existing = !!(provision.data && provision.data.existing);
  // existing + resumed is the re-subscribe path working as designed: the
  // buyer's workspace was suspended and this payment just unlocked it. Not a
  // collision, and not a reason to shout at the operator.
  const resumed = !!(provision.data && provision.data.resumed);
  console.log('Provisioned', email, '→', clientId, resumed ? '(resumed)' : existing ? '(existing)' : '(new)');

  // `goal` on the response reports whether a usable sentence reached the brief.
  // undefined means an older studio that does not report it — distinct from
  // false, and not something to warn about.
  const goalRecorded = provision.data && typeof provision.data.goal === 'boolean'
    ? provision.data.goal
    : undefined;
  await sendOperatorNotice({ email, company, website, goal, clientId, existing, resumed, goalRecorded });
  if (!existing) await sendWelcomeEmail(email);

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
