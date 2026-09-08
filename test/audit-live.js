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
/* Every fetch in this file gets a deadline (#185). The retry loop below was
   written for an egress that DROPS a connection, and it works: a dead socket
   throws, the attempt is retried, the audit reports the app rather than the
   transport. A connection that is accepted and then goes silent is the other
   half, and Node's fetch has no default timeout — so the audit hung on the
   request rather than retrying it, and a run against production could sit
   there indefinitely with no failure and no output. Shadowing `fetch` once
   here covers every call site in the file, including the browser relay. */
const NET_TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 15000);
const bareFetch = globalThis.fetch;
const fetch = (url, opts) => bareFetch(url, { signal: AbortSignal.timeout(NET_TIMEOUT_MS), ...(opts || {}) });
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
      // only a request that fails three times counts as a failure. Since #185
      // a request that HANGS reaches this path too: measured from these
      // containers, the stall is a connect/TLS stall on the way to
      // prospektor.ai and it hits a static asset exactly as often as it hits a
      // function, so it is transport here as well — it just used to be
      // transport that never threw.
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
  // The script URLs are read off the served pages rather than listed here:
  // since #169 their filenames carry a content hash, so a hard-coded list
  // would 404 on every deploy and quietly stop checking anything. Reading the
  // pages is also the stronger claim — it covers whatever production actually
  // serves, including a script this repo has not heard of.
  const SCRIPT_HOSTS = ['/', '/pricing/', '/checkout/', '/help/', '/resources/'];
  const scriptSrcs = new Set();
  for (const p of SCRIPT_HOSTS) {
    try {
      const html = await (await fetch(SITE + p)).text();
      for (const m of html.matchAll(/<script\b[^>]*\ssrc=["'](\/assets\/[^"']+)["']/gi)) scriptSrcs.add(m[1]);
    } catch (e) { RELAY_RETRIES.push(SITE + p); }
  }
  const jsFiles = [...scriptSrcs];
  check('the pages name the scripts they load, and every one is served',
    jsFiles.length >= 5, `${jsFiles.length} distinct script(s)`);
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
  // #241: the typeahead — the site's own function answers, and the page
  // draws the answer under the field. Asked of production because the
  // function is deployed beside the page and a green build says nothing
  // about whether Netlify actually serves it.
  {
    const r = await fetch(SITE + '/.netlify/functions/company-suggest?q=stripe');
    const data = r.ok ? await r.json().catch(() => null) : null;
    const list = data && Array.isArray(data.suggestions) ? data.suggestions : null;
    check('company-suggest answers from this origin (#241)', !!list, 'status ' + r.status);
    check('and hands back names and domains only — no logo URL (#241)',
      !!list && list.length > 0 && list.every(e => Object.keys(e).sort().join(',') === 'domain,name'),
      JSON.stringify((list || []).slice(0, 2)));
    await page.click('#scanInput');
    await page.keyboard.type('stri');
    let listed = false;
    try { await page.waitForSelector('#scanSuggest:not([hidden]) li', { timeout: 8000 }); listed = true; } catch (e) {}
    check('the scan field suggests companies as you type (#241)', listed,
      listed ? (await page.textContent('#scanSuggest li:first-child')).trim().slice(0, 60) : 'no list within 8 s');
    await page.keyboard.press('Escape');
    await page.fill('#scanInput', '');
  }
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
    // #240: the result is one card — name, chips, the proposal. The signal
    // bullets are deliberately gone ("the client knows themselves").
    const goal = (await page.textContent('#scanGuess')).trim();
    const name = (await page.textContent('#scanName')).trim();
    check('scan renders a target headline', goal.length > 0, JSON.stringify(goal.slice(0,80)));
    check('scan card leads with who they are', name.length > 0, JSON.stringify(name));
    check('scan renders no signal bullets (#240)', (await page.locator('#scanSignals li').count()) === 0);
    const href = await page.getAttribute('#scanCta','href');
    check('scan CTA carries domain into /checkout/', /^\/checkout\/\?.*domain=/.test(href) || href === '/checkout/', href);
    // #419: the free run is the card's primary action. Asked of production
    // because the defect this closes was invisible to every green build for
    // six days — the studio answered /r the whole time and nothing here
    // pointed at it, so the run counted `spent: 0`.
    const runHref = await page.getAttribute('#scanRunCta','href');
    check('the scan result offers the free run (#419)',
      /^https:\/\/studio\.prospektor\.ai\/r/.test(runHref || ''), runHref);
    check('and it opens on the domain that was scanned (#419)',
      /[?&]domain=/.test(runHref || ''), runHref);
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
  check('/checkout/done/ is a confirmation, not a next-step card (#244)',
    await p4.isVisible('#confirmCard'));

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
  // Hash-tolerant since #169: the gate is found by what it is, not by a
  // filename the build is now allowed to change on every edit.
  const CONSENT_SRC = /\/assets\/js\/consent(?:\.[0-9a-f]+)?\.js/;
  const consentUrl = (Object.values(consentPages).map(h => (h.match(CONSENT_SRC) || [])[0]).find(Boolean));
  const consentJs = await (async () => {
    if (!consentUrl) return '';
    try { const r = await fetch(SITE + consentUrl); return r.ok ? await r.text() : ''; }
    catch (e) { return ''; }
  })();
  check('the consent script is served, and is the gate rather than a banner',
    /window\.ppsConsent/.test(consentJs) && /gate: function/.test(consentJs),
    consentJs ? consentJs.length + ' bytes' : 'not served');
  check('every page loads the consent script',
    Object.values(consentPages).every(h => CONSENT_SRC.test(h)),
    Object.entries(consentPages).filter(([, h]) => !CONSENT_SRC.test(h)).map(([p]) => p).join(', '));
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
    !priv ? 'unreachable ×3' : (sectionOk ? 'section 06 present' : 'section absent'));
  const noEmail = privHas("We don't hold your email address");
  const noContact = privHas('Prospektor will never contact you because of this');
  check('/privacy/ keeps the two sentences the LIA leans on', noEmail && noContact,
    !priv ? 'unreachable ×3'
      : (noEmail && noContact ? 'both present'
        : `missing: ${[!noEmail && 'no-email-address', !noContact && 'never-contact-you'].filter(Boolean).join(' + ')}`));

  // ── CLAIM (#387): /privacy/ says what the message archive leaves behind ──
  // #355 lets a member import LinkedIn's messages.csv and keeps a per-counterparty
  // tally from it (sent, received, first, last) — no content, no subjects, no
  // thread titles. The old sentence here said we held "nothing that passed
  // between you", which that tally would have falsified the day it shipped, and
  // nothing in this file was holding it. Red here means the notice understates
  // what the import keeps — a false statement to a data subject, not a copy nit.
  const msgNoContent = privHas("We hold none of your messages");
  const msgTally = privHas("two counts and two dates");
  check("/privacy/ keeps the message-archive sentence the tally rests on", msgNoContent && msgTally,
    !priv ? "unreachable ×3"
      : (msgNoContent && msgTally ? "both present"
        : `missing: ${[!msgNoContent && "none-of-your-messages", !msgTally && "two-counts-two-dates"].filter(Boolean).join(" + ")}`));

  // ── CLAIM (#183): /privacy/ carries the scan-field reader-section ──
  // The front page's one field writes a reading of somebody's website that is
  // kept indefinitely under their domain. This section is the only notice that
  // person ever gets, and PUBLIC-PAGES.md (studio repo) cites its existence as
  // the measure any future publishing argument starts from. Red here means the
  // notice is missing, not that a heading was reworded.
  const scanOk = privHas('id="scan"') && privHas('If someone scanned your website');
  check('/privacy/ carries the scan-field reader-section', scanOk,
    !priv ? 'unreachable ×3' : (scanOk ? 'section 05 present' : 'section absent'));
  // The two claims the section must not lose: it does not promise deletion is
  // permanent, and it does not call the reading private.
  const scanDelete = privHas("there’s no suppression list");
  const scanNotPublished = privHas('We do not publish it');
  check('/privacy/ keeps the scan section\'s two load-bearing sentences', scanDelete && scanNotPublished,
    !priv ? 'unreachable ×3'
      : (scanDelete && scanNotPublished ? 'both present'
        : `missing: ${[!scanDelete && 'no-suppression-list', !scanNotPublished && 'do-not-publish'].filter(Boolean).join(' + ')}`));

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
  // ── CLAIM (#136, split by #166): the guides are in the bytes ──
  // Asked of the raw responses, before a browser runs anything: this is what a
  // crawler is handed, and the whole of #136 is that it used to be the word
  // "Loading…". A browser check would pass on the old page too.
  //
  // #166 moved that text to one URL per guide, so the claim is asked of the
  // section rather than of the hub, and of the LIVE corpus's slugs rather than
  // a list written here — a guide the studio has added and this site has not
  // rebuilt for should show up as a missing page, which is the one failure
  // this claim exists to catch.
  const getRaw = async (url) => {
    for (let i = 0; i < 3; i++) {
      try { const r = await fetch(url); return { status: r.status, text: await r.text() }; }
      catch (e) { RELAY_RETRIES.push(url); }
    }
    return null;
  };
  const bodyOf = html => (html||'')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const helpRes = await getRaw(SITE+'/help/');
  const helpRaw = helpRes && helpRes.text;
  const liveSlugs = ((apiHelp && apiHelp.body.files) || [])
    .map(f => f.name.replace(/^\d+-/, '').replace(/\.md$/, ''));

  check('/help/ is the hub, not a Loading… shell',
    !!helpRaw && !/Loading…/.test(helpRaw) && /helpSearch/.test(helpRaw),
    helpRaw ? `${bodyOf(helpRaw).length} chars of hub copy` : 'unreachable ×3');

  const guidePages = [];
  for (const slug of liveSlugs) {
    const res = await getRaw(SITE+'/help/'+slug+'/');
    guidePages.push({ slug, ok: !!res && res.status === 200, chars: bodyOf(res && res.text).length,
      shell: !!res && /Loading…/.test(res.text) });
  }
  const missingGuides = guidePages.filter(g => !g.ok).map(g => g.slug);
  const totalChars = guidePages.reduce((n, g) => n + g.chars, 0);
  check('every guide the studio publishes has its own URL (#166)',
    guidePages.length > 0 && !missingGuides.length,
    missingGuides.length ? `missing: ${missingGuides.join(', ')}` : `${guidePages.length} guides served`);
  check('and the section still carries the long-tail content #136 bought',
    totalChars > 20000 && !guidePages.some(g => g.shell), `${totalChars} chars across the guides`);
  check('/help/ answers the question the search bug hid (#145)',
    guidePages.some(g => g.slug === 'workspace') &&
    /New client workspace/.test((await getRaw(SITE+'/help/workspace/') || {}).text || ''));

  const hp = await ctx.newPage();
  await hp.goto(SITE+'/help/', { waitUntil: 'domcontentloaded' });
  let helpCards = 0;
  try { await hp.waitForSelector('.card', { timeout: 15000 }); helpCards = await hp.$$eval('.card', n => n.length); } catch (e) {}
  check('/help renders the card hub over the live corpus', helpCards >= 10, String(helpCards));
  check('and every card opens a guide on its own URL (#166)',
    (await hp.$$eval('.card > a', as => as.map(a => a.getAttribute('href'))))
      .every(h => /^\/help\/[a-z0-9-]+\/$/.test(h)));
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
  // ── CLAIM: the header is pages, not anchors (#153) ──
  //    Asked of production because the whole row was a header that looked
  //    finished and went nowhere. The nav is read off the served homepage, so
  //    this catches a stale build as readily as a bad edit.
  {
    const home = await (await fetch(SITE + '/')).text();
    const navItems = [...home.matchAll(/<ul class="nav-links"[^>]*>([\s\S]*?)<\/ul>/g)]
      .flatMap(m => [...m[1].matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map(a => ({ url: a[1], label: a[2] })));
    check('the live header has items at all', navItems.length >= 4, navItems.length + ' item(s)');
    check('and not one of them is a same-page anchor',
      navItems.every(i => !i.url.includes('#')),
      navItems.filter(i => i.url.includes('#')).map(i => i.label + ' → ' + i.url).join(', '));

    for (const item of navItems) {
      const r = await fetch(SITE + item.url);
      const body = r.ok ? await r.text() : '';
      check(`header item "${item.label}" serves a real page`,
        r.status === 200 && /<h1[^>]*>/.test(body), r.status + (r.ok ? '' : ' — ' + item.url));
    }

    // #453: the two questions moved out of the h1 and into the deck under it,
    // so this asks production the two things that actually matter — the frame
    // is still in the hero (#153), and the h1 is the promise the <title> makes.
    const liveHero = (home.match(/<section class="hero"[^>]*>([\s\S]*?)<\/section>/) || [, ''])[1];
    check('the two questions are still in the live hero (#153)',
      /Who to pitch\./.test(liveHero) && /What to send\./.test(liveHero),
      (liveHero.match(/<div class="hero-ai-tag">([\s\S]*?)<\/div>/) || [, '(none)'])[1]
        .replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
    // Words, not typography: the h1 breaks the promise over two lines with a
    // full stop in the middle, and the tagline is one phrase.
    const liveWords = t => t.replace(/<[^>]*>/g, ' ').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim();
    const liveH1 = (home.match(/<h1>([\s\S]*?)<\/h1>/) || [, '(none)'])[1];
    const liveTitle = (home.match(/<title>([^<]*)<\/title>/) || [, ''])[1];
    check('and the live h1 says what the live <title> says (#453)',
      liveWords(liveH1).includes(liveWords(liveTitle.split('·').pop() || '').replace(/^your /, '')),
      liveH1.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() + '  ·  ' + liveTitle);

    // The trap CLAUDE.md names: a pricing page that looks right and quietly
    // degrades to the multi-step /checkout/ page is the regression that
    // shipped once and was recorded as done.
    const pricing = await (await fetch(SITE + '/pricing/')).text();
    const missingIds = ['buy','buyLink','buyForm','buyEmail','buyBtn','buySite','buyMsg','buyLive']
      .filter(id => !pricing.includes('id="' + id + '"'));
    check('/pricing/ serves the whole direct-to-Stripe form',
      missingIds.length === 0 && /assets\/js\/buy(?:\.[0-9a-f]+)?\.js/.test(pricing),
      missingIds.length ? 'missing #' + missingIds.join(', #')
        : (/assets\/js\/buy(?:\.[0-9a-f]+)?\.js/.test(pricing) ? '' : 'the ids are there but buy.js is not loaded'));

    // ── CLAIM (#542): the yearly plan is on the live pricing page ──
    // The board's own definition of done for that row: the yearly figure
    // visible as SERVED BYTES on prospektor.ai/pricing/. Asked of production
    // rather than of the build, because a green build is not a deploy — which
    // is the whole reason this file exists. Both the reader's figure and the
    // machine's Offer, since Google reads one and a buyer the other.
    const yearlyOffer = /"price":\s*"9990\.00"/.test(pricing) && /"billingPeriod":\s*"P1Y"/.test(pricing);
    check('/pricing/ serves the yearly plan — the switch, the figure and a second Offer (#542)',
      pricing.includes('id="planSwitch"') && pricing.includes('$9,990') && yearlyOffer
        && /assets\/js\/plan(?:\.[0-9a-f]+)?\.js/.test(pricing),
      [!pricing.includes('id="planSwitch"') && 'no #planSwitch',
       !pricing.includes('$9,990') && 'the $9,990 figure is not in the bytes',
       !yearlyOffer && 'no P1Y Offer at 9990.00 in the structured data',
       !/assets\/js\/plan(?:\.[0-9a-f]+)?\.js/.test(pricing) && 'plan.js is not loaded',
      ].filter(Boolean).join('; '));
    const terms = await (await fetch(SITE + '/terms/')).text();
    check('and /terms/ §02 says a yearly price is fixed for the year (#542)',
      /fixed for the year/i.test(terms) && terms.includes('$9,990'),
      [!/fixed for the year/i.test(terms) && 'no "fixed for the year" clause',
       !terms.includes('$9,990') && 'the yearly figure is not on /terms/'].filter(Boolean).join('; '));
  }

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
  const STATIC_LOCS = ['https://prospektor.ai/',
                       'https://prospektor.ai/who-to-pitch/', 'https://prospektor.ai/what-to-send/',
                       'https://prospektor.ai/pricing/',
                       'https://prospektor.ai/privacy/',
                       'https://prospektor.ai/terms/', 'https://prospektor.ai/resources/',
                       'https://prospektor.ai/help/',
                       // #456. Ordered as sitemap.njk lists it — this block is
                       // compared as a PREFIX, in order, so a page appended to
                       // the sitemap must be appended here too. Anything past
                       // this prefix has to match /resources/<slug>/ or
                       // /help/<slug>/, so a forgotten static page fails as
                       // "not a guide or an article" and names neither itself
                       // nor the cause. test/drive.js keeps the same list for
                       // the built sitemap and needs the same edit.
                       'https://prospektor.ai/contact/'];
  // #114: each static page is followed by its twin in every language this
  // repo has a catalogue for — asked of lib/i18n.js and of the live site (a
  // twin that answers 200 is listed; one that 404s is not), never listed here.
  const i18n = require('../lib/i18n.js');
  const STATIC_WITH_TWINS = [];
  for (const loc of STATIC_LOCS) {
    for (const l of i18n.built()) {
      const u = 'https://prospektor.ai' + i18n.twin(loc.replace('https://prospektor.ai', ''), l.code);
      if (l.code === 'en') { STATIC_WITH_TWINS.push(u); continue; }
      let res = null;
      try { res = await fetch(u.replace('https://prospektor.ai', SITE), { redirect: 'manual' }); } catch (e) { res = null; }
      if (res && res.status === 200) STATIC_WITH_TWINS.push(u);
    }
  }
  // Everything after the static block is derived — the help guides (#166) and
  // then the articles (#159). Both are checked by SHAPE rather than by count,
  // because both lists are supposed to grow without this file being edited.
  const derivedLocs = liveLocs.slice(STATIC_WITH_TWINS.length);
  // A guide URL lives under /help/ in any built language's prefix (#535).
  const isGuide = l => i18n.built().some(x => l.startsWith('https://prospektor.ai' + x.prefix + '/help/'));
  const guideLocs = derivedLocs.filter(isGuide);
  const articleLocs = derivedLocs.filter(l => !isGuide(l));
  check('sitemap.xml serves exactly the static pages we want ranked, each with its live twins (#114)',
    mapRes.status === 200 && JSON.stringify(liveLocs.slice(0, STATIC_WITH_TWINS.length)) === JSON.stringify(STATIC_WITH_TWINS),
    liveLocs.slice(0, STATIC_WITH_TWINS.length).join(' '));
  // The Spanish funnel (#114) and, since #535, the rest of the site: served,
  // in the language, self-canonical, naming its English twin — and the
  // English page naming it back. /help/ is asked only where the twin
  // answered 200 above: an edition exists exactly where the studio holds a
  // guide in the language, so a 404 there is the correct answer for a
  // language with none, and the English hub must then NOT name it.
  for (const l of i18n.built().filter(l => l.code !== 'en')) {
    const helpTwin = 'https://prospektor.ai' + l.prefix + '/help/';
    const hasHelp = STATIC_WITH_TWINS.includes(helpTwin);
    if (!hasHelp) {
      const en = await (await fetch(SITE + '/help/')).text();
      check(`no ${l.prefix}/help/ (the studio holds no ${l.name} guide), and /help/ does not name one`,
        !en.includes(`hreflang="${l.code}"`));
    }
    for (const p of ['/', '/pricing/', '/checkout/', '/who-to-pitch/', '/what-to-send/', '/contact/'].concat(hasHelp ? ['/help/'] : [])) {
      const twin = l.prefix + p;
      const res = await fetch(SITE + twin);
      const html = res.status === 200 ? await res.text() : '';
      check(`${twin} is served in ${l.name} (#114)`,
        res.status === 200 && new RegExp(`<html lang="${l.code}">`).test(html)
        && html.includes(`<link rel="canonical" href="https://prospektor.ai${twin}">`)
        && html.includes(`<link rel="alternate" hreflang="en" href="https://prospektor.ai${p}">`)
        && html.includes(`<link rel="alternate" hreflang="${l.code}" href="https://prospektor.ai${twin}">`), res.status);
      const en = await (await fetch(SITE + p)).text();
      check(`and ${p} names ${twin} as its ${l.code} twin`,
        en.includes(`<link rel="alternate" hreflang="${l.code}" href="https://prospektor.ai${twin}">`)
        && en.includes(`<link rel="alternate" hreflang="x-default" href="https://prospektor.ai${p}">`));
    }
    const home = await (await fetch(SITE + l.prefix + '/')).text();
    check(`${l.prefix}/ speaks ${l.name}: the h1 is not the English one`,
      !/Find Leads\./.test(home.match(/<h1>[\s\S]*?<\/h1>/)?.[0] || ''));
    check(`${l.prefix}/ links checkout in ${l.name}`, home.includes(`href="${l.prefix}/checkout/"`));
    // #535: the two product pages and contact, in the language — the h1 is
    // not the English one, and the nav's items land on the twins.
    for (const [p, h1] of [['/who-to-pitch/', 'Who to pitch'], ['/what-to-send/', 'What to send'], ['/contact/', 'Ask us anything.']]) {
      const html = await (await fetch(SITE + l.prefix + p)).text();
      check(`${l.prefix}${p} speaks ${l.name}: the h1 is not the English one (#535)`,
        !(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || ['', ''])[1].includes(h1));
    }
    // Netlify rewrites a <form netlify> tag at deploy time — single quotes,
    // attributes reordered — so the action is matched, not the markup.
    check(`${l.prefix}/contact/ posts to ${l.prefix}/contact/thanks/, which is served (#535)`,
      new RegExp(`<form[^>]*\\saction=["']${l.prefix}/contact/thanks/["']`).test(await (await fetch(SITE + l.prefix + '/contact/')).text())
      && (await fetch(SITE + l.prefix + '/contact/thanks/')).status === 200);
    if (hasHelp) {
      // The Spanish help section (#535): the hub links its own guide pages,
      // and the first guide the studio serves in the language is served in it.
      const hub = await (await fetch(SITE + l.prefix + '/help/')).text();
      const cards = [...hub.matchAll(/<li class="card">\s*<a href="([^"]+)"/g)].map(m => m[1]);
      check(`${l.prefix}/help/ links a guide page per card, each under ${l.prefix}/help/`,
        cards.length >= 10 && cards.every(h => h.startsWith(l.prefix + '/help/')), `${cards.length} cards`);
      let corpus = null;
      try { corpus = await (await fetch(`https://studio.prospektor.ai/api/help?lang=${l.code}`)).json(); } catch (e) { RELAY_RETRIES.push('api/help?lang=' + l.code); }
      const own = ((corpus && corpus.files) || []).filter(f => f.language === l.code);
      const first = own[0] && own[0].name.replace(/^\d+-/, '').replace(/\.md$/, '');
      const guide = first ? await (await fetch(SITE + l.prefix + '/help/' + first + '/')).text() : '';
      check(`${l.prefix}/help/${first || '?'}/ is served in ${l.name}, naming its English twin`,
        !!first && new RegExp(`<html lang="${l.code}">`).test(guide)
        && guide.includes(`<link rel="alternate" hreflang="en" href="https://prospektor.ai/help/${first}/">`)
        && guide.includes('id="guideLangNote" hidden'),
        corpus ? `${own.length} of ${corpus.files.length} files in ${l.name}` : 'studio unreachable');
      check(`and the sitemap carries the ${l.name} guide pages beside the English ones`,
        own.length > 0 && own.every(f => liveLocs.includes('https://prospektor.ai' + l.prefix + '/help/' + f.name.replace(/^\d+-/, '').replace(/\.md$/, '') + '/')));
    }
  }
  check('everything else in the sitemap is a help guide or a published article',
    // A guide URL may sit under a language's prefix (#535); an article never does.
    derivedLocs.length > 0 && derivedLocs.every(l =>
      /^https:\/\/prospektor\.ai\/resources\/[a-z0-9-]+\/$/.test(l)
      || i18n.built().some(x => new RegExp(`^https://prospektor\\.ai${x.prefix}/help/[a-z0-9-]+/$`).test(l))),
    `${guideLocs.length} guide URL(s), ${articleLocs.length} article URL(s)`);
  check('and every guide the studio publishes is among them (#166)',
    guideLocs.length > 0 && liveSlugs.length > 0 &&
    liveSlugs.every(sl => guideLocs.includes('https://prospektor.ai/help/' + sl + '/')),
    `sitemap ${guideLocs.length}, corpus ${liveSlugs.length}`);
  check('the sitemap does not submit the checkout form as content',
    !liveLocs.some(l => l.includes('/checkout')));

  /* #159 — /resources is one article per useful learning, and the ledger in
     data/learnings.json is what keeps it honest. The ledger cannot be asked of
     production; what can is that every article it claims is actually served,
     and that the hub's topic filter reached the live build intact — including
     the part that only matters when JavaScript does not run. */
  {
    const { report } = require('../tools/learning-coverage.js');
    const r = report();
    check('the learnings ledger is internally consistent before we ask production anything',
      r.problems.length === 0, r.problems.join(' · '));
    const wanted = new Set(r.problems.length ? [] :
      require('../tools/learning-coverage.js').articles().map(a => a.slug));
    const hubRes = await fetch(SITE + '/resources/');
    const hub = await hubRes.text();
    const missing = [...wanted].filter(slug => !hub.includes(`href="/resources/${slug}/"`));
    check('every article the ledger covers is listed on the live hub',
      hubRes.status === 200 && wanted.size > 0 && missing.length === 0,
      missing.length ? 'missing ' + missing.join(', ') : `${wanted.size} article(s)`);
    const chips = [...new Set([...hub.matchAll(/data-filter="([^"]*)"/g)].map(m => m[1]))]
      .filter(Boolean);
    check('the live hub carries a topic chip per topic, and ships the row hidden',
      chips.length > 1 && /data-topic-filter hidden/.test(hub),
      chips.join(', '));
    const resourcesSrc = (hub.match(/\/assets\/js\/resources(?:\.[0-9a-f]+)?\.js/) || [])[0];
    const jsRes = resourcesSrc ? await fetch(SITE + resourcesSrc) : { status: 404, text: async () => '' };
    check('and the script that reveals it is served',
      jsRes.status === 200 && /data-topic-filter/.test(await jsRes.text()),
      resourcesSrc ? `HTTP ${jsRes.status}` : 'the hub names no resources script');
  }
  let mapBroken = [];
  for (const loc of liveLocs) {
    const r = await fetch(loc);
    const body = await r.text();
    if (r.status !== 200) mapBroken.push(`${loc} → HTTP ${r.status}`);
    else if (/name="robots"[^>]*noindex/.test(body)) mapBroken.push(`${loc} → noindex`);
  }
  check('every URL in the sitemap is served and indexable', mapBroken.length === 0, mapBroken.join(', '));

  /* #169: the two halves of the cache fix, asked of production together.
   * The row's cost was eight conditional round trips before a repeat visitor
   * saw anything. Hashing without the header buys nothing, and the header
   * without hashing is worse than doing neither — a stale stylesheet served
   * for a year — so both are one claim, and the second is checked in the
   * dangerous direction as well: nothing immutable may carry an unhashed
   * name. The list is whatever the homepage actually blocks on. */
  const homeForAssets = await (await fetch(SITE + '/')).text();
  const blocking = [...new Set([
    ...[...homeForAssets.matchAll(/<link\b[^>]*\srel=["'](?:stylesheet|preload)["'][^>]*>/gi)]
      .map(m => (m[0].match(/\shref=["']([^"']*)["']/i) || [])[1]),
    ...[...homeForAssets.matchAll(/<script\b[^>]*\ssrc=["']([^"']+)["']/gi)].map(m => m[1]),
  ])].filter(u => u && /^\/assets\/(?:css|js|fonts)\//.test(u));
  const cacheFaults = [];
  for (const ref of blocking) {
    let cc, status;
    try { const r = await fetch(SITE + ref); status = r.status; cc = r.headers.get('cache-control') || ''; }
    catch (e) { cacheFaults.push(`${ref} unreachable`); continue; }
    if (status !== 200) { cacheFaults.push(`${ref} → HTTP ${status}`); continue; }
    const hashed = /\.[0-9a-f]{8,}\.(?:css|js|woff2)$/.test(ref);
    const immutable = /\bimmutable\b/.test(cc) && Number((cc.match(/max-age=(\d+)/) || [])[1] || 0) >= 2592000;
    if (!hashed) cacheFaults.push(`${ref} carries no content hash`);
    if (hashed && !immutable) cacheFaults.push(`${ref} → ${cc || 'no cache-control'}`);
    if (!hashed && /\bimmutable\b/.test(cc)) cacheFaults.push(`${ref} is immutable WITHOUT a hash — stale for a year`);
  }
  check('every asset the homepage blocks on is content-hashed and cached forever',
    blocking.length >= 4 && cacheFaults.length === 0,
    cacheFaults.length ? cacheFaults.join('; ') : `${blocking.length} asset(s), max-age=31536000, immutable`);

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

  /* #423 — the one claim on this site whose truth is decided on the OTHER
   * side of the wire. #422 shipped a free tier: `ONBOARDING_OPEN=1` on the
   * studio mints a workspace that runs one full pitch, then asks for the
   * card. Nothing in this repo can see that variable, and the funnel spent
   * its whole life telling people "no trial theater" and "No free trial" —
   * so the day the operator sets it, the money pages start lying and every
   * build here stays green. `npm test` now refuses the denials outright;
   * this asks the live pair the question the build cannot, in both
   * directions, because promising a free tier while the door is SHUT is the
   * same defect pointing the other way and strands whoever clicks.
   *
   * The mode is read from the studio's own /api/me. #426 has it 503ing and
   * dropping connections in bursts, so an unreadable mode is reported as a
   * fact and asserts nothing — a flaky dependency must never fail a claim
   * about this site. */
  let mode = null;
  for (let attempt = 0; attempt < 3 && !mode; attempt++) {
    try {
      const me = await (await fetch('https://studio.prospektor.ai/api/me')).json();
      mode = (me.environment || {}).onboarding || null;
    } catch (e) { /* #426 — retried, then reported as unknown */ }
  }
  const money = [await (await fetch(SITE + '/')).text(),
                 await (await fetch(SITE + '/pricing/')).text(),
                 await (await fetch(SITE + '/llms.txt')).text()].join('\n')
                 .replace(/<[^>]*>/g, ' ');
  const denies = /no\s+trial\s+theater|no\s+free\s+trial|(?:there\s+is|there's)\s+no\s+free|no\s+free\s+(?:tier|workspace|plan)/i;
  const promises = /free\s+(?:workspace|tier)|start\s+free/i;
  if (!mode) {
    check('the studio\'s onboarding mode could be read', false,
      'unreadable after 3 tries (#426) — the free-tier claim below was not asked');
  } else {
    check('the funnel does not deny a free offering the studio now has',
      !(mode === 'open' && denies.test(money)),
      `studio onboarding=${mode}` + (denies.test(money) ? ` — site says ${JSON.stringify((money.match(denies)||[])[0])}` : ''));
    check('and does not offer a free workspace the studio would refuse',
      !(mode !== 'open' && promises.test(money)),
      `studio onboarding=${mode}` + (promises.test(money) ? ` — site says ${JSON.stringify((money.match(promises)||[])[0])}` : ''));
  }

  await browser.close();
  const bad = R.filter(r=>!r.ok);
  console.log(`\n${R.length-bad.length}/${R.length} claims held`);
  if (RELAY_RETRIES.length) console.log(`(${RELAY_RETRIES.length} request(s) retried after a dropped connection — transport, not the app)`);
  if (bad.length) { console.log('\nBROKEN CLAIMS:'); bad.forEach(b=>console.log(' -',b.claim, b.detail?('— '+b.detail):'')); }
})();
