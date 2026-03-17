exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  if (!SENDGRID_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'SendGrid not configured' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { name, email, company, answers } = data;

  // Build formatted HTML email
  const answersHtml = answers.map((item, i) => `
    <tr>
      <td style="padding:12px 16px;background:#f7f5f0;border-bottom:1px solid #edeae3;font-size:12px;color:#8f8f8a;font-family:monospace;width:30px;vertical-align:top;">Q${i+1}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #edeae3;font-size:13px;color:#52524e;vertical-align:top;">${item.q}</td>
    </tr>
    <tr>
      <td style="padding:12px 16px;background:#e6f7f2;border-bottom:1px solid #edeae3;font-size:12px;color:#00956a;font-family:monospace;width:30px;vertical-align:top;">A</td>
      <td style="padding:12px 16px;background:#f0fdf9;border-bottom:1px solid #edeae3;font-size:14px;color:#1a1a18;vertical-align:top;">${item.a.replace(/\n/g, '<br>')}</td>
    </tr>`).join('');

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f7f5f0;font-family:'Plus Jakarta Sans',system-ui,sans-serif;">
  <div style="max-width:680px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #edeae3;">

    <div style="background:#1a1a18;padding:24px 32px;display:flex;align-items:center;">
      <div style="width:28px;height:28px;background:#1a1a18;border:1.5px solid #ffffff40;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;margin-right:10px;">
        <span style="color:white;font-size:14px;">◎</span>
      </div>
      <span style="color:white;font-size:16px;font-weight:700;letter-spacing:-0.02em;">Prospektor</span>
      <span style="margin-left:auto;background:#00b37e20;color:#00b37e;font-size:11px;font-family:monospace;padding:3px 8px;border-radius:4px;border:1px solid #00b37e30;">NEW APPLICATION</span>
    </div>

    <div style="padding:32px;">
      <h1 style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#1a1a18;margin:0 0 6px;">New application from ${name}</h1>
      <p style="font-size:14px;color:#8f8f8a;margin:0 0 24px;">${company} · ${email}</p>

      <div style="background:#f7f5f0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:11px;font-family:monospace;color:#8f8f8a;text-transform:uppercase;letter-spacing:0.06em;">Company</span>
          <span style="font-size:13px;font-weight:700;color:#1a1a18;">${company}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:11px;font-family:monospace;color:#8f8f8a;text-transform:uppercase;letter-spacing:0.06em;">Name</span>
          <span style="font-size:13px;font-weight:700;color:#1a1a18;">${name}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:11px;font-family:monospace;color:#8f8f8a;text-transform:uppercase;letter-spacing:0.06em;">Email</span>
          <span style="font-size:13px;font-weight:700;color:#1a1a18;"><a href="mailto:${email}" style="color:#00b37e;text-decoration:none;">${email}</a></span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="font-size:11px;font-family:monospace;color:#8f8f8a;text-transform:uppercase;letter-spacing:0.06em;">Questions</span>
          <span style="font-size:13px;font-weight:700;color:#1a1a18;">${answers.length} of 9 answered</span>
        </div>
      </div>

      <h2 style="font-size:13px;font-family:monospace;color:#8f8f8a;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 12px;">Application brief</h2>
      <table style="width:100%;border-collapse:collapse;border:1px solid #edeae3;border-radius:8px;overflow:hidden;">
        ${answersHtml}
      </table>

      <div style="margin-top:28px;padding:16px 20px;background:#fff7f5;border:1px solid #fde0d9;border-radius:8px;">
        <p style="font-size:13px;color:#1a1a18;margin:0 0 12px;font-weight:600;">Reply directly to this email to respond to ${name.split(' ')[0]}.</p>
        <a href="mailto:${email}?subject=Re: Your Prospektor application&body=Hi ${name.split(' ')[0]},%0A%0AThanks for applying to work with Prospektor..." style="display:inline-block;background:#e8533a;color:white;font-size:13px;font-weight:700;padding:10px 20px;border-radius:100px;text-decoration:none;">Reply to ${name.split(' ')[0]} →</a>
      </div>
    </div>

    <div style="padding:16px 32px;border-top:1px solid #edeae3;background:#f7f5f0;">
      <p style="font-size:11px;color:#8f8f8a;margin:0;font-family:monospace;">Prospektor · The AI-first GTM agency · prospektor.ai</p>
    </div>
  </div>
</body>
</html>`;

  // Send via SendGrid
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: 'hello@prospektor.ai', name: 'Prospektor' }] }],
      from: { email: 'hello@prospektor.ai', name: 'Prospektor App' },
      reply_to: { email: email, name: name },
      subject: `New application: ${name} — ${company}`,
      content: [{ type: 'text/html', value: htmlBody }],
    }),
  });

  if (response.status === 202) {
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } else {
    const err = await response.text();
    console.error('SendGrid error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Email failed', detail: err }) };
  }
};
