// Search Console, read-only (#446).
//
// The brief this is built from (`SEO-AGENT-SETUP.md` §2.5) writes it in Python
// with the `cryptography` package. It is Node here, and that is not a stylistic
// preference: this repo has no Python toolchain, and **Node signs RS256 in the
// standard library**, so the whole "fiddly part" of the brief — the JWT
// assertion a service account exchanges for an access token — is four lines
// with no dependency at all. A requirements.txt for one signature would be a
// second toolchain for every future contributor to install.
//
//   node tools/gsc.js check                 # walk the setup and NAME the broken step
//   node tools/gsc.js queries [--days 28]   # what we are found for
//   node tools/gsc.js pages                 # which URLs earn the impressions
//   node tools/gsc.js page /resources/x/    # one page's queries
//   node tools/gsc.js opportunities         # >=50 impressions, position > 10
//   node tools/gsc.js cannibals             # queries where two of our URLs rank
//   node tools/gsc.js report                # the markdown snapshot CI commits
//   ... --json                              # any of them, as data
//
// ── Where the key lives, and where it must not ────────────────────────────
//
// **GitHub Actions secrets, and nowhere else.** A scheduled workflow runs
// `report` and commits `docs/seo/gsc-latest.md` into the repo; every session
// then reads committed markdown and never touches the credential:
//
//   GitHub secret ──> Actions workflow ──> docs/seo/gsc-latest.md ──> sessions
//      (encrypted)        (daily)             (committed)           (no key)
//
// Not Netlify: no build step reads it, so it would sit in the build
// environment of a static site doing nothing but waiting to leak. And not a
// Claude Code environment variable — those have no secrets store, and anyone
// who can use the environment can read the value. #293 records the previous
// SEO thread reporting it had put the key in exactly that second place.
//
// The scope is **read-only** (`webmasters.readonly`), which is the brief's
// recommendation and worth restating: full access buys sitemap submission,
// which does approximately nothing (Google calls submission "merely a hint"
// and retired the ping endpoint), and the URL Inspection API, which is
// genuinely useful but not worth making a leaked key able to write.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
// A Domain property (`sc-domain:`), not a URL-prefix one. RUNBOOK-search-console.md
// records why: it covers www, studio. and http:// in one property, needs no
// deploy, and survives moving off Netlify. A URL-prefix property on the www
// host under-reports badly on a site that 301s to the apex.
const PROPERTY = process.env.GSC_PROPERTY || 'sc-domain:prospektor.ai';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API = 'https://searchconsole.googleapis.com/webmasters/v3';

// Search Console finalises a day's data about two days late, and a window that
// ends today therefore always ends in a partial day that reads as a cliff.
const LAG_DAYS = 3;
const day = d => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);

// ── Credentials ───────────────────────────────────────────────────────────
// The whole JSON key as one env var, which is what a GitHub secret holds. A
// path is accepted too, for running it by hand without pasting a key into a
// shell history.
function credentials() {
  const raw = process.env.GSC_SERVICE_ACCOUNT_KEY;
  const file = process.env.GSC_SERVICE_ACCOUNT_FILE;
  let text = raw;
  if (!text && file) text = fs.readFileSync(file, 'utf8');
  if (!text) {
    throw new Error('no credential: set GSC_SERVICE_ACCOUNT_KEY (the JSON key, whole) or GSC_SERVICE_ACCOUNT_FILE');
  }
  let creds;
  try { creds = JSON.parse(text); }
  catch (e) { throw new Error(`credential is not JSON (${e.message}). Paste the key file whole, braces included.`); }
  for (const k of ['client_email', 'private_key']) {
    if (!creds[k]) throw new Error(`credential has no ${k} — is this a service-account key rather than an OAuth client?`);
  }
  return creds;
}

