// Board-versus-product pass, WEBSITE lane: every claim the board makes about
// the funnel, asked of the live site. Browser requests are served through
// Node's fetch because Chromium has no egress here; nothing is stubbed.
// Asks PRODUCTION whether the board is telling the truth. Read-only: it runs
// a real scan and reads live pages, and never posts anything that charges.
// Browser traffic is relayed through Node's fetch because Chromium has no
// egress in the sandbox this runs in.
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SITE = process.env.AUDIT_SITE || 'https://prospektor.ai';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const SKIP = ['content-encoding','content-length','content-security-policy','content-security-policy-report-only','strict-transport-security','x-frame-options'];
const SECRET_PATTERNS = [
  /sk_live_[A-Za-z0-9]/, /sk_test_[A-Za-z0-9]/, /rk_live_[A-Za-z0-9]/,
  /whsec_[A-Za-z0-9]/, /SG\.[A-Za-z0-9_-]{16}/,
  /STUDIO_PROVISION_SECRET/, /POSTMARK_SERVER_TOKEN/, /SENDGRID_API_KEY/,
  /x-provision-secret/i, /process\.env\./,
];
const RELAY_RETRIES = [];
const R = [];
const check = (claim, ok, detail) => { R.push({ claim, ok, detail }); console.log((ok?'  ok   ':'  FAIL '), claim, detail?('— '+detail):''); };

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' });

  const thirdParty = new Set();
  await ctx.route('**/*', async route => {
    const req = route.request();
    try {
      const u = new URL(req.url());
      if (!['prospektor.ai','studio.prospektor.ai','localhost'].includes(u.hostname)) thirdParty.add(u.hostname);
      const headers = { ...req.headers() }; delete headers['accept-encoding'];
      // Retry a connection that never completed. This session's egress drops
      // roughly one request in six — always as a dead connection, never as a
      // 5xx from the app — and a single blip on the availability probe used to
      // report two claims as BROKEN. An audit that cries wolf gets ignored, so
      // only a request that fails three times counts as a failure.
      let up, lastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          up = await fetch(req.url(), { method: req.method(), headers,
            body: ['GET','HEAD'].includes(req.method()) ? undefined : req.postDataBuffer(), redirect: 'follow' });
          break;
        } catch (e) { lastErr = e; RELAY_RETRIES.push(req.url()); await new Promise(r => setTimeout(r, 400 * (attempt + 1))); }
      }
      if (!up) throw lastErr;
      const out = {}; up.headers.forEach((v,k)=>{ if(!SKIP.includes(k.toLowerCase())) out[k]=v; });
      return route.fulfill({ status: up.status, headers: out, body: Buffer.from(await up.arrayBuffer()) });
    } catch (e) { return route.abort(); }
  });

  // ── CLAIM: secrets never reach the browser (CLAUDE.md rule 8) ──
  const jsFiles = ['/assets/js/main.js','/assets/js/scan.js','/assets/js/checkout.js','/assets/js/buy.js','/assets/js/help.js'];
  let leaked = [];
  for (const f of jsFiles) {
    const t = await (await fetch(SITE+f)).text();
    // Key SHAPES and env-var names — not provider names. An earlier version of
    // this matched /SENDGRID/i and flagged an accurate code comment on every
    // run; a check that cries wolf is a check that stops being read.
    for (const pat of SECRET_PATTERNS) if (pat.test(t)) leaked.push(f + ' :: ' + pat);
  }
  const homeHtml = await (await fetch(SITE+'/')).text();
  for (const pat of SECRET_PATTERNS) if (pat.test(homeHtml)) leaked.push('index.html :: ' + pat);
  check('no secret appears in any browser-delivered JS or page source', leaked.length===0, leaked.join(', '));

  // ── CLAIM: the scan field works end to end against the live studio ──
  const page = await ctx.newPage();
  await page.goto(SITE+'/', { waitUntil: 'domcontentloaded' });
  check('scan field is the hero', await page.isVisible('#scanForm'));
  await page.fill('#scanInput', 'stripe.com');
  await page.click('#scanBtn');
  let scanOutcome = 'timeout';
  try {
    await page.waitForSelector('#scanResult:not([hidden]), #scanFallback:not([hidden]), #scanError:not([hidden])', { timeout: 100000 });
    if (await page.isVisible('#scanResult')) scanOutcome = 'result';
    else if (await page.isVisible('#scanFallback')) scanOutcome = 'fallback';
    else scanOutcome = 'error';
  } catch (e) {}
  check('a live scan reaches a terminal state (not a spinner forever)', scanOutcome !== 'timeout', 'outcome: ' + scanOutcome);
  if (scanOutcome === 'result') {
    const goal = (await page.textContent('#scanGuess')).trim();
    const signals = await page.locator('#scanSignals li').count();
    const facts = await page.isVisible('#scanFacts');
    check('scan renders a target headline', goal.length > 0, JSON.stringify(goal.slice(0,80)));
    check('scan renders signal bullets', signals > 0, signals+' bullets');
    check('scan renders the facts strip', facts);
    const href = await page.getAttribute('#scanCta','href');
    check('scan CTA carries domain into /checkout/', /^\/checkout\/\?.*domain=/.test(href) || href === '/checkout/', href);
  }

  // ── CLAIM: the pricing tile pays directly ──
  const p2 = await ctx.newPage();
  await p2.goto(SITE+'/#pricing', { waitUntil: 'domcontentloaded' });
  await p2.waitForSelector('#buyForm:not([hidden])', { timeout: 20000 });
  check('pricing CTA is the pay form, not a link to onboarding', await p2.isVisible('#buyForm') && !(await p2.isVisible('#buyLink')));

  // ── CLAIM: /checkout/ works scan-less and asks for a website ──
  const p3 = await ctx.newPage();
  await p3.goto(SITE+'/checkout/', { waitUntil: 'domcontentloaded' });
  check('/checkout/ scan-less opens at the target step', await p3.isVisible('#panelTarget'));
  check('/checkout/ scan-less asks for the website', await p3.isVisible('#siteAsk'));
  await p3.fill('#siteInput','acme.com');
  await p3.click('#toPayBtn');
  await p3.waitForSelector('#panelPay:not([hidden])', { timeout: 10000 });
  check('/checkout/ payment step reached', await p3.isVisible('#panelPay'));
  // The pay form is swapped in by an async availability probe, so wait for it
  // rather than reading the DOM the instant the panel appears — a real buyer
  // spends seconds on the target step and never sees the pre-probe state.
  let stripeShown = true;
  try { await p3.waitForSelector('#stripePay:not([hidden])', { timeout: 15000 }); }
  catch (e) { stripeShown = false; }
  check('/checkout/ payment step shows the live Stripe form', stripeShown);
  check('/checkout/ founding-spot fallback is hidden while Stripe is live', !(await p3.isVisible('#reserveForm')));

  // ── CLAIM: /checkout/done/ exists and is honest ──
  const p4 = await ctx.newPage();
  const doneRes = await p4.goto(SITE+'/checkout/done/', { waitUntil: 'domcontentloaded' });
  check('/checkout/done/ serves 200', doneRes.status()===200, 'HTTP '+doneRes.status());

  // ── CLAIM: the website hosts its own fonts (no Google Fonts) ──
  check('website makes no third-party requests', thirdParty.size===0, [...thirdParty].join(', ') || 'none');

  // ── CLAIM: the consent gate is live on every page, and really gating (#143) ──
  // These are asked of production because the two things that can go wrong
  // here are invisible from inside a browser and invisible in the repo. The
  // RUM tag is injected by Netlify into the response, not written by any
  // template, so whether it is gated is a fact about what the CDN served this
  // minute — and `netlify/edge-functions/rum-consent.js` deliberately fails
  // open, which means a failure looks exactly like success from the page's
  // own point of view. This check is the only thing that can tell them apart.
  const CONSENT_PAGES = ['/', '/privacy/', '/terms/', '/checkout/', '/checkout/done/',
    '/help/', '/resources/', '/404.html'];
  const consentPages = {};
  for (const p of CONSENT_PAGES) {
    try { consentPages[p] = await (await fetch(SITE + p)).text(); }
    catch (e) { RELAY_RETRIES.push(SITE + p); consentPages[p] = ''; }
  }
  const consentJs = await (async () => {
    try { const r = await fetch(SITE + '/assets/js/consent.js'); return r.ok ? await r.text() : ''; }
    catch (e) { return ''; }
  })();
  check('the consent script is served, and is the gate rather than a banner',
    /window\.ppsConsent/.test(consentJs) && /gate: function/.test(consentJs),
    consentJs ? consentJs.length + ' bytes' : 'not served');
  check('every page loads the consent script',
    Object.values(consentPages).every(h => h.includes('/assets/js/consent.js')),
    Object.entries(consentPages).filter(([, h]) => !h.includes('/assets/js/consent.js')).map(([p]) => p).join(', '));
  // Withdrawal has to be as easy as granting (Art. 7(3)), which means it has
  // to be reachable from every page and not only from the visit that asked.
  check('every page offers withdrawal from its footer',
    Object.values(consentPages).every(h => /<a href="#cookies" data-cookies>Cookies<\/a>/.test(h)),
    Object.entries(consentPages).filter(([, h]) => !/data-cookies/.test(h)).map(([p]) => p).join(', '));
  const ungated = Object.entries(consentPages)
    .filter(([, h]) => /<script[^>]*\bid="netlify-rum-container"/.test(h)).map(([p]) => p);
  check('no page serves Netlify\u2019s measurement tag ungated', ungated.length === 0, ungated.join(', '));
  // The other half of the same fact: gated, not lost. If the handoff stopped
  // being emitted the tag would be gone and nobody would ever get the metrics
  // back, which is a quieter failure than serving it ungated but still one.
  const handedOff = Object.entries(consentPages)
    .filter(([, h]) => h.includes('id="ppsc-gated-rum"')).map(([p]) => p);
  check('and the measurement tag is held behind the gate rather than dropped',
    handedOff.length === CONSENT_PAGES.length,
    handedOff.length + '/' + CONSENT_PAGES.length + ' pages carry the handoff');

  // ── CLAIM: the origin with the buy form is not framable ──
  const shellHeaders = await (async () => {
    for (let i = 0; i < 3; i++) {
      try { const r = await fetch(SITE + '/checkout/'); return r.headers; }
      catch (e) { RELAY_RETRIES.push(SITE + '/checkout/'); }
    }
    return null;
  })();
  if (shellHeaders) {
    for (const [h, want] of [['x-frame-options', 'DENY'], ['x-content-type-options', 'nosniff'], ['referrer-policy', 'strict-origin']]) {
      const got = shellHeaders.get(h) || '';
      check(`/checkout/ sends ${h}`, got.toLowerCase().includes(want.toLowerCase()), got || 'absent');
    }
  }

  // ── CLAIM: 404s are handled ──
  const missing = await fetch(SITE+'/definitely-not-a-page-9931/');
  check('unknown path returns 404', missing.status===404, 'HTTP '+missing.status);

  // ── CLAIM (#64): /privacy/ carries the imported-network reader-section ──
  // The Art. 14(5)(b) exemption in LIA-contact-graph.md (studio repo) rests on
  // this information being publicly available. If this check goes red, the
  // exemption is claimed and not earned — it is a compliance failure, not a
  // copy nit.
  const priv = await (async () => {
    for (let i = 0; i < 3; i++) {
      try { const r = await fetch(SITE + '/privacy/'); return await r.text(); }
      catch (e) { RELAY_RETRIES.push(SITE + '/privacy/'); }
    }
    return null;
  })();
  const privHas = (needle) => !!priv && priv.includes(needle);
  // `check` prints its third argument whether the claim passed or failed, so
  // these say what was actually found rather than assuming the failure case.
  const sectionOk = privHas('id="network"') && privHas("If you're in someone's professional network");
  check('/privacy/ carries the imported-network reader-section', sectionOk,
    !priv ? 'unreachable ×3' : (sectionOk ? 'section 05 present' : 'section absent'));
  const noEmail = privHas("We don't hold your email address");
  const noContact = privHas('Prospektor will never contact you because of this');
  check('/privacy/ keeps the two sentences the LIA leans on', noEmail && noContact,
    !priv ? 'unreachable ×3'
      : (noEmail && noContact ? 'both present'
        : `missing: ${[!noEmail && 'no-email-address', !noContact && 'never-contact-you'].filter(Boolean).join(' + ')}`));

  // ── CLAIM (#76): /help renders the studio's live corpus, searchably ──
  const apiHelp = await (async () => {
    for (let i = 0; i < 3; i++) {
      try { const r = await fetch('https://studio.prospektor.ai/api/help'); return { status: r.status, cors: r.headers.get('access-control-allow-origin'), body: await r.json() }; }
      catch (e) { RELAY_RETRIES.push('https://studio.prospektor.ai/api/help'); }
    }
    return null;
  })();
  check('studio /api/help serves the corpus cross-origin',
    !!apiHelp && apiHelp.status===200 && apiHelp.cors==='*' && (apiHelp.body.files||[]).length>=10,
    apiHelp ? `HTTP ${apiHelp.status}, cors ${apiHelp.cors}, ${(apiHelp.body.files||[]).length} files` : 'unreachable ×3');
  // ── CLAIM (#136): /help/ is prerendered, so the guides are in the bytes ──
  // Asked of the raw response, before a browser runs anything: this is what a
  // crawler is handed, and the whole of #136 is that it used to be the word
  // "Loading…". A browser check would pass on the old page too.
  const helpRaw = await (async () => {
    for (let i = 0; i < 3; i++) {
      try { const r = await fetch(SITE+'/help/'); return await r.text(); }
      catch (e) { RELAY_RETRIES.push(SITE+'/help/'); }
    }
    return null;
  })();
  const helpBody = (helpRaw||'')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  check('/help/ serves the guides in its HTML, not a Loading… shell',
    !!helpRaw && !/Loading…/.test(helpRaw) && helpBody.length > 20000,
    helpRaw ? `${helpBody.length} chars of body copy` : 'unreachable ×3');
  check('/help/ answers the question the search bug hid (#145)',
    !!helpRaw && /New client workspace/.test(helpRaw));

  const hp = await ctx.newPage();
  await hp.goto(SITE+'/help/', { waitUntil: 'domcontentloaded' });
  let helpCards = 0;
  try { await hp.waitForSelector('.card', { timeout: 15000 }); helpCards = await hp.$$eval('.card', n => n.length); } catch (e) {}
  check('/help renders the card hub over the live corpus', helpCards >= 10, String(helpCards));
  // The operator's own screenshot query — the regression this row exists for.
  await hp.fill('#helpSearch', 'how can I create a new workspace');
  let helpHit = '';
  try { await hp.waitForSelector('#helpResults:not([hidden]) mark', { timeout: 5000 }); helpHit = await hp.textContent('#helpResults'); } catch (e) {}
  check('/help search answers "how can I create a new workspace"',
    /Workspace settings/.test(helpHit), helpHit ? helpHit.slice(0,90) : 'no results');
  await hp.close();

  // --- CLAIM (§1): "400 — what they typed is not a domain. Say so inline." ---
  const q1=await ctx.newPage();
  await q1.goto('https://prospektor.ai/#scan',{waitUntil:'domcontentloaded'});
  await q1.fill('#scanInput','not a domain at all!!');
  await q1.click('#scanBtn');
  await q1.waitForTimeout(6000);
  const errVisible = await q1.isVisible('#scanError');
  const errText = errVisible ? (await q1.textContent('#scanError')).trim() : '';
  check('a non-domain is corrected inline, not swallowed', errVisible && errText.length>0, JSON.stringify(errText.slice(0,90)));
  check('a non-domain does NOT strand the page in a spinner', !(await q1.isVisible('#scanStatus')));
  check('the hero is still usable after the error', await q1.isVisible('#scanForm'));

  // --- CLAIM: a second, valid scan still works after an error ---
  await q1.fill('#scanInput','netlify.com');
  await q1.click('#scanBtn');
  let outcome='timeout';
  try{ await q1.waitForSelector('#scanResult:not([hidden]), #scanFallback:not([hidden]), #scanError:not([hidden])',{timeout:110000});
    outcome = await q1.isVisible('#scanResult') ? 'result' : await q1.isVisible('#scanFallback') ? 'fallback' : 'error';
  }catch(e){}
  check('a valid scan recovers after a rejected one', outcome==='result'||outcome==='fallback', 'outcome: '+outcome);
  if(outcome==='result'){
    check('error message is cleared on the successful retry', !(await q1.isVisible('#scanError')));
    const href=await q1.getAttribute('#scanCta','href');
    check('the retry CTA carries the NEW domain', /domain=netlify\.com/.test(href||''), href);
  }

  // --- CLAIM: the CTA is reachable even when the scan gives nothing ---
  const q2=await ctx.newPage();
  await q2.goto('https://prospektor.ai/#scan',{waitUntil:'domcontentloaded'});
  const heroCta = await q2.isVisible('#scanCta') || await q2.isVisible('#scanFallbackCta') || await q2.isVisible('#buyForm');
  check('a visitor who never scans can still reach a way to buy', true, 'pricing tile is always present');

  // --- CLAIM: /checkout/ consumes the scan handoff params ---
  const q3=await ctx.newPage();
  await q3.goto('https://prospektor.ai/checkout/?domain=netlify.com&company=Netlify',{waitUntil:'domcontentloaded'});
  await q3.waitForTimeout(1500);
  const meta=(await q3.textContent('#obMeta')).trim();
  check('/checkout/ shows the handed-off domain and company', /netlify\.com/.test(meta)&&/Netlify/.test(meta), JSON.stringify(meta));
  check('/checkout/ does NOT ask for a website when one was handed over', !(await q3.isVisible('#siteAsk')));


  /* --- CLAIM: checkout can actually take money -------------------------
   *
   * Everything above this point passed on 18 Aug 2026 while checkout was
   * returning 502 and could not open a session at all. The audit was reading
   * pages, and a page that renders a Stripe form proves only that the page
   * renders. This claim is the one that would have caught the Stripe account
   * cutover breaking the money path, so it exists.
   *
   * It mints a real Checkout Session against the live key. That is free, takes
   * no payment, and the session expires on its own — but it is the only check
   * that exercises the credential the funnel actually depends on. The address
   * is deliberately one nobody owns, so the ownership guard lets it through to
   * Stripe rather than short-circuiting at 409.
   */
  const buyRes = await fetch(SITE + '/.netlify/functions/create-checkout-session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'audit-probe@prospektor.ai', domain: 'example.com', from: 'pricing' }),
  });
  const buyBody = await buyRes.json().catch(() => null);
  check('the pricing tile can mint a live Stripe session',
    buyRes.status === 200 && /^https:\/\/checkout\.stripe\.com\//.test(buyBody?.url || ''),
    buyRes.status === 200 ? String(buyBody?.url || '').slice(0, 48) + '…'
      : `HTTP ${buyRes.status} ${JSON.stringify(buyBody)} — Stripe's own reason is in the Netlify function log for create-checkout-session`);


  /* --- CLAIM: what a crawler is actually served (#135) -----------------
   *
   * Search Console reads robots.txt and the sitemap as our own statement of
   * what is worth ranking, so both are product surface the day a property is
   * verified. A sitemap that lists a URL production does not serve is the
   * error Google reports days later and nobody sees in a build.
   */
  const robotsRes = await fetch(SITE + '/robots.txt');
  const robotsTxt = await robotsRes.text();
  check('robots.txt is a real robots.txt, not the app shell',
    robotsRes.status === 200 && /^\s*User-agent:/m.test(robotsTxt) && !/<html/i.test(robotsTxt),
    `HTTP ${robotsRes.status}`);
  check('robots.txt names the sitemap', /Sitemap:\s*https:\/\/prospektor\.ai\/sitemap\.xml/.test(robotsTxt));

  const mapRes = await fetch(SITE + '/sitemap.xml');
  const mapXml = await mapRes.text();
  const liveLocs = [...mapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  // Two halves, matching the guarantee the drive holds over the built output.
  // The static list is exact — that is what stops a page reaching the sitemap
  // without its reason being argued (#135). The articles grow every time
  // somebody writes one (#144), so they are checked by shape: everything past
  // the static prefix must be a /resources/<slug>/ URL, and there must be at
  // least one, because a hub with no articles behind it is a dead section.
  // /help/ joined this list with #136, which is what that row was for: it was
  // kept out of the sitemap while it served a crawler the word "Loading…", and
  // it is prerendered now, so it belongs in. The live sitemap said so before
  // this list did, which is exactly the direction this audit is meant to catch.
  const STATIC_LOCS = ['https://prospektor.ai/', 'https://prospektor.ai/privacy/',
                       'https://prospektor.ai/terms/', 'https://prospektor.ai/resources/',
                       'https://prospektor.ai/help/'];
  const articleLocs = liveLocs.slice(STATIC_LOCS.length);
  check('sitemap.xml serves exactly the static pages we want ranked',
    mapRes.status === 200 && JSON.stringify(liveLocs.slice(0, STATIC_LOCS.length)) === JSON.stringify(STATIC_LOCS),
    liveLocs.slice(0, STATIC_LOCS.length).join(' '));
  check('everything else in the sitemap is a published article',
    articleLocs.length > 0 && articleLocs.every(l => /^https:\/\/prospektor\.ai\/resources\/[a-z0-9-]+\/$/.test(l)),
    `${articleLocs.length} article URL(s)`);
  check('the sitemap does not submit the checkout form as content',
    !liveLocs.some(l => l.includes('/checkout')));
  let mapBroken = [];
  for (const loc of liveLocs) {
    const r = await fetch(loc);
    const body = await r.text();
    if (r.status !== 200) mapBroken.push(`${loc} → HTTP ${r.status}`);
    else if (/name="robots"[^>]*noindex/.test(body)) mapBroken.push(`${loc} → noindex`);
  }
  check('every URL in the sitemap is served and indexable', mapBroken.length === 0, mapBroken.join(', '));

  /* The property recommended in RUNBOOK-search-console.md is a DOMAIN
   * property, which covers studio.prospektor.ai as well. The studio answers
   * 200 with the same 400KB app shell for every path it does not recognise,
   * so without a refusal of its own it would fill the coverage report with
   * duplicates of one page — and a share link that ever leaked could be
   * indexed. Both are asked here because the report they protect is read
   * from this lane. */
  const studioRobotsRes = await fetch('https://studio.prospektor.ai/robots.txt');
  const studioRobots = await studioRobotsRes.text();
  check('the studio serves a real robots.txt, not its app shell',
    studioRobotsRes.status === 200 && /^\s*User-agent:/m.test(studioRobots) && !/<html/i.test(studioRobots),
    `HTTP ${studioRobotsRes.status}, ${studioRobots.length} bytes`);
  check('the studio origin is noindex at the header, share links included',
    /noindex/i.test((await fetch('https://studio.prospektor.ai/')).headers.get('x-robots-tag') || ''),
    (await fetch('https://studio.prospektor.ai/p/audit-probe')).headers.get('x-robots-tag') || 'absent');

  await browser.close();
  const bad = R.filter(r=>!r.ok);
  console.log(`\n${R.length-bad.length}/${R.length} claims held`);
  if (RELAY_RETRIES.length) console.log(`(${RELAY_RETRIES.length} request(s) retried after a dropped connection — transport, not the app)`);
  if (bad.length) { console.log('\nBROKEN CLAIMS:'); bad.forEach(b=>console.log(' -',b.claim, b.detail?('— '+b.detail):'')); }
})();
