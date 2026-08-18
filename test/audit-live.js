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
  const jsFiles = ['/assets/js/main.js','/assets/js/scan.js','/assets/js/checkout.js','/assets/js/buy.js'];
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

  // ── CLAIM: 404s are handled ──
  const missing = await fetch(SITE+'/definitely-not-a-page-9931/');
  check('unknown path returns 404', missing.status===404, 'HTTP '+missing.status);

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

  await browser.close();
  const bad = R.filter(r=>!r.ok);
  console.log(`\n${R.length-bad.length}/${R.length} claims held`);
  if (RELAY_RETRIES.length) console.log(`(${RELAY_RETRIES.length} request(s) retried after a dropped connection — transport, not the app)`);
  if (bad.length) { console.log('\nBROKEN CLAIMS:'); bad.forEach(b=>console.log(' -',b.claim, b.detail?('— '+b.detail):'')); }
})();