// ── The JWT the brief calls the only fiddly part ──────────────────────────
// A service account cannot hold a password, so it signs an assertion about
// itself and trades it for an access token. `base64url` is the encoding the
// spec wants and Node writes it directly, padding stripped, no helper needed.
async function token(creds) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = v => Buffer.from(v).toString('base64url');
  const signingInput = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' +
    b64(JSON.stringify({
      iss: creds.client_email, scope: SCOPE,
      aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    }));
  const assertion = signingInput + '.' +
    crypto.sign('RSA-SHA256', Buffer.from(signingInput), creds.private_key).toString('base64url');

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion,
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Google's own error text is the useful half here — `invalid_grant`
    // usually means the clock or the key, not the account.
    throw new Error(`token exchange failed (HTTP ${r.status}): ${body.error || ''} ${body.error_description || ''}`.trim());
  }
  return body.access_token;
}

// ── The one API call everything else is a shape of ────────────────────────
async function query(access, { dimensions = [], days = 28, rowLimit = 1000, filters = [] } = {}) {
  const r = await fetch(`${API}/sites/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      startDate: day(days + LAG_DAYS), endDate: day(LAG_DAYS),
      dimensions, rowLimit,
      ...(filters.length ? { dimensionFilterGroups: [{ filters }] } : {}),
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = body.error?.message || `HTTP ${r.status}`;
    if (r.status === 403) {
      throw new Error(`${msg}\n  The service account is not a user on ${PROPERTY}. Add ${'<its email>'} in Search Console → Settings → Users and permissions.`);
    }
    throw new Error(msg);
  }
  return body.rows || [];
}

// ── Reports ───────────────────────────────────────────────────────────────
const round = (n, d = 1) => Number(n.toFixed(d));
const row = r => ({
  key: r.keys.join(' · '), keys: r.keys,
  clicks: r.clicks, impressions: r.impressions,
  ctr: round(r.ctr * 100, 2), position: round(r.position),
});

// ≥50 impressions and ranking past the first page. The brief calls this "the
// list to write against", and the reasoning is that these are queries Google
// ALREADY believes the site is relevant to — an existing impression is
// evidence, where a keyword tool's number is a guess about a stranger.
const OPPORTUNITY_MIN_IMPRESSIONS = 50;
const FIRST_PAGE = 10;

async function opportunities(access, days) {
  const rows = (await query(access, { dimensions: ['query'], days })).map(row);
  return rows
    .filter(r => r.impressions >= OPPORTUNITY_MIN_IMPRESSIONS && r.position > FIRST_PAGE)
    .sort((a, b) => b.impressions - a.impressions);
}

// Queries where more than one of our URLs ranks. The brief says to check this
// before every publish, and it is the cheapest cannibalisation signal there
// is — two pages splitting the authority for one term, each keeping the other
// off the first page.
async function cannibals(access, days) {
  const rows = await query(access, { dimensions: ['query', 'page'], days });
  const byQuery = new Map();
  for (const r of rows) {
    const [q, page] = r.keys;
    if (!byQuery.has(q)) byQuery.set(q, []);
    byQuery.get(q).push({ page, clicks: r.clicks, impressions: r.impressions, position: round(r.position) });
  }
  return [...byQuery.entries()]
    .filter(([, pages]) => pages.length > 1)
    .map(([q, pages]) => ({
      query: q,
      impressions: pages.reduce((a, p) => a + p.impressions, 0),
      pages: pages.sort((a, b) => a.position - b.position),
    }))
    .sort((a, b) => b.impressions - a.impressions);
}

// `check` walks the setup in dependency order and names the step that broke.
// The brief's argument for it is that setup errors are otherwise invisible:
// every failure mode here — no key, malformed key, no network, clock skew,
// the account not added to the property — surfaces as the same unhelpful
// empty result if you only ever call the reporting commands.
async function check() {
  const steps = [];
  const step = (name, ok, detail) => { steps.push({ name, ok, detail }); return ok; };
  let creds, access;

  try { creds = credentials(); step('credential present and parses', true, creds.client_email); }
  catch (e) { step('credential present and parses', false, e.message); return steps; }

  try {
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'HEAD' });
    step('network reaches oauth2.googleapis.com', true, `HTTP ${r.status}`);
  } catch (e) { step('network reaches oauth2.googleapis.com', false, e.message); return steps; }

  try { access = await token(creds); step('JWT exchanges for an access token', true, 'signed RS256, 1h'); }
  catch (e) { step('JWT exchanges for an access token', false, e.message); return steps; }

  try {
    const r = await fetch(`${API}/sites`, { headers: { authorization: `Bearer ${access}` } });
    const body = await r.json().catch(() => ({}));
    const sites = (body.siteEntry || []).map(s => s.siteUrl);
    if (!r.ok) step('the API answers', false, body.error?.message || `HTTP ${r.status}`);
    else if (!sites.includes(PROPERTY)) {
      step(`${PROPERTY} is readable`, false,
        `the account sees ${sites.length ? sites.join(', ') : 'no properties at all'}. Add ${creds.client_email} as a user on the property.`);
    } else step(`${PROPERTY} is readable`, true, `${sites.length} propert${sites.length === 1 ? 'y' : 'ies'} visible`);
  } catch (e) { step(`${PROPERTY} is readable`, false, e.message); return steps; }

  try {
    const rows = await query(access, { dimensions: ['query'], days: 28, rowLimit: 1 });
    step('search analytics returns data', true,
      rows.length ? `${rows.length} row back` : 'connected, but ZERO rows — expected until the property has collected data');
  } catch (e) { step('search analytics returns data', false, e.message); }
  return steps;
}

// The markdown snapshot the workflow commits. This file is the ONLY thing a
// session reads — hence the header saying when it was generated and over what
// window, because a stale snapshot read as fresh is how a content plan gets
// written against last month's data.
async function report(access, days) {
  const [queries, pages, opps, cann] = await Promise.all([
    query(access, { dimensions: ['query'], days }).then(r => r.map(row)),
    query(access, { dimensions: ['page'], days }).then(r => r.map(row)),
    opportunities(access, days),
    cannibals(access, days),
  ]);
  const totals = queries.reduce((a, r) => ({
    clicks: a.clicks + r.clicks, impressions: a.impressions + r.impressions,
  }), { clicks: 0, impressions: 0 });

  const table = (rows, head, cells) => rows.length
    ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`,
       ...rows.map(r => `| ${cells(r).join(' | ')} |`)].join('\n')
    : '_None._';

  return `# Search Console — prospektor.ai

**Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC** by
\`tools/gsc.js report\`, over **${day(days + LAG_DAYS)} → ${day(LAG_DAYS)}** (${days} days,
ending ${LAG_DAYS} days back because Search Console finalises a day late).

Property \`${PROPERTY}\`. Written by CI and committed — do not edit by hand, the
next run overwrites it. Nothing that reads this file holds the credential.

**${totals.clicks} clicks · ${totals.impressions} impressions** across
${queries.length} queries and ${pages.length} pages.

${totals.impressions === 0 ? `> **No data yet.** That is the expected answer until the property has been
> collecting for two to three weeks. It is not a broken pipeline —
> \`node tools/gsc.js check\` is what tells you whether it is.\n` : ''}
## Opportunities — ≥${OPPORTUNITY_MIN_IMPRESSIONS} impressions, ranking past page one

