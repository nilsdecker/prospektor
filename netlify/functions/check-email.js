// Pre-checkout ownership check: does this email already own a studio?
//
// One email, one workspace (operator decision, 17 Aug 2026) — so a buyer
// whose address already has a studio must be stopped BEFORE payment, not
// discover it after. This proxies the studio's /api/provision-check
// (contract proposed in HANDOVER-website-funnel.md) because the shared
// secret lives server-side only.
//
// Fail-open by design: the endpoint does not exist studio-side yet, and a
// missing endpoint, missing secret, or unreachable studio must never block
// a sale. Anything but a clean "taken" answer returns taken:false with
// checked:false, and checkout proceeds exactly as today. The studio
// shipping the endpoint switches the block on with no website change.

const CHECK_URL = 'https://studio.prospektor.ai/api/provision-check';

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  const email = String(data.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'That does not look like an email address.' }) };
  }

  const open = extra => ({ statusCode: 200, body: JSON.stringify(Object.assign({ taken: false, checked: false }, extra)) });

  const secret = process.env.STUDIO_PROVISION_SECRET;
  if (!secret) return open();

  try {
    const response = await fetch(CHECK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-provision-secret': secret,
      },
      body: JSON.stringify({ email }),
    });
    if (!response.ok) return open(); // 404 = endpoint not built yet; anything else, fail open too
    const result = await response.json().catch(() => null);
    if (!result || typeof result.taken !== 'boolean') return open();
    return { statusCode: 200, body: JSON.stringify({ taken: result.taken, checked: true }) };
  } catch (e) {
    return open();
  }
};
