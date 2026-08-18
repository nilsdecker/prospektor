// What company is this buyer, when all they gave us is an email address?
//
// The direct pay path asks for one thing — the address that becomes the
// studio's sign-in — and /api/provision needs company-or-website or it
// returns 400. A work address answers both questions at once: the studio
// researches acme.com from buyer@acme.com. A free-mail address answers
// neither, so that buyer is asked for their website and nothing is sold
// until they give one.
//
// This must be server-side: it decides whether a Stripe session may be
// created at all, and a rule the browser owns is a rule that can be skipped.

// Not exhaustive and does not need to be. A free-mail domain missed here
// becomes a website we cannot research, which the studio's own inference and
// the operator's order notice both catch — where a company domain wrongly
// listed here would pester a real buyer for a website they already told us.
// So this list errs towards short.
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com',
  'outlook.com', 'outlook.de', 'hotmail.com', 'hotmail.co.uk', 'hotmail.de',
  'live.com', 'live.co.uk', 'msn.com',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.de', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com',
  'proton.me', 'protonmail.com', 'pm.me',
  'gmx.de', 'gmx.net', 'gmx.com', 'gmx.at', 'gmx.ch',
  'web.de', 't-online.de', 'freenet.de',
  'mail.com', 'mail.ru', 'yandex.ru',
  'zoho.com', 'fastmail.com', 'hey.com',
  'tutanota.com', 'tuta.com',
  'qq.com', '163.com', '126.com',
  'example.com',
]);

// The company domain behind an address, or '' when the address does not name
// a company (free-mail, or anything that does not parse).
function companyDomainFromEmail(email) {
  const at = String(email || '').lastIndexOf('@');
  if (at < 0) return '';
  const domain = String(email).slice(at + 1).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(domain)) return '';
  return FREE_MAIL.has(domain) ? '' : domain;
}

// Whatever the buyer pasted into a website field, reduced to a bare domain.
// Mirrors cleanDomain() in checkout.js so both entry points normalise alike.
function cleanDomain(raw) {
  let s = String(raw || '').trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
  s = s.split(/[/?#\s]/)[0];
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(s) ? s : '';
}

module.exports = { FREE_MAIL, companyDomainFromEmail, cleanDomain };