The list to write against. Google already believes the site is relevant to
these; an existing impression is evidence where a keyword tool's number is a
guess. A page that answers one of these properly moves from position 14 to
position 8, and position 8 is where clicks start.

${table(opps.slice(0, 40), ['Query', 'Impressions', 'Clicks', 'Position'],
  r => [r.key, r.impressions, r.clicks, r.position])}

## Cannibalisation — one query, more than one of our URLs

Check this before every publish. Two pages splitting one term keep each other
off the first page, and the fix is consolidation, not another page.

${cann.length ? cann.slice(0, 20).map(c =>
  `- **${c.query}** — ${c.impressions} impressions across ${c.pages.length} URLs\n` +
  c.pages.map(p => `  - \`${p.page.replace('https://prospektor.ai', '')}\` — position ${p.position}, ${p.impressions} impressions`).join('\n')
).join('\n') : '_None._'}

## Top queries

${table(queries.slice(0, 40), ['Query', 'Impressions', 'Clicks', 'CTR %', 'Position'],
  r => [r.key, r.impressions, r.clicks, r.ctr, r.position])}

## Top pages

${table(pages.slice(0, 40), ['Page', 'Impressions', 'Clicks', 'CTR %', 'Position'],
  r => [r.key.replace('https://prospektor.ai', '') || '/', r.impressions, r.clicks, r.ctr, r.position])}
