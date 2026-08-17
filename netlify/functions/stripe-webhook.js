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
// The welcome email is a Postmark scaffold, env-gated on POSTMARK_SERVER_TOKEN
// and skipped silently when unset. An email failure never fails the webhook —
// a Stripe retry after a sent email would send it twice.
//
// Secrets (STRIPE_WEBHOOK_SECRET, STUDIO_PROVISION_SECRET, the Postmark
// token) live in this site's server env only, never in browser-delivered code.

const crypto = require('node:crypto');

const PROVISION_URL = 'https://studio.prospektor.ai/api/provision';
const SIGNATURE_TOLERANCE_SECONDS = 300;

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

async function callProvision({ email, company, website, goal, secret }) {
  // `goal` is not in /api/provision's contract yet (requested 16 Aug 2026);
  // the studio ignores unknown fields, so sending it now means the buyer's
  // sentence starts seeding briefs the day the field lands, no change here.
  const body = JSON.stringify({ email, company, website, goal: goal || undefined });
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

// The seller's side of the sale: one notice per successful provision. The
// existing:true case gets a louder subject — the buyer paid for a new studio
// but their address already owned one, so a human has to look (the studio
// has no pre-checkout ownership check yet; request filed 17 Aug 2026).
async function sendOperatorNotice({ email, company, website, goal, clientId, existing }) {
  const operator = process.env.OPERATOR_EMAIL || 'hello@prospektor.ai';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const subject = existing
    ? `⚠️ Order needs attention: ${email} paid but already had a studio`
    : `New order: ${email}${company ? ' — ' + company : website ? ' — ' + website : ''}`;
  const lines = [
    ['Buyer email', email],
    ['Company', company],
    ['Domain', website],
    ['Their target', goal],
    ['Workspace', clientId ? `${clientId} (${existing ? 'EXISTING — no new workspace was created' : 'newly created'})` : ''],
  ];
  const textBody = [
    existing
      ? 'A buyer completed checkout, but their email already had a workspace — the studio returned the existing one and did NOT create a workspace for what they just bought. Reach out and sort it by hand.'
      : 'A buyer completed checkout and their studio was provisioned.',
    '',
    ...lines.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
  ].join('\n');
  const htmlBody = `
<body style="margin:0;padding:24px;background:#f7f5f0;font-family:system-ui,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #edeae3;border-radius:12px;padding:24px;">
    <p style="font-size:16px;font-weight:700;color:#1a1a18;margin:0 0 16px;">${existing ? '⚠️ Order needs attention' : 'New order'}</p>
    ${existing ? '<p style="font-size:13px;color:#1a1a18;line-height:1.6;margin:0 0 16px;">The buyer paid, but this email already had a workspace — the studio returned the existing one and <strong>did not create a workspace for what they just bought</strong>. Reach out and sort it by hand.</p>' : ''}
    <table style="width:100%;border-collapse:collapse;">
      ${lines.filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:8px 12px;font-family:monospace;font-size:11px;color:#8f8f8a;text-transform:uppercase;vertical-align:top;">${k}</td><td style="padding:8px 12px;font-size:14px;color:#1a1a18;">${esc(v)}</td></tr>`).join('')}
    </table>
    <p style="font-size:12px;color:#8f8f8a;margin:16px 0 0;">Sent by the Stripe webhook on prospektor.ai. Reply goes to the buyer.</p>
  </div>
</body>`;
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
    'Sign in here: https://studio.prospektor.ai',
    'Sign in with Google, using this address — the one you paid with. That is the whole setup.',
    '',
    'While you were paying, your studio read your site and drafted your brief.',
    'First thing you’ll do is confirm your target sentence — one line, your words.',
    'Then three researched prospects are waiting to run your first pitches.',
    '',
    'Paid with your work email? Every colleague on your domain can sign in the same way.',
    '',
    '— Prospektor',
  ].join('\n');
  const htmlBody = `
<body style="margin:0;padding:24px;background:#f7f5f0;font-family:system-ui,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #edeae3;border-radius:12px;padding:28px;">
    <p style="font-size:17px;font-weight:700;color:#1a1a18;margin:0 0 14px;">Your Prospektor Partner Studio is ready.</p>
    <p style="font-size:14px;color:#1a1a18;line-height:1.65;margin:0 0 18px;">
      Sign in at <a href="https://studio.prospektor.ai" style="color:#1a1a18;">studio.prospektor.ai</a> —
      <strong>with Google, using this address</strong> (the one you paid with). That&#39;s the whole setup.
    </p>
    <ul style="font-size:14px;color:#1a1a18;line-height:1.75;margin:0 0 18px;padding-left:20px;">
      <li>While you were paying, your studio read your site and drafted your brief.</li>
      <li>First thing you&#39;ll do is confirm your target sentence — one line, your words.</li>
      <li>Three researched prospects are waiting to run your first pitches.</li>
    </ul>
    <p style="font-size:13px;color:#8f8f8a;line-height:1.65;margin:0;">
      Paid with your work email? Every colleague on your domain can sign in the same way.
    </p>
  </div>
</body>`;

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
  console.log('Provisioned', email, '→', clientId, existing ? '(existing)' : '(new)');

  await sendOperatorNotice({ email, company, website, goal, clientId, existing });
  if (!existing) await sendWelcomeEmail(email);

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
