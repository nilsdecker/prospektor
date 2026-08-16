// Founding-spot reservations from /checkout/ while Stripe checkout isn't
// open yet. Sends one notification email to the operator; nothing is stored.
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const email = String(data.email || '').trim().slice(0, 200);
  const domain = String(data.domain || '').trim().slice(0, 200);
  const company = String(data.company || '').trim().slice(0, 200);
  const goal = String(data.goal || '').trim().slice(0, 2000);

  // Honeypot: bots fill every field; humans never see this one.
  if (data.hp) {
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'That does not look like an email address.' }) };
  }

  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  if (!SENDGRID_API_KEY) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Not configured' }) };
  }

  const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const line = (label, value) => value
    ? `<tr><td style="padding:8px 12px;font-family:monospace;font-size:11px;color:#8f8f8a;text-transform:uppercase;vertical-align:top;">${label}</td><td style="padding:8px 12px;font-size:14px;color:#1a1a18;">${esc(value)}</td></tr>`
    : '';

  const htmlBody = `
<body style="margin:0;padding:24px;background:#f7f5f0;font-family:system-ui,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #edeae3;border-radius:12px;padding:24px;">
    <p style="font-size:16px;font-weight:700;color:#1a1a18;margin:0 0 16px;">Founding spot requested</p>
    <table style="width:100%;border-collapse:collapse;">
      ${line('Email', email)}
      ${line('Domain', domain)}
      ${line('Company', company)}
      ${line('Their target', goal)}
    </table>
    <p style="font-size:12px;color:#8f8f8a;margin:16px 0 0;">Sent from the /checkout/ payment step, before Stripe checkout opened. Reply goes to the buyer.</p>
  </div>
</body>`;

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: 'hello@prospektor.ai', name: 'Prospektor' }] }],
      from: { email: 'hello@prospektor.ai', name: 'Prospektor Checkout' },
      reply_to: { email: email },
      subject: `Founding spot: ${email}${company ? ' — ' + company : domain ? ' — ' + domain : ''}`,
      content: [{ type: 'text/html', value: htmlBody }],
    }),
  });

  if (response.status === 202) {
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  }
  console.error('SendGrid error:', response.status, await response.text());
  return { statusCode: 502, body: JSON.stringify({ error: 'Email failed' }) };
};