`;
}

module.exports = { credentials, token, query, opportunities, cannibals, check, report, PROPERTY, LAG_DAYS };

if (require.main !== module) return;

(async () => {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || 'check';
  const json = argv.includes('--json');
  const days = +(argv[argv.indexOf('--days') + 1] || 28) || 28;
  const out = v => console.log(json ? JSON.stringify(v, null, 2) : v);

  if (cmd === 'check') {
    const steps = await check();
    if (json) return out(steps);
    for (const s of steps) console.log(`  ${s.ok ? '✅' : '❌'} ${s.name}${s.detail ? ` — ${s.detail}` : ''}`);
    const bad = steps.find(s => !s.ok);
    console.log(bad ? `\nBroken at: ${bad.name}` : '\nAll steps pass.');
    process.exitCode = bad ? 1 : 0;
    return;
  }

  let access;
  try { access = await token(credentials()); }
  catch (e) { console.error(`${e.message}\n\nRun \`node tools/gsc.js check\` — it names the failing step.`); process.exitCode = 1; return; }

  const table = rows => {
    if (!rows.length) return console.log('  (no rows — expected until the property has collected data)');
    console.log('  ' + 'KEY'.padEnd(58), 'IMPR'.padStart(6), 'CLICKS'.padStart(7), 'POS'.padStart(6));
    for (const r of rows) {
      console.log('  ' + r.key.slice(0, 58).padEnd(58), String(r.impressions).padStart(6),
        String(r.clicks).padStart(7), String(r.position).padStart(6));
    }
  };

  switch (cmd) {
    case 'queries': {
      const rows = (await query(access, { dimensions: ['query'], days })).map(row);
      return json ? out(rows) : table(rows.slice(0, 50));
    }
    case 'pages': {
      const rows = (await query(access, { dimensions: ['page'], days })).map(row);
      return json ? out(rows) : table(rows.slice(0, 50));
    }
    case 'page': {
      const p = argv[1];
      if (!p || p.startsWith('--')) { console.error('usage: node tools/gsc.js page /resources/slug/'); process.exitCode = 1; return; }
      const url = p.startsWith('http') ? p : `https://prospektor.ai${p}`;
      const rows = (await query(access, {
        dimensions: ['query'], days,
        filters: [{ dimension: 'page', operator: 'equals', expression: url }],
      })).map(row);
      return json ? out(rows) : table(rows.slice(0, 50));
    }
    case 'opportunities': {
      const rows = await opportunities(access, days);
      return json ? out(rows) : table(rows);
    }
    case 'cannibals': {
      const rows = await cannibals(access, days);
      if (json) return out(rows);
      if (!rows.length) return console.log('  (none — no query has two of our URLs ranking)');
      for (const c of rows) {
        console.log(`\n  ${c.query} — ${c.impressions} impressions`);
        for (const p of c.pages) console.log(`    ${String(p.position).padStart(5)}  ${p.page}`);
      }
      return;
    }
    case 'report': {
      const md = await report(access, days);
      const dest = path.join(ROOT, 'docs', 'seo', 'gsc-latest.md');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, md);
      console.log(`wrote ${path.relative(ROOT, dest)} (${md.length} bytes)`);
      return;
    }
    default:
      console.error(`unknown command: ${cmd}\n  check | queries | pages | page <path> | opportunities | cannibals | report`);
      process.exitCode = 1;
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
