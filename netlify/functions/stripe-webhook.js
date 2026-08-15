// Stripe webhook: on payment success, provision the buyer's studio workspace
// and send the welcome email. Server-side only — STUDIO_PROVISION_SECRET never
// reaches the browser.
//
// The provision endpoint is idempotent by design: an existing workspace comes
// back as 200 {"existing":true} and counts as success, so this handler needs
// no dedupe bookkeeping. On transient failure we return 500 and let Stripe's
// own webhook retries do the retrying.
//
// Env (server-side only):
//   STRIPE_WEBHOOK_SECRET    — whsec_... signing secret for this endpoint
//   STUDIO_PROVISION_SECRET  — same value as the studio's PROVISION_SECRET
//   SENDGRID_API_KEY         — already used by send-brief.js

const crypto = require('crypto');

const STUDIO_URL = 'https://studio.prospektor.ai';
const SIGNATURE_TOLERANCE_S = 300;

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set');
    return { statusCode: 500, body: 'Webhook not configured' };
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : (event.body || '');

  const sigHeader = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  if (!verifySignature(rawBody, sigHeader, webhookSecret)) {
    return { statusCode: 400, body: 'Invalid signature' };
  }

  let stripeEvent;
  try { stripeEvent = JSON.parse(rawBody); } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // Provision on payment success, not checkout start. completed fires for
  // sync payments (cards); async methods pay later and arrive as
  // async_payment_succeeded — completed then carries payment_status 'unpaid'.
  const session = stripeEvent.data && stripeEvent.data.object;
  const isPaid =
    (stripeEvent.type === 'checkout.session.completed' && session && session.payment_status === 'paid') ||
    (stripeEvent.type === 'checkout.session.async_payment_succeeded');

  if (!isPaid) {
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  const email = (session.customer_details && session.customer_details.email) || session.customer_email;
  const company = (session.metadata && session.metadata.company) || '';
  const website = (session.metadata && session.metadata.website) || '';

  if (!email) {
    console.error('Paid session without an email address:', session.id);
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  const provision = await provisionWorkspace({ email, company, website });

  if (provision.status === 400) {
    // Broken email or no company/website — Stripe retrying won't change it.
    console.error('Provision rejected the payload:', session.id, provision.body);
    return { statusCode: 200, body: JSON.stringify({ received: true, provisioned: false }) };
  }
  if (provision.status !== 200 && provision.status !== 201) {
    console.error('Provision failed:', provision.status, provision.body);
    return { statusCode: 500, body: 'Provision failed, retry' };
  }

  const emailed = await sendWelcomeEmail({ email, company, website });
  if (!emailed) {
    // Workspace exists; retrying re-hits the idempotent provision and
    // re-attempts the email until it goes out.
    return { statusCode: 500, body: 'Welcome email failed, retry' };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true, provisioned: true }) };
};

function verifySignature(payload, header, secret) {
  if (!header) return false;

  const parts = {};
  for (const item of header.split(',')) {
    const idx = item.indexOf('=');
    if (idx < 0) continue;
    const key = item.slice(0, idx).trim();
    const value = item.slice(idx + 1).trim();
    (parts[key] = parts[key] || []).push(value);
  }

  const timestamp = parts.t && parts.t[0];
  const signatures = parts.v1 || [];
  if (!timestamp || signatures.length === 0) return false;

  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > SIGNATURE_TOLERANCE_S) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');

  return signatures.some(sig => {
    const sigBuf = Buffer.from(sig, 'utf8');
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
}

async function provisionWorkspace({ email, company, website }) {
  const secret = process.env.STUDIO_PROVISION_SECRET;
  if (!secret) {
    console.error('STUDIO_PROVISION_SECRET is not set');
    return { status: 0, body: 'no secret configured on website side' };
  }

  // Idempotent endpoint — a plain retry on network failure is fine and safe.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${STUDIO_URL}/api/provision`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-provision-secret': secret,
        },
        body: JSON.stringify({ email, company, website }),
      });
      return { status: res.status, body: await res.text() };
    } catch (err) {
      if (attempt === 1) return { status: 0, body: String(err) };
    }
  }
}

async function sendWelcomeEmail({ email, company, website }) {
  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  if (!SENDGRID_API_KEY) {
    console.error('SENDGRID_API_KEY is not set — welcome email not sent');
    return false;
  }

  const who = escapeHtml(company || website || 'your company');

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f7f5f0;font-family:'Plus Jakarta Sans',system-ui,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #edeae3;">

    <div style="background:#1a1a18;padding:24px 32px;">
      <span style="color:white;font-size:16px;font-weight:700;letter-spacing:-0.02em;">◎ Prospektor</span>
      <span style="float:right;background:#00b37e20;color:#00b37e;font-size:11px;font-family:monospace;padding:3px 8px;border-radius:4px;border:1px solid #00b37e30;">STUDIO READY</span>
    </div>

    <div style="padding:32px;">
      <h1 style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#1a1a18;margin:0 0 12px;">Your studio is ready.</h1>
      <p style="font-size:14px;color:#52524e;line-height:1.7;margin:0 0 20px;">
        While you were checking out, your studio read ${who}'s site and drafted
        your brief. It's waiting for you now.
      </p>

      <a href="https://studio.prospektor.ai" style="display:inline-block;background:#e8533a;color:white;font-size:14px;font-weight:700;padding:12px 26px;border-radius:100px;text-decoration:none;margin-bottom:24px;">Open your studio →</a>

      <div style="background:#f7f5f0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
        <p style="font-size:13px;color:#1a1a18;font-weight:700;margin:0 0 6px;">How to sign in</p>
        <p style="font-size:13px;color:#52524e;line-height:1.6;margin:0;">
          <strong>Sign in with Google, using this address</strong>
          (${escapeHtml(email)}). Google is currently the only sign-in method —
          if this address can't sign in with Google, reply to this email and
          we'll get you in another way.
        </p>
      </div>

      <p style="font-size:13px;color:#52524e;line-height:1.7;margin:0;">
        What's waiting on first sign-in: your brief is drafted — you confirm one
        sentence (what to hunt for) — and then you get three suggested companies
        to run your first pitches on.
      </p>
    </div>

    <div style="padding:16px 32px;border-top:1px solid #edeae3;background:#f7f5f0;">
      <p style="font-size:11px;color:#8f8f8a;margin:0;font-family:monospace;">Prospektor · The AI-first GTM agency · prospektor.ai</p>
    </div>
  </div>
</body>
</html>`;

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: 'hello@prospektor.ai', name: 'Prospektor' },
        reply_to: { email: 'hello@prospektor.ai', name: 'Prospektor' },
        subject: 'Your studio is ready — sign in with Google',
        content: [{ type: 'text/html', value: htmlBody }],
      }),
    });
    if (response.status !== 202) {
      console.error('SendGrid error:', response.status, await response.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('SendGrid request failed:', err);
    return false;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
