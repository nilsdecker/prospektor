// Drives the BUILT site in a real browser with the two Netlify functions
// mocked, so the client wiring is exercised end to end before it goes live.
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = require('path').join(__dirname, '..', '_site');

const { serve } = require('./serve');

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, x !== undefined ? JSON.stringify(x) : ''); } };

(async () => {
  const server = await serve(ROOT, 8899);
  const browser = await chromium.launch({ executablePath: CHROME });

  // `session` decides what the mocked create-checkout-session POST returns.
  async function open(session, { probeOk = true } = {}) {
    const page = await browser.newPage();
    const posts = [];
    await page.route('**/.netlify/functions/create-checkout-session', async route => {
      if (route.request().method() === 'GET') {
        return route.fulfill(probeOk
          ? { status: 200, body: JSON.stringify({ configured: true }) }
          : { status: 503, body: JSON.stringify({ error: 'not open' }) });
      }
      posts.push(JSON.parse(route.request().postData()));
      const r = session(posts.length);
      return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
    });
    // Nothing should ever leave for Stripe in a test.
    await page.route('https://checkout.stripe.com/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>STRIPE CHECKOUT</h1>' }));
    await page.goto('http://localhost:8899/#pricing');
    return { page, posts };
  }

  const OK = { status: 200, body: { url: 'https://checkout.stripe.com/c/pay/cs_live_1' } };

  // 1 — keys present: the form replaces the /checkout/ link
  {
    const { page, posts } = await open(() => OK);
    await page.waitForSelector('#buyForm:not([hidden])', { timeout: 5000 });
    check('form revealed when keys exist', await page.isVisible('#buyForm'));
    check('/checkout/ link hidden', !(await page.isVisible('#buyLink')));
    check('live microcopy shown', await page.isVisible('#buyLive'));

    await page.fill('#buyEmail', 'buyer@acme.com');
    await page.click('#buyBtn');
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 5000 });
    check('a work email lands on Stripe', page.url().startsWith('https://checkout.stripe.com/'), page.url());
    check('one POST, carrying the email', posts.length === 1 && posts[0].email === 'buyer@acme.com', posts);
    check('marked as the pricing entry point', posts[0].from === 'pricing');
    check('no goal sentence collected', !posts[0].goal);
    await page.close();
  }

  // 2 — free-mail: 422 reveals the website field, second submit goes through
  {
    const { page, posts } = await open(n => n === 1
      ? { status: 422, body: { need: 'website', error: 'That’s a personal address, so it doesn’t tell us who to research. What’s your company’s website?' } }
      : OK);
    await page.waitForSelector('#buyForm:not([hidden])');
    await page.fill('#buyEmail', 'buyer@gmail.com');
    await page.click('#buyBtn');
    await page.waitForSelector('#buySite:not([hidden])', { timeout: 5000 });
    check('422 reveals the website field', await page.isVisible('#buySite'));
    check('422 message shown', /personal address/.test(await page.textContent('#buyMsg')));
    check('button re-enabled after 422', !(await page.isDisabled('#buyBtn')));
    await page.fill('#buySite', 'https://www.acme.com/');
    await page.click('#buyBtn');
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 5000 });
    check('second submit reaches Stripe', page.url().startsWith('https://checkout.stripe.com/'));
    check('website rode along', posts[1].domain === 'https://www.acme.com/', posts[1]);
    await page.close();
  }

  // 2b — /checkout/'s marketing box (#204): unticked by default, genuinely
  // optional, and the POST says exactly what the buyer did — false unticked,
  // true ticked. The box must never block the sale either way.
  for (const tick of [false, true]) {
    const page = await browser.newPage();
    const posts = [];
    await page.route('**/.netlify/functions/create-checkout-session', async route => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, body: JSON.stringify({ configured: true }) });
      }
      posts.push(JSON.parse(route.request().postData()));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OK.body) });
    });
    await page.route('**/.netlify/functions/check-email', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ taken: false }) }));
    await page.route('https://checkout.stripe.com/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>STRIPE CHECKOUT</h1>' }));
    await page.goto('http://localhost:8899/checkout/?domain=acme.com');
    await page.click('#toPayBtn');
    await page.waitForSelector('#stripeForm', { state: 'visible', timeout: 5000 });
    if (!tick) check('the marketing box starts unticked', !(await page.isChecked('#payMarketing')));
    if (tick) await page.check('#payMarketing');
    await page.fill('#payEmail', 'buyer@acme.com');
    await page.click('#stripeBtn');
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 5000 });
    check(`${tick ? 'ticked' : 'unticked'} box reaches the server as marketing:${tick}`,
      posts.length === 1 && posts[0].marketing === tick, posts);
    await page.close();
  }

  // 3 — the guard: 409 blocks, offers sign-in, never leaves the page
  {
    const { page } = await open(() => ({ status: 409, body: {
      error: 'Acme GmbH already has a studio and your address gets in — just sign in, there is nothing to buy twice.',
      reason: 'domain', signin: 'https://studio.prospektor.ai' } }));
    await page.waitForSelector('#buyForm:not([hidden])');
    await page.fill('#buyEmail', 'colleague@acme.com');
    await page.click('#buyBtn');
    await page.waitForSelector('#buyMsg:not([hidden])', { timeout: 5000 });
    check('409 keeps the buyer on the page', !page.url().includes('stripe.com'), page.url());
    check('409 shows the company sentence', /Acme GmbH already has a studio/.test(await page.textContent('#buyMsg')));
    check('409 offers a sign-in link',
      (await page.getAttribute('#buyMsg a', 'href')) === 'https://studio.prospektor.ai');
    check('button usable again', !(await page.isDisabled('#buyBtn')));
    await page.close();
  }

  // 4 — bad email never reaches the server
  {
    const { page, posts } = await open(() => OK);
    await page.waitForSelector('#buyForm:not([hidden])');
    await page.fill('#buyEmail', 'not-an-email');
    await page.click('#buyBtn');
    await page.waitForSelector('#buyMsg:not([hidden])');
    check('bad email caught client-side', posts.length === 0);
    await page.close();
  }

  // 5 — no keys: the page keeps the working /checkout/ link
  {
    const { page } = await open(() => OK, { probeOk: false });
    await page.waitForTimeout(600);
    check('no keys → /checkout/ link stays', await page.isVisible('#buyLink'));
    check('no keys → no pay form', !(await page.isVisible('#buyForm')));
    check('no keys → link still points at /checkout/',
      (await page.getAttribute('#buyLink', 'href')) === '/checkout/');
    await page.close();
  }

  // 6 — the scan path is untouched
  {
    const { page } = await open(() => OK);
    check('scan result CTA still goes to /checkout/',
      (await page.getAttribute('#scanCta', 'href')) === '/checkout/');
    check('scan fallback CTA still goes to /checkout/',
      (await page.getAttribute('#scanFallbackCta', 'href')) === '/checkout/');
    await page.close();
  }

  // 6b — #207: where /#scan actually parks the viewport. This is the check
  //      that would have caught the bug, and no static assertion could: the
  //      id was valid, the link was valid, and the browser did exactly what
  //      it was told — it scrolled .scan-hero's top edge to y=0, which is
  //      where the fixed nav is. Measured, at the two widths that differ.
  {
    for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport: vp });
      await page.goto('http://localhost:8899/#scan');
      await page.waitForTimeout(1200); // html { scroll-behavior: smooth }
      const m = await page.evaluate(() => {
        const b = el => el.getBoundingClientRect();
        return {
          navBottom: b(document.querySelector('nav')).bottom,
          formTop: b(document.querySelector('.scan-form')).top,
          formBottom: b(document.querySelector('.scan-form')).bottom,
          h1Top: b(document.querySelector('.hero h1')).top,
          vh: window.innerHeight,
        };
      });
      const w = `${vp.width}px`;
      check(`#scan leaves the field clear of the nav (${w})`,
        m.formTop >= m.navBottom, m);
      check(`#scan leaves the whole field on screen (${w})`,
        m.formBottom <= m.vh, m);
      check(`#scan keeps the headline in view (${w})`,
        m.h1Top >= m.navBottom && m.h1Top < m.vh, m);
      await page.close();
    }
    // The caret lands in the field on a pointer that has a keyboard, and the
    // fragment jump alone does not do that — a <section> is not focusable, so
    // without scan.js focus stays on <body> and Tab restarts at the nav.
    {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto('http://localhost:8899/#scan');
      await page.waitForTimeout(1200);
      check('#scan puts the caret in the scan field',
        (await page.evaluate(() => document.activeElement.id)) === 'scanInput');
      await page.close();
    }
    // ...and does not, on a touch device, where it would spring the on-screen
    // keyboard open and shove the hero back off the screen.
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      const page = await ctx.newPage();
      await page.goto('http://localhost:8899/#scan');
      await page.waitForTimeout(1200);
      check('#scan does not open the keyboard on touch',
        (await page.evaluate(() => document.activeElement.id)) !== 'scanInput');
      await ctx.close();
    }
  }

  // 6c — #240: the scan result is one card the width of the search bar.
  //      Geometry again, like 6b, because that was the literal complaint
  //      ("not sure why it's not the width of the search bar") — and the
  //      signal bullets must stay unrendered even when the scan returns them.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('https://studio.prospektor.ai/api/scan**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        domain: 'acme.com', status: 'done', mode: 'live',
        result: {
          name: 'Acme GmbH',
          summary: 'Acme sells anvils to coyotes.',
          inferredGoal: 'Mid-size property managers in the DACH region.',
          signals: ['Your pricing page lists three tiers.', 'Your case studies name two logos.'],
          facts: ['B2B SaaS', 'Berlin', '40 employees'],
        },
      }) }));
    await page.goto('http://localhost:8899/');
    await page.fill('#scanInput', 'acme.com');
    await page.click('#scanBtn');
    await page.waitForSelector('#scanResult:not([hidden])', { timeout: 5000 });
    const m = await page.evaluate(() => {
      const b = el => el.getBoundingClientRect();
      return {
        formW: b(document.querySelector('.scan-form')).width,
        cardW: b(document.querySelector('.scan-card')).width,
        name: document.getElementById('scanName').textContent,
        domain: document.getElementById('scanDomain').textContent,
        chips: document.querySelectorAll('#scanFacts span').length,
        signals: document.querySelectorAll('.scan-signals li, #scanSignals li').length,
        guess: document.getElementById('scanGuess').textContent,
      };
    });
    check('the result card is the width of the search bar (#240)',
      Math.abs(m.cardW - m.formW) < 1, m);
    check('the card leads with the company, domain beside it',
      m.name === 'Acme GmbH' && m.domain === 'acme.com', m);
    check('facts render as chips', m.chips === 3, m);
    check('the evidence bullets are gone — the client knows themselves (#240)',
      m.signals === 0, m);
    check('the proposal still leads the card', m.guess.length > 0, m);
    check('the CTA carries the scan into checkout',
      (await page.getAttribute('#scanCta', 'href')) === '/checkout/?domain=acme.com&company=Acme+GmbH');
    // #419: the free run is the card's primary action, and it opens on the
    // company the card is describing — the run page starts from ?domain= on
    // arrival, so nobody types their site twice. The resolved domain is sent,
    // not the raw string typed.
    check('the free run opens on the scanned domain (#419)',
      (await page.getAttribute('#scanRunCta', 'href')) === 'https://studio.prospektor.ai/r?domain=acme.com');
    check('the free run is the primary action, checkout the quiet one (#418)',
      (await page.getAttribute('#scanRunCta', 'class')) === 'btn-cta'
      && (await page.getAttribute('#scanCta', 'class')) === null);
    await page.close();
  }

  // 6c-ii — #419 at the width that breaks buttons. Style rule 9: a label that
  //      wraps mid-phrase gets shorter, not smaller. The free-run button is a
  //      longer label than the one it replaced, so it is measured rather than
  //      eyeballed — and both actions must stay inside the card, since the
  //      card is pinned to the search bar's width (#240).
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('https://studio.prospektor.ai/api/scan**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        domain: 'acme.com', status: 'done', mode: 'live',
        result: { name: 'Acme GmbH', inferredGoal: 'Mid-size property managers in the DACH region.', facts: ['B2B SaaS'] },
      }) }));
    await page.goto('http://localhost:8899/');
    await page.fill('#scanInput', 'acme.com');
    await page.click('#scanBtn');
    await page.waitForSelector('#scanResult:not([hidden])', { timeout: 5000 });
    const g = await page.evaluate(() => {
      const b = el => el.getBoundingClientRect();
      const run = document.getElementById('scanRunCta');
      const card = document.querySelector('.scan-card');
      // Line boxes, counted rather than inferred: .btn-cta inherits
      // `line-height: normal`, which computes to the string "normal" and
      // parses to NaN, so height-over-line-height cannot answer this. A Range
      // over the label reports one client rect per line the text actually
      // occupies, which is the question rule 9 asks.
      const r = document.createRange();
      r.selectNodeContents(run);
      return {
        lines: r.getClientRects().length,
        runRight: b(run).right, cardRight: b(card).right,
        payVisible: !!document.getElementById('scanCta').getClientRects().length,
      };
    });
    check('the free-run button holds one line at 390px (rule 9)',
      g.lines === 1, g);
    check('the free-run button stays inside the card at 390px',
      g.runRight <= g.cardRight + 1, g);
    check('the way to pay is still on screen at 390px',
      g.payVisible, g);
    await page.close();
  }

  // 6d — #242/#243: the target step's title holds one line at both widths,
  //      the payment step says what the email field is for, and the step-4
  //      preview (button and panel) is gone — done/ tells that story now.
  {
    for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport: vp });
      await page.goto('http://localhost:8899/checkout/?domain=acme.com');
      const t = await page.evaluate(() => {
        const el = document.querySelector('#panelTarget .onboard-h1');
        const lh = parseFloat(getComputedStyle(el).lineHeight);
        return { lines: Math.round(el.getBoundingClientRect().height / lh) };
      });
      check(`the target title sits on one line (#242, ${vp.width}px)`, t.lines === 1, t);
      await page.close();
    }
    const { page } = await open(() => OK);
    await page.goto('http://localhost:8899/checkout/?domain=acme.com');
    check('the after-payment preview button is gone (#243)',
      (await page.$('#toSigninBtn')) === null && (await page.$('#panelSignin')) === null);
    await page.click('#toPayBtn');
    await page.waitForSelector('#stripePay:not([hidden])', { timeout: 5000 });
    check('the email field says what it is for (#243)',
      ((await page.textContent('.pay-label')) || '').includes('sign-in email'));
    check('the sign-in step stays a future step on the payment screen',
      (await page.evaluate(() =>
        [...document.querySelectorAll('#steps .step')].pop().className.trim())) === 'step');
    await page.close();
  }

  // 6e — #244: /checkout/done/ confirms what was actually bought. With a
  //      session id it shows the real amount (the operator's $0.01 case) and
  //      the address; without one it keeps its generic card and breaks
  //      nothing — and either way the stashed scan is cleared.
  {
    const page = await browser.newPage();
    await page.route('**/.netlify/functions/checkout-session-status**', route =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ paid: true, amount_total: 1, currency: 'usd', email: 'buyer@acme.com' }) }));
    await page.goto('http://localhost:8899/');
    await page.evaluate(() => sessionStorage.setItem('prospektor.scan', '{"domain":"acme.com"}'));
    await page.goto('http://localhost:8899/checkout/done/?session_id=cs_test_abcdefghij');
    await page.waitForSelector('#confirmPaid:not([hidden])', { timeout: 5000 });
    check('done shows what actually left the card (#244)',
      (await page.textContent('#confirmAmount')) === '$0.01');
    check('done shows the sign-in address (#244)',
      (await page.textContent('#confirmAddress')) === 'buyer@acme.com');
    check('done clears the stashed scan',
      (await page.evaluate(() => sessionStorage.getItem('prospektor.scan'))) === null);
    await page.close();

    const bare = await browser.newPage();
    await bare.route('**/.netlify/functions/checkout-session-status**', route =>
      route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Not configured' }) }));
    await bare.goto('http://localhost:8899/checkout/done/');
    check('done without a session keeps the generic confirmation',
      (await bare.isVisible('#confirmCard'))
      && !(await bare.isVisible('#confirmPaid'))
      && !(await bare.isVisible('#confirmEmail')));
    check('done still promises the Stripe receipt',
      ((await bare.textContent('#confirmCard')) || '').includes('receipt'));
    await bare.close();
  }

  // 7 — the help hub, and search answering the operator's own question
  //     (#145/#136, re-pointed by #166). Nothing is mocked before the first
  //     assertions on purpose: everything here has to be true of the HTML the
  //     build wrote, because that is what a crawler and a reader with a slow
  //     studio get.
  {
    const SNAPSHOT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'help-corpus.json'), 'utf8'));
    const page = await browser.newPage();
    // Same corpus the build used: the reconcile should decide there is
    // nothing to do and touch no DOM at all.
    let calls = 0;
    await page.route('https://studio.prospektor.ai/api/help', route => {
      calls++;
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ files: SNAPSHOT.files }) });
    });
    await page.goto('http://localhost:8899/help/');

    const guides = SNAPSHOT.files.length;
    check('the hub shows a card per guide',
      (await page.$$eval('.card', n => n.length)) === guides);
    check('and every card is a link to that guide\'s own page (#166)',
      (await page.$$eval('.card > a', as => as.map(a => a.getAttribute('href'))))
        .every(h => /^\/help\/[a-z0-9-]+\/$/.test(h)));
    check('nothing is stacked on the hub any more',
      (await page.$$eval('#helpGuides .help-guide', n => n.length)) === 0);
    check('the search box the operator kept is present', await page.isVisible('#helpSearch'));

    // The bug this row exists for.
    await page.fill('#helpSearch', 'how can I create a new workspace');
    await page.waitForSelector('#helpResults:not([hidden])', { timeout: 5000 });
    const results = await page.textContent('#helpResults');
    check("the operator's question finds the workspace guide", /Workspace settings/.test(results), results.slice(0, 120));
    check('the answer is in the snippet', /client workspace/i.test(results));
    check('search marks the matched words', await page.isVisible('#helpResults mark'));
    check('the card hub steps aside while searching', await page.isHidden('#helpHub'));

    // A hit is a navigation now, not a scroll — and it still has to land on
    // the SECTION. Accepting the guide's own URL here would hide the same
    // undefined-anchor bug the pre-#166 check was written for.
    await page.click('#helpResults .help-hit-snippet');
    await page.waitForURL(/\/help\/workspace\//, { timeout: 5000 });
    check('a result click opens the guide on its own URL',
      /\/help\/workspace\/#workspace--/.test(page.url()), page.url());
    check('and the section it named is really on that page',
      await page.isVisible('#' + decodeURIComponent(page.url().split('#')[1])));

    await page.goBack();
    await page.fill('#helpSearch', 'zzzunfindable');
    await page.waitForSelector('#helpResults:not([hidden])');
    check('a miss says so instead of an empty pane', /Nothing in the guides/.test(await page.textContent('#helpResults')));

    // ── no double render ──
    // Wait for the fetch to land, then give the page a moment in which a
    // wrong implementation would re-render. Matching corpora produce no DOM
    // signal at all, which is the point — so the check is that nothing moved.
    for (let i = 0; i < 100 && calls === 0; i++) await page.waitForTimeout(20);
    await page.waitForTimeout(150);
    check('the live corpus was fetched', calls >= 1);
    check('an unchanged corpus re-renders nothing',
      (await page.getAttribute('#helpGuides', 'data-corpus-source')) !== 'runtime');
    check('and no guide was pulled back onto the hub',
      (await page.$$eval('#helpGuides .help-guide', n => n.length)) === 0);
    await page.close();
  }

  // 7b — a guide on its own URL (#166): the page a search result now opens,
  //      and the reason the row could be built without giving up #76.
  {
    const SNAPSHOT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'help-corpus.json'), 'utf8'));
    const page = await browser.newPage();
    await page.route('https://studio.prospektor.ai/api/help', route =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ files: SNAPSHOT.files }) }));
    await page.goto('http://localhost:8899/help/workspace/');

    check('the guide is served whole, before any fetch',
      /New client workspace/.test(await page.textContent('#guide-workspace')));
    // The title is the corpus's, not this file's — the studio retitles guides
    // and a literal here pinned its content (the #131 rule; it bit at the 7 Sep
    // snapshot refresh, when this said "Workspace settings, members, billing").
    const workspaceTitle = SNAPSHOT.files.find(f => f.name === '08-workspace.md')
      .text.split('\n')[0].replace(/^#\s*/, '').trim();
    check('its title is the page\'s h1, said once',
      (await page.$$eval('h1', hs => hs.map(h => h.textContent.trim())))
        .join('|') === workspaceTitle);
    check('studio-relative links point at the studio',
      (await page.getAttribute('.help-guide a[target="_blank"]', 'href') || '').startsWith('https://studio.prospektor.ai/'));
    check('there is a way back to the hub', await page.isVisible('.res-back'));
    check('and three sibling guides to keep reading',
      (await page.$$eval('.help-more .res-more-list a', as => as.length)) === 3);

    // The renderer's two structural outputs, checked on whichever guide
    // actually uses them rather than on a slug written down here — the corpus
    // is the studio's and it moves.
    const guideUsing = re => {
      const f = SNAPSHOT.files.find(f => re.test(f.text));
      return f && f.name.replace(/^\d+-/, '').replace(/\.md$/, '');
    };
    for (const [what, slug, selector] of [
      ['tables', guideUsing(/^\|[\s:|-]+\|?\s*$/m), '.help-guide table'],
      ['nested lists', guideUsing(/^\s{2,}[-*]\s+\S/m), '.help-guide li ul li'],
    ]) {
      if (!slug) { check(what + ' — no guide in the corpus uses them', true); continue; }
      await page.goto('http://localhost:8899/help/' + slug + '/');
      check(what + ' render, on /help/' + slug + '/', await page.isVisible(selector));
    }
    await page.goto('http://localhost:8899/help/workspace/');
    await page.waitForTimeout(200);
    check('an unchanged guide re-renders nothing',
      (await page.getAttribute('#guide-workspace', 'data-guide-source')) !== 'runtime');
    await page.close();
  }

  // 7c — the studio HAS moved on since the build. This is #76's property and
  //      #166 was not allowed to cost it: a help change is live for a reader
  //      the moment the STUDIO deploys, with no website publish in between.
  //      Two shapes, and they are handled differently on purpose.
  {
    const SNAPSHOT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'help-corpus.json'), 'utf8'));

    // (a) an EDITED guide — it has a page, so the page corrects itself.
    {
      const edited = {
        files: SNAPSHOT.files.map(f => f.name.indexOf('workspace') > -1
          ? { name: f.name, text: f.text + '\n\n## Freshly added section\n\nShipped by the studio after this site was built.\n' }
          : f),
      };
      const page = await browser.newPage();
      await page.route('https://studio.prospektor.ai/api/help', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(edited) }));
      await page.goto('http://localhost:8899/help/workspace/');
      await page.waitForSelector('#workspace--freshly-added-section', { timeout: 5000 });
      check('an edited guide is corrected on its own page at runtime (#76)',
        await page.isVisible('#workspace--freshly-added-section'));
      check('and the page says the copy on screen came from the studio',
        (await page.getAttribute('#guide-workspace', 'data-guide-source')) === 'runtime');
      check('the title is still said exactly once after a re-render',
        (await page.$$eval('h1', hs => hs.length)) === 1
        && (await page.$$eval('#guide-workspace h2', hs => hs.map(h => h.textContent)))
             .every(t => t !== 'Workspace settings, members, billing'));
      await page.close();
    }

    // (b) a NEW guide — it has no page until the next build, so the hub
    //     renders it inline and links it by anchor. That is the whole answer
    //     to the cost the board row put against this work.
    {
      const moved = { files: SNAPSHOT.files.concat([{ name: '99-brand-new.md', text: '# A brand new guide\n\nShipped by the studio after this site was built.\n' }]) };
      const page = await browser.newPage();
      await page.route('https://studio.prospektor.ai/api/help', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(moved) }));
      await page.goto('http://localhost:8899/help/');
      await page.waitForSelector('#guide-brand-new', { timeout: 5000 });
      check('a guide the build never saw is readable immediately (#76)',
        /Shipped by the studio/.test(await page.textContent('#guide-brand-new')));
      check('the hub gained its card',
        (await page.$$eval('.card', n => n.length)) === moved.files.length);
      check('and that card points at the anchor, having no page yet',
        (await page.getAttribute('.card:last-child > a', 'href')) === '#guide-brand-new');
      check('while the guides that DO have pages are still linked to them',
        (await page.getAttribute('.card:first-child > a', 'href')) === '/help/getting-started/');
      check('and none of them was pulled back onto the hub',
        (await page.$$eval('#helpGuides .help-guide', n => n.length)) === 1);
      check('the reconcile said so',
        (await page.getAttribute('#helpGuides', 'data-corpus-source')) === 'runtime');
      check('an unknown guide still gets a card',
        /Guide/.test(await page.textContent('#guide-brand-new .help-guide-topic')));
      await page.close();
    }
  }

  // 7d — the old anchors still land somewhere real. Three generations of link
  //      exist in the wild (the studio's docs, the FAQ, anything anyone
  //      bookmarked), and #166 moved what they pointed at.
  {
    const page = await browser.newPage();
    await page.route('https://studio.prospektor.ai/api/help', route =>
      route.fulfill({ status: 502, body: 'bad gateway' }));

    for (const [from, to] of [
      ['#guide-sharing', '/help/sharing/'],
      ['#sharing', '/help/sharing/'],
      ['#workspace--members-and-access', '/help/workspace/#workspace--members-and-access'],
    ]) {
      await page.goto('http://localhost:8899/help/' + from);
      await page.waitForURL(u => u.pathname !== '/help/', { timeout: 5000 }).catch(() => {});
      const got = page.url().replace('http://localhost:8899', '');
      check('/help/' + from + ' forwards to ' + to, got === to, got);
    }
    await page.close();
  }

  // 8 — the studio unreachable. Before #136 this was the honest error state,
  //     because the page had nothing without the fetch. Now the guides are in
  //     the HTML, so a dead studio costs freshness and nothing else — and
  //     showing an error over a page full of answers would be a lie.
  {
    const page = await browser.newPage();
    await page.route('https://studio.prospektor.ai/api/help', route =>
      route.fulfill({ status: 502, body: 'bad gateway' }));

    await page.goto('http://localhost:8899/help/workspace/');
    check('a dead studio leaves the prerendered guide on screen',
      /New client workspace/.test(await page.textContent('#guide-workspace')));
    // The error is its own element, not a phrase: the corpus itself may say
    // "could not be loaded" (the troubleshooting guide does since 7 Sep).
    check('and shows no error over it', !(await page.$('#helpRetry')));

    await page.goto('http://localhost:8899/help/');
    await page.waitForSelector('.card', { timeout: 5000 });
    check('and the hub still lists every guide',
      (await page.$$eval('.card', n => n.length)) > 0);
    check('search still works with the studio down',
      await (async () => {
        await page.fill('#helpSearch', 'how can I create a new workspace');
        await page.waitForSelector('#helpResults:not([hidden])', { timeout: 5000 });
        return /Workspace settings/.test(await page.textContent('#helpResults'));
      })());
    await page.close();
  }

  // 8b — the studio that HANGS (#185). Section 8 above proves a *dead* studio
  //      is survivable, and it always was: a 502 rejects the promise, the
  //      catch runs, the prerendered page is announced as the copy on screen.
  //      A studio that accepts the connection and then says nothing never
  //      rejected anything, so none of that ran — the request just stayed open
  //      behind the page. These three checks are the difference, and the route
  //      below is the fixture: it is never fulfilled, ever.
  {
    const hang = route => new Promise(() => {});   // accepted, never answered

    // (a) the hub. The reader has every guide from the HTML, so the only
    //     visible difference a hang may make is none at all — but the deadline
    //     has to actually fire, and the console line is how that is observable
    //     from out here. Before this row it never appeared.
    {
      const page = await browser.newPage();
      const said = [];
      page.on('console', m => said.push(m.text()));
      await page.route('https://studio.prospektor.ai/api/help', hang);
      await page.goto('http://localhost:8899/help/');
      check('a hanging studio leaves the hub whole',
        (await page.$$eval('.card', n => n.length)) > 0);
      await page.waitForTimeout(4000);            // the 3s deadline, plus slack
      check('and the fetch gives up rather than staying open',
        said.some(t => /could not be read/.test(t)), said);
      check('with no error shown over a page full of answers',
        !(await page.$('#helpRetry')));
      await page.close();
    }

    // (b) a guide on its own URL. Same rule, narrower: the built copy stays,
    //     and it is never re-stamped as having come from the studio.
    {
      const page = await browser.newPage();
      const said = [];
      page.on('console', m => said.push(m.text()));
      await page.route('https://studio.prospektor.ai/api/help', hang);
      await page.goto('http://localhost:8899/help/workspace/');
      await page.waitForTimeout(4000);
      check('a hanging studio leaves the prerendered guide on screen',
        /New client workspace/.test(await page.textContent('#guide-workspace')));
      check('and the guide page gives up too',
        said.some(t => /could not be read/.test(t)), said);
      check('and does not claim the copy came from the studio',
        (await page.getAttribute('#guide-workspace', 'data-guide-source')) !== 'runtime');
      await page.close();
    }

    // (c) the case the deadline is really for: a build that prerendered
    //     NOTHING (studio unreachable at build time too), meeting a studio
    //     that hangs at runtime. The reader has no guides and no way to ask
    //     for them again — before #185 the promise never settled, so the
    //     "Try again" offer was never made and the hub sat empty for good.
    //     The served HTML is rewritten here to be that build.
    {
      const page = await browser.newPage();
      await page.route('http://localhost:8899/help/', async route => {
        const res = await route.fetch();
        const html = (await res.text())
          .replace(/(<script type="application\/json" id="helpCorpus">)[\s\S]*?(<\/script>)/, '$1{}$2');
        return route.fulfill({ response: res, body: html });
      });
      await page.route('https://studio.prospektor.ai/api/help', hang);
      await page.goto('http://localhost:8899/help/');
      await page.waitForSelector('#helpRetry', { timeout: 8000 }).catch(() => {});
      check('with nothing prerendered, a hang is offered as retryable',
        await page.isVisible('#helpRetry'));
      check('and says the studio did not answer in time',
        /did not answer in time/.test(await page.textContent('body')));
      await page.close();
    }
  }

  // 9 — what a crawler is served: robots.txt, the sitemap, and the Search
  //     Console verification hook (#135).
  //
  //     A sitemap that lists a URL the site does not serve is the single most
  //     common thing Search Console reports as an error, and it is invisible
  //     until Google says so days later. Every <loc> is fetched here, from the
  //     built output, before it can be submitted.
  {
    const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
    check('robots.txt allows crawling and names the sitemap',
      /User-agent:\s*\*/.test(robots) && /Allow:\s*\//.test(robots)
      && /Sitemap:\s*https:\/\/prospektor\.ai\/sitemap\.xml/.test(robots), robots);

    const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    // Two halves, because one of them grows. The STATIC list stays an exact
    // match — that is what stops a page slipping into the sitemap without its
    // reason being argued (#135). The articles cannot be an exact list, since
    // #144 adds one every time somebody writes one, so they are checked
    // structurally instead: every non-static entry must be an article that
    // exists in src/resources/, and every article must be listed.
    const STATIC = ['https://prospektor.ai/',
                    'https://prospektor.ai/who-to-pitch/', 'https://prospektor.ai/what-to-send/',
                    'https://prospektor.ai/pricing/',
                    'https://prospektor.ai/privacy/',
                    'https://prospektor.ai/terms/', 'https://prospektor.ai/resources/',
                    'https://prospektor.ai/help/',
                    // #456. A static page like the rest, and it carries no
                    // <lastmod> for the same reason they don't. It is listed
                    // here because anything NOT in this list is treated as an
                    // article below — so a new static page that is forgotten
                    // here fails as "one article too many, and it has no date",
                    // which names neither the page nor the cause.
                    'https://prospektor.ai/contact/'];
    // #114: each static page is followed by its twins in every language the
    // build wrote it in — derived from lib/i18n.js and the built tree, the
    // same way sitemap.njk derives them, so a new language or a newly
    // translated page changes nothing here. The list of ENGLISH statics stays
    // exact, for #135's reason.
    const i18n = require('../lib/i18n.js');
    const staticWithTwins = STATIC.flatMap(loc => i18n.built().map(l =>
      'https://prospektor.ai' + i18n.twin(loc.replace('https://prospektor.ai', ''), l.code))
      .filter(u => fs.existsSync(path.join(ROOT, new URL(u).pathname, 'index.html'))));
    const derived = locs.filter(l => !staticWithTwins.includes(l));
    const guideLocs = derived.filter(l => l.startsWith('https://prospektor.ai/help/'));
    const articleLocs = derived.filter(l => !l.startsWith('https://prospektor.ai/help/'));
    check('sitemap lists exactly the static pages we want ranked, each with its built twins',
      JSON.stringify(locs.slice(0, staticWithTwins.length)) === JSON.stringify(staticWithTwins), locs);
    check('the Spanish funnel is in the sitemap beside its English pages (#114)',
      staticWithTwins.includes('https://prospektor.ai/es/') && staticWithTwins.includes('https://prospektor.ai/es/pricing/')
      && !staticWithTwins.includes('https://prospektor.ai/es/help/'), staticWithTwins);

    const slugs = fs.readdirSync(path.join(__dirname, '..', 'src', 'resources'))
      .filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));
    check('sitemap lists every /resources/ article and nothing else besides',
      articleLocs.length === slugs.length
      && slugs.every(s => articleLocs.includes('https://prospektor.ai/resources/' + s + '/')),
      { listed: articleLocs.length, onDisk: slugs.length });

    // The guide URLs, the same way (#166): derived from the corpus rather than
    // listed, so a guide the studio adds is submitted at the next build and one
    // it retires stops being submitted, with nobody editing sitemap.njk.
    const guideSlugs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'help-corpus.json'), 'utf8'))
      .files.map(f => f.name.replace(/^\d+-/, '').replace(/\.md$/, ''));
    check('sitemap lists every help guide and nothing else under /help/',
      guideLocs.length === guideSlugs.length
      && guideSlugs.every(g => guideLocs.includes('https://prospektor.ai/help/' + g + '/')),
      { listed: guideLocs.length, inCorpus: guideSlugs.length });

    // A <lastmod> is a promise a crawler acts on, so it has to be a real date
    // rather than a build stamp — the terms #135 set for adding them at all.
    // The guides carry none, and deliberately: the corpus has no dates, and a
    // stamp taken at build time would claim every guide changed on every deploy.
    check('every article carries a real lastmod, and no static or guide page does',
      [...xml.matchAll(/<loc>([^<]+)<\/loc>(<lastmod>[^<]+<\/lastmod>)?/g)]
        .every(([, loc, mod]) => staticWithTwins.includes(loc) || guideLocs.includes(loc)
          ? mod === undefined
          : /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(mod || '')), xml);

    // Each of these is out for a reason written into src/sitemap.njk. If one
    // comes back, that reason has to be argued, not lost in a rebase.
    for (const [pathname, why] of [
      ['/checkout/', 'a form, not an answer to a search (#135)'],
      ['/checkout/done/', 'noindex — what a buyer reads after paying'],
      ['/app/', '301s, and W2 has not decided its future'],
      ['/404', 'noindex'],
    ]) check('sitemap keeps ' + pathname + ' out — ' + why, !locs.some(l => l.endsWith(pathname)));

    // /help/ is in the sitemap as of #136, and the reason it may be there is
    // that the guides are in the served bytes. Listing it while it is a shell
    // again would be the exact mistake #135 refused to make, so the sitemap
    // entry and the guarantee behind it are checked together. Since #166 the
    // guides are on their own URLs, so the guarantee is checked there.
    const helpHtml = fs.readFileSync(path.join(ROOT, 'help', 'index.html'), 'utf8');
    const workspaceHtml = fs.readFileSync(path.join(ROOT, 'help', 'workspace', 'index.html'), 'utf8');
    check('sitemap lists /help/ now that it serves real content (#136)',
      locs.includes('https://prospektor.ai/help/'));
    check('and neither the hub nor a guide is a Loading… shell',
      !/Loading…/.test(helpHtml) && !/Loading…/.test(workspaceHtml)
      && /New client workspace/.test(workspaceHtml));

    // Every listed URL must actually be served, and none of them may be
    // noindex — submitting a page we tell Google not to index is a
    // self-contradiction Search Console reports as an error.
    for (const loc of locs) {
      const p = new URL(loc).pathname;
      const res = await fetch('http://localhost:8899' + p);
      const html = await res.text();
      check('sitemap URL ' + p + ' is served', res.status === 200, res.status);
      check('sitemap URL ' + p + ' is not noindex', !/name="robots"[^>]*noindex/.test(html));
      check('sitemap URL ' + p + ' declares itself canonical at ' + loc,
        html.includes('<link rel="canonical" href="' + loc + '">'));
    }

    // The pages that are deliberately kept out of the index must say so in
    // their own HTML, not only by being absent from the sitemap.
    for (const p of ['/checkout/done/', '/404.html'])
      check('noindex still present on ' + p,
        /name="robots"[^>]*noindex/.test(fs.readFileSync(path.join(ROOT, p.replace(/\/$/, '/index.html')), 'utf8')));

    // The verification hook: absent while the key is empty (DNS TXT is the
    // route we took), and emitted the moment somebody pastes a token in — so
    // the fallback is known to work before it is ever needed in a hurry.
    check('no google-site-verification meta while the key is empty',
      !fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').includes('google-site-verification'));

    const dataFile = path.join(__dirname, '..', 'src', '_data', 'site.json');
    const original = fs.readFileSync(dataFile, 'utf8');
    const out = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsc-'));
    try {
      fs.writeFileSync(dataFile, original.replace('"googleSiteVerification": ""', '"googleSiteVerification": "TOKEN-UNDER-TEST"'));
      require('child_process').execSync('npx eleventy --quiet --output=' + out, { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
      const withToken = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
      check('a pasted token becomes the verification meta',
        withToken.includes('<meta name="google-site-verification" content="TOKEN-UNDER-TEST">'));
    } finally {
      fs.writeFileSync(dataFile, original);
      fs.rmSync(out, { recursive: true, force: true });
    }
  }

  // 10 — the consent gate (#143). The two checks the studio's `drive:consent`
  //      makes that matter here, ported: every request the browser makes stays
  //      on this origin, and a gated script does not load before consent —
  //      asserted against a real script tag pointing at a real URL, so a leak
  //      shows up as a fetch rather than as an opinion.
  {
    // The transform the edge function really runs, imported rather than
    // re-described, so this exercises the whole mechanism: Netlify's injected
    // tag in, inert handoff out, consent.js the only way back to a live tag.
    const { gateRumTag } = await import(
      require('url').pathToFileURL(path.join(__dirname, '..', 'netlify', 'edge-functions', 'rum-consent.js')).href);

    // Shaped exactly like the tag production serves, but pointing at a probe,
    // so "did the gate hold" is a request count and not a judgement call.
    const PROBE = '/__gated-probe.js';
    const INJECTED = '<script async id="netlify-rum-container" src="' + PROBE
      + '" data-netlify-cwv-token="probe-token"></script>';

    async function consentPage(pathname) {
      const page = await browser.newPage();
      const offOrigin = [];
      const probeHits = [];
      page.on('request', r => {
        const u = new URL(r.url());
        if (u.host !== 'localhost:8899') offOrigin.push(r.url());
      });
      await page.route('**' + PROBE, route => {
        probeHits.push(route.request().url());
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.__probeRan = true;' });
      });
      await page.route('http://localhost:8899' + pathname, route => {
        const file = path.join(ROOT, pathname.replace(/\/$/, '/index.html'));
        const served = fs.readFileSync(file, 'utf8').replace('</body>', INJECTED + '\n</body>');
        const gated = gateRumTag(served);
        return route.fulfill({ status: 200, contentType: 'text/html', body: gated === null ? served : gated });
      });
      await page.goto('http://localhost:8899' + pathname);
      return { page, offOrigin, probeHits };
    }

    const ran = page => page.evaluate(() => window.__probeRan === true);

    // 10a — first visit: the choice, and nothing loaded to go with it
    {
      const { page, offOrigin, probeHits } = await consentPage('/');
      await page.waitForSelector('.ppsc-bar', { timeout: 5000 });
      const buttons = await page.$$eval('.ppsc-bar .ppsc-btn, .ppsc-bar .ppsc-link', ns => ns.map(n => n.textContent));
      check('the banner is a choice, not a notice — RUM is declared', buttons.includes('Accept') && buttons.includes('Reject'), buttons);
      check('Accept and Reject are the same kind of button',
        (await page.$$('.ppsc-bar .ppsc-btn')).length === 2
        && (await page.$eval('.ppsc-bar .ppsc-btn', n => n.textContent)) === 'Reject', buttons);
      check('the gated script has not been fetched before an answer', probeHits.length === 0, probeHits);
      check('and it has not run', !(await ran(page)));
      check('every request stays on this origin', offOrigin.length === 0, offOrigin);
      await page.close();
    }

    // 10b — Reject: still nothing, and the answer sticks across a reload
    {
      const { page, probeHits } = await consentPage('/');
      await page.waitForSelector('.ppsc-bar');
      await page.click('.ppsc-bar .ppsc-btn-equal');
      await page.waitForTimeout(300);
      check('Reject loads nothing', probeHits.length === 0, probeHits);
      check('the bar is gone once answered', !(await page.isVisible('.ppsc-bar').catch(() => false)));
      await page.reload();
      await page.waitForTimeout(700);
      check('the answer is remembered, so the bar does not come back', (await page.$$('.ppsc-bar')).length === 0);
      check('and a rejected script stays unloaded on the next page view', probeHits.length === 0, probeHits);
      await page.close();
    }

    // 10c — Accept: the same tag now loads, from the same handoff
    {
      const { page, probeHits } = await consentPage('/');
      await page.waitForSelector('.ppsc-bar');
      await page.click('.ppsc-bar .ppsc-btn-primary');
      await page.waitForFunction(() => window.__probeRan === true, null, { timeout: 5000 }).catch(() => {});
      check('Accept loads the gated script', probeHits.length === 1, probeHits);
      check('and it really executes — the gate was the only thing holding it', await ran(page));
      await page.close();
    }

    // 10d — withdrawal is as easy as granting: the footer link, on a page
    //       that is not the front page
    {
      const { page } = await consentPage('/help/');
      await page.waitForSelector('.ppsc-bar');
      await page.click('footer a[data-cookies]');
      await page.waitForSelector('.ppsc-panel', { timeout: 5000 });
      check('the footer Cookies link opens the panel', await page.isVisible('.ppsc-panel'));
      const rows = await page.$$eval('.ppsc-table td:first-child', ns => ns.map(n => n.textContent));
      // Derived from consent.js's own INVENTORY rather than pinned to a
      // number (#131): a storage key added to the inventory — #114's
      // `prospektor.lang` was the first — must not turn this red by existing.
      const declared = (fs.readFileSync(path.join(__dirname, '..', 'src', 'assets', 'js', 'consent.js'), 'utf8')
        .match(/^\s+kind: '[^']+',$/gm) || []).length;
      check('the panel names every declared item', declared > 0 && rows.length === declared, { rows, declared });
      check('and names the one third party by name', rows.includes('Netlify Real User Metrics'), rows);
      await page.close();
    }

    // 10e — the same check over every page rather than one, and the one that
    //       earns its keep: it catches a font, a pixel or an SDK arriving by a
    //       route nobody thought to grep for, because it counts requests
    //       instead of reading source.
    //
    //       The allow-list is deliberately the audit's own (`audit-live.js`),
    //       so the two cannot disagree about what "somewhere else" means:
    //       localhost is where the built site is being served from, and
    //       studio.prospektor.ai is Prospektor — /help/ renders the studio's
    //       corpus over /api/help, which is a first-party call between two
    //       origins with one controller, not a disclosure to anybody. Every
    //       other host is a finding. Keep this list exact; a wildcard here
    //       would quietly retire the check.
    {
      const OURS = ['localhost:8899', 'prospektor.ai', 'studio.prospektor.ai'];
      const pages = ['/', '/who-to-pitch/', '/what-to-send/', '/pricing/', '/privacy/', '/terms/', '/checkout/', '/help/', '/help/workspace/', '/resources/', '/resources/who-to-approach/'];
      const strays = [];
      for (const pathname of pages) {
        const page = await browser.newPage();
        page.on('request', r => {
          if (!OURS.includes(new URL(r.url()).host)) strays.push(pathname + ' → ' + r.url());
        });
        await page.goto('http://localhost:8899' + pathname, { waitUntil: 'networkidle' });
        await page.close();
      }
      check('no page reaches a host that is not Prospektor', strays.length === 0, strays);
    }
  }

  // 10 — the header, in a browser (#153). The nav used to be three anchors
  //      onto the homepage; `test/pages.test.js` proves that from the built
  //      HTML, and this proves the other half — that clicking them actually
  //      arrives somewhere, and that the new /pricing/ page reaches Stripe by
  //      the same one-field path the homepage tile uses. A pricing page that
  //      looks right and quietly falls back to /checkout/ is the exact
  //      regression CLAUDE.md records having shipped once already.
  {
    const site = require('../src/_data/site.json');
    const page = await browser.newPage();
    // /help/ fetches the studio; nothing here needs the live corpus.
    await page.route('https://studio.prospektor.ai/api/help', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: [] }) }));

    for (const item of site.nav) {
      await page.goto('http://localhost:8899/');
      await page.click(`.nav-links a[href="${item.url}"]`);
      await page.waitForLoadState('domcontentloaded');
      const landed = new URL(page.url()).pathname;
      check(`nav "${item.label}" lands on ${item.url}`, landed === item.url, landed);
      check(`and ${item.url} is a real page, not the homepage again`,
        (await page.$$eval('h1', n => n.length)) > 0 && landed !== '/');
    }

    // The phone. .nav-links is display:none under 860px, so before #153 the
    // header had no items at all there — cheap when they were anchors onto
    // the page you were on, not cheap now that they are three pages.
    const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await m.goto('http://localhost:8899/');
    check('on a phone the nav is closed to start', !(await m.isVisible('.nav-links a')));
    check('and the toggle is the way in', await m.isVisible('#navToggle'));
    await m.click('#navToggle');
    await m.waitForSelector('.nav-links.is-open', { timeout: 3000 });
    for (const item of site.nav)
      check(`phone menu offers "${item.label}"`, await m.isVisible(`.nav-links a[href="${item.url}"]`));
    check('the toggle reports itself expanded',
      (await m.getAttribute('#navToggle', 'aria-expanded')) === 'true');
    await m.click('.nav-links a[href="/pricing/"]');
    await m.waitForLoadState('domcontentloaded');
    check('and following one arrives', new URL(m.url()).pathname === '/pricing/', m.url());
    await m.click('#navToggle');
    await m.keyboard.press('Escape');
    check('Escape closes it', !(await m.isVisible('.nav-links a')));
    await m.close();

    await page.goto('http://localhost:8899/who-to-pitch/');
    check('the WHO page offers the free scan', await page.isVisible('a[href="/#scan"]'));
    await page.goto('http://localhost:8899/what-to-send/');
    check('the WHAT page names every deliverable a run produces',
      (await page.$$eval('.card-title', n => n.map(e => e.textContent))).length === 6);
    await page.close();
  }

  // 11 — /pricing/ pays. Same mock as block 1, aimed at the new page.
  {
    const page = await browser.newPage();
    const posts = [];
    await page.route('**/.netlify/functions/create-checkout-session', async route => {
      if (route.request().method() === 'GET')
        return route.fulfill({ status: 200, body: JSON.stringify({ configured: true }) });
      posts.push(JSON.parse(route.request().postData()));
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_live_1' }) });
    });
    await page.route('https://checkout.stripe.com/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>STRIPE CHECKOUT</h1>' }));

    await page.goto('http://localhost:8899/pricing/');
    await page.waitForSelector('#buyForm:not([hidden])', { timeout: 5000 });
    check('/pricing/ reveals the one-field form when keys exist', await page.isVisible('#buyForm'));
    check('/pricing/ hides the multi-step fallback link', !(await page.isVisible('#buyLink')));
    await page.fill('#buyEmail', 'buyer@acme.com');
    await page.click('#buyBtn');
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 5000 });
    check('/pricing/ goes straight to Stripe', page.url().startsWith('https://checkout.stripe.com/'), page.url());
    check('carrying the email, once', posts.length === 1 && posts[0].email === 'buyer@acme.com', posts);
    await page.close();
  }

  // 12 — no keys: /pricing/ degrades to the page that still works, exactly
  //      as the homepage tile does.
  {
    const page = await browser.newPage();
    await page.route('**/.netlify/functions/create-checkout-session', route =>
      route.fulfill({ status: 503, body: JSON.stringify({ error: 'not open' }) }));
    await page.goto('http://localhost:8899/pricing/');
    await page.waitForTimeout(300);
    check('/pricing/ without keys keeps the /checkout/ link visible', await page.isVisible('#buyLink'));
    check('/pricing/ without keys shows no form', !(await page.isVisible('#buyForm')));
    await page.close();
  }

  // 14 — the funnel in Spanish (#114). The Spanish pages are the English ones
  //      through a catalogue, so what is worth driving is the seams: the
  //      scan's status line and error in Spanish, the pricing tile telling the
  //      server which language the buyer read, the nav landing on the Spanish
  //      twin where one exists and the English page where none does, the
  //      switcher going back, and the one rule the spec states in capitals —
  //      a Spanish browser on the English page is TOLD, never redirected.
  {
    const i18n = require('../lib/i18n.js');
    const ctx = await browser.newContext({ locale: 'es-ES' });
    const page = await ctx.newPage();
    const posts = [];
    await page.route('**/.netlify/functions/create-checkout-session', async route => {
      if (route.request().method() === 'GET') return route.fulfill({ status: 200, body: JSON.stringify({ configured: true }) });
      posts.push(JSON.parse(route.request().postData()));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_es' }) });
    });
    await page.route('https://checkout.stripe.com/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>STRIPE CHECKOUT</h1>' }));
    const scans = [];
    await page.route('https://studio.prospektor.ai/api/scan', async route => {
      if (route.request().method() === 'POST') {
        scans.push(JSON.parse(route.request().postData()));
        return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'nope' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    // A Spanish browser on the ENGLISH page: offered, not moved — one line
    // that is the link, one × to close it, nothing else, once (#544).
    await page.goto('http://localhost:8899/');
    await page.waitForSelector('#langSuggest', { timeout: 5000 });
    check('a Spanish browser on / is offered Spanish', await page.isVisible('#langSuggest'));
    check('and is NOT redirected', new URL(page.url()).pathname === '/', page.url());
    check('the offer is one line, in Spanish, and the line is the link', (await page.textContent('#langSuggest a')).trim() === 'Esta página también está en Español →');
    check('which links the Spanish twin', (await page.getAttribute('#langSuggest a', 'href')) === '/es/');
    check('one link and one close, nothing to explain', (await page.$$('#langSuggest > *')).length === 2 && (await page.$$('#langSuggest button')).length === 1);
    check('the close is named for a screen reader, in Spanish', (await page.getAttribute('#langSuggest button', 'aria-label')) === 'Ahora no');
    // Neither taken nor closed — the visitor just moves on. One time only.
    await page.goto('http://localhost:8899/pricing/');
    await page.waitForLoadState('domcontentloaded');
    check('ignored, it stays away on the next page — one time only (#544)', !(await page.$('#langSuggest')));
    check('because being shown is what is remembered', (await page.evaluate(() => localStorage.getItem('prospektor.lang'))) === 'en');
    // Closed: gone.
    await page.evaluate(() => localStorage.removeItem('prospektor.lang'));
    await page.goto('http://localhost:8899/');
    await page.waitForSelector('#langSuggest', { timeout: 5000 });
    await page.click('#langSuggest button');
    check('× removes the nudge', !(await page.$('#langSuggest')));
    // Taken: the language they went on in is what stays remembered.
    await page.evaluate(() => localStorage.removeItem('prospektor.lang'));
    await page.goto('http://localhost:8899/');
    await page.waitForSelector('#langSuggest', { timeout: 5000 });
    await page.click('#langSuggest a');
    await page.waitForLoadState('domcontentloaded');
    check('taking it lands on /es/', new URL(page.url()).pathname === '/es/', page.url());
    check('and remembers Spanish', (await page.evaluate(() => localStorage.getItem('prospektor.lang'))) === 'es');
    // English pages only: a Spanish browser on the German page chose it.
    await page.evaluate(() => localStorage.removeItem('prospektor.lang'));
    await page.goto('http://localhost:8899/de/');
    await page.waitForLoadState('domcontentloaded');
    check('no nudge on /de/ — the English pages only (#544)', !(await page.$('#langSuggest')));
    check('and nothing was remembered there', (await page.evaluate(() => localStorage.getItem('prospektor.lang'))) === null);

    // The Spanish page itself.
    await page.goto('http://localhost:8899/es/');
    await page.waitForLoadState('domcontentloaded');
    check('/es/ is Spanish', (await page.getAttribute('html', 'lang')) === 'es');
    check('no offer on the page already in the browser’s language', !(await page.$('#langSuggest')));
    check('the h1 is Spanish', /Encuentra leads/.test(await page.textContent('h1')));
    check('the scan hint is Spanish', /Gratis · sin registro/.test(await page.textContent('#scanHint')));
    await page.fill('#scanInput', 'acme.com');
    await page.click('#scanBtn');
    await page.waitForSelector('#scanError:not([hidden])', { timeout: 5000 });
    check('the scan’s 400 message is Spanish (scan.js says it through t)', /Eso no parece un dominio/.test(await page.textContent('#scanError')));
    check('the scan carried the page’s language to the studio', scans.length === 1 && scans[0].language === 'es', scans);

    // The nav: a twin where one was built, the English page where not.
    const built = i18n.built().map(l => l.code);
    check('Spanish is a built language', built.includes('es'), built);
    await page.click('.nav-links a[href="/es/pricing/"]');
    await page.waitForLoadState('domcontentloaded');
    check('Precio lands on /es/pricing/', new URL(page.url()).pathname === '/es/pricing/', page.url());
    check('the pricing h1 is Spanish', /Un precio/.test(await page.textContent('h1')));
    await page.waitForSelector('#buyForm:not([hidden])', { timeout: 5000 });
    await page.fill('#buyEmail', 'comprador@acme.es');
    await page.click('#buyBtn');
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 5000 });
    check('the Spanish pricing tile reaches Stripe', page.url().startsWith('https://checkout.stripe.com/'));
    check('and told the server the buyer read Spanish', posts.length === 1 && posts[0].locale === 'es' && posts[0].from === 'pricing', posts);
    await page.goto('http://localhost:8899/es/');
    await page.click('.nav-links a[href="/help/"]');
    await page.waitForLoadState('domcontentloaded');
    check('Ayuda lands on the English /help/ — there is no Spanish one, and no dead link', new URL(page.url()).pathname === '/help/', page.url());
    check('and /help/ carries no switcher: it has no twin', !(await page.$('.footer-langs')));

    // The switcher, both ways.
    await page.goto('http://localhost:8899/es/pricing/');
    await page.click('.footer-langs a[hreflang="en"]');
    await page.waitForLoadState('domcontentloaded');
    check('the footer switcher goes to the English twin of THIS page', new URL(page.url()).pathname === '/pricing/', page.url());
    await page.click('.footer-langs a[hreflang="es"]');
    await page.waitForLoadState('domcontentloaded');
    check('and back to the Spanish one', new URL(page.url()).pathname === '/es/pricing/', page.url());

    // English browser, English page: nothing at all.
    const en = await browser.newContext({ locale: 'en-US' });
    const p2 = await en.newPage();
    await p2.goto('http://localhost:8899/');
    await p2.waitForLoadState('domcontentloaded');
    check('an English browser on / sees no offer', !(await p2.$('#langSuggest')));
    check('and t() is defined on every page, so scripts can assume it', await p2.evaluate(() => typeof window.t === 'function'));
    await p2.goto('http://localhost:8899/help/');
    await p2.waitForLoadState('domcontentloaded');
    check('t() exists on a page with no twin too', await p2.evaluate(() => typeof window.t === 'function' && window.t('x {a}', { a: 1 }) === 'x 1'));
    await en.close();
    await ctx.close();
  }

  // 15 — the scan field's typeahead (#241). Companies matching what has been
  //      typed, one line each — name, domain — from the site's OWN function,
  //      never from the provider: the browser must make no request to
  //      autocomplete.clearbit.com, which is the whole of /privacy/ §08's
  //      "never from your browser" sentence. A pick fills the field with the
  //      domain and submits nothing; Scan is still the visitor's press.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const asked = [];
    const outside = [];
    await page.route('**/*', route => {
      const u = new URL(route.request().url());
      if (!['localhost'].includes(u.hostname)) outside.push(u.hostname);
      return route.continue();
    });
    await page.route('**/.netlify/functions/company-suggest**', route => {
      const q = new URL(route.request().url()).searchParams.get('q');
      asked.push(q);
      const all = [
        { name: 'Acme Corporation', domain: 'acme.com' },
        { name: 'Acme Widgets', domain: 'acmewidgets.io' },
        { name: 'Acmeta', domain: 'acmeta.example' },
      ];
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ suggestions: all.filter(e => e.name.toLowerCase().startsWith(q.toLowerCase())) }) });
    });
    const scans = [];
    await page.route('https://studio.prospektor.ai/api/scan**', async route => {
      if (route.request().method() === 'POST') scans.push(JSON.parse(route.request().postData()));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        domain: 'acme.com', status: 'done', mode: 'live',
        result: { name: 'Acme Corporation', inferredGoal: 'Mid-size property managers.', facts: ['B2B'] },
      }) });
    });
    await page.goto('http://localhost:8899/');
    check('the list is there and hidden before anyone types', await page.evaluate(() =>
      document.getElementById('scanSuggest').hidden && document.getElementById('scanInput').getAttribute('aria-expanded') === 'false'));
    check('the browser’s own URL autofill is off, so it cannot draw over ours',
      (await page.getAttribute('#scanInput', 'autocomplete')) === 'off');

    await page.click('#scanInput');
    await page.keyboard.type('a');
    await page.waitForTimeout(400);
    check('one character asks for nothing', asked.length === 0 && await page.evaluate(() => document.getElementById('scanSuggest').hidden));

    await page.keyboard.type('cm');
    await page.waitForSelector('#scanSuggest:not([hidden])', { timeout: 3000 });
    const rows = await page.evaluate(() => [...document.querySelectorAll('#scanSuggest li')].map(li => ({
      name: li.querySelector('.scan-suggest-name').textContent,
      domain: li.querySelector('.scan-suggest-domain').textContent,
      lines: li.getClientRects().length, role: li.getAttribute('role'),
      h: li.getBoundingClientRect().height,
    })));
    check('typing "acm" lists the matches, one line each — name, domain', rows.length === 3
      && rows[0].name === 'Acme Corporation' && rows[0].domain === 'acme.com'
      && rows.every(r => r.role === 'option' && r.h < 40), rows);
    check('the debounce asked once for the three characters, not once per keystroke',
      asked.length === 1 && asked[0] === 'acm', asked);
    const geo = await page.evaluate(() => {
      const b = el => el.getBoundingClientRect();
      const f = b(document.querySelector('.scan-form')), l = b(document.getElementById('scanSuggest'));
      const hint = b(document.getElementById('scanHint'));
      return { formW: f.width, listW: l.width, under: l.top >= f.bottom, hintTop: hint.top, formBottom: f.bottom };
    });
    check('the list hangs under the field at the field’s width', Math.abs(geo.listW - geo.formW) < 3 && geo.under, geo);
    check('and nothing else on the page moved to make room', geo.hintTop - geo.formBottom < 30, geo);
    check('the list speaks the page’s language (aria-label through t())',
      (await page.getAttribute('#scanSuggest', 'aria-label')) === 'Suggestions');
    check('the list is a listbox the field controls', await page.evaluate(() =>
      document.getElementById('scanInput').getAttribute('aria-controls') === 'scanSuggest'
      && document.getElementById('scanInput').getAttribute('aria-expanded') === 'true'));

    // Keyboard: down, down, Enter picks the second — and submits nothing.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    check('arrow keys mark a row, and the field says which',
      await page.evaluate(() => document.querySelector('#scanSuggest li[aria-selected="true"]').id === 'scanSuggest-1'
        && document.getElementById('scanInput').getAttribute('aria-activedescendant') === 'scanSuggest-1'));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    check('Enter on a marked row fills the field with its domain', (await page.inputValue('#scanInput')) === 'acmewidgets.io');
    check('and closes the list', await page.evaluate(() => document.getElementById('scanSuggest').hidden));
    check('and submits nothing — Scan is still the visitor’s press', scans.length === 0
      && await page.evaluate(() => document.getElementById('scanStatus').hidden && document.getElementById('scanResult').hidden));
    check('focus stays in the field', await page.evaluate(() => document.activeElement.id === 'scanInput'));

    // Mouse: retype, click the first row.
    await page.fill('#scanInput', '');
    await page.keyboard.type('acme');
    await page.waitForSelector('#scanSuggest:not([hidden])', { timeout: 3000 });
    await page.click('#scanSuggest li:first-child');
    await page.waitForTimeout(200);
    check('a click picks too', (await page.inputValue('#scanInput')) === 'acme.com'
      && await page.evaluate(() => document.getElementById('scanSuggest').hidden));

    // Escape closes without touching the value; blur closes too.
    await page.keyboard.type('x');
    await page.fill('#scanInput', 'acm');
    await page.keyboard.type('e');
    await page.waitForSelector('#scanSuggest:not([hidden])', { timeout: 3000 });
    await page.keyboard.press('Escape');
    check('Escape closes the list and leaves what was typed', (await page.inputValue('#scanInput')) === 'acme'
      && await page.evaluate(() => document.getElementById('scanSuggest').hidden));

    // Enter with nothing marked is the ordinary submit, and the scan runs on
    // what is in the field.
    await page.fill('#scanInput', 'acme.com');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#scanResult:not([hidden])', { timeout: 5000 });
    check('Enter with no row marked scans what is in the field', scans.length === 1 && scans[0].website === 'acme.com', scans);
    check('the browser asked nobody outside this origin — the function is the one door (§08)',
      !outside.some(h => /clearbit/.test(h)) && outside.every(h => h === 'studio.prospektor.ai'), [...new Set(outside)]);

    // An unreachable function is simply no list.
    await page.unroute('**/.netlify/functions/company-suggest**');
    await page.route('**/.netlify/functions/company-suggest**', route => route.abort());
    await page.fill('#scanInput', '');
    await page.keyboard.type('acm');
    await page.waitForTimeout(600);
    check('a dead function is no list, never an error', await page.evaluate(() =>
      document.getElementById('scanSuggest').hidden && document.getElementById('scanError').hidden));
    await page.close();

    // The Spanish page: the same list, labelled in Spanish.
    const es = await browser.newPage();
    await es.route('**/.netlify/functions/company-suggest**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: [{ name: 'Acme', domain: 'acme.com' }] }) }));
    await es.goto('http://localhost:8899/es/');
    await es.click('#scanInput');
    await es.keyboard.type('acm');
    await es.waitForSelector('#scanSuggest:not([hidden])', { timeout: 3000 });
    check('on /es/ the list is labelled in Spanish', (await es.getAttribute('#scanSuggest', 'aria-label')) === 'Sugerencias');
    await es.close();
  }

  // 16 — the wait says what the scan is doing (#323). Timed against the real
  //      envelope (20 s bound, ~9 s median) rather than the 60–70 s one, and
  //      when the studio serves `notes` on the poll, the last note is the
  //      sentence. The old stages at 20–75 s described a scan that had already
  //      failed; they are gone, and their catalogue entries with them.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    let polls = 0;
    await page.route('https://studio.prospektor.ai/api/scan**', async route => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 202, contentType: 'application/json',
          body: JSON.stringify({ domain: 'acme.com', status: 'queued', result: null }) });
      }
      polls++;
      if (polls === 1) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        domain: 'acme.com', status: 'running', result: null,
        notes: [{ kind: 'search', detail: 'Searched “acme”', query: 'acme' },
                { kind: 'read', detail: 'Read https://www.acme.com/about/', sources: 1, url: 'https://www.acme.com/about/' }],
      }) });
      if (polls === 2) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        domain: 'acme.com', status: 'running', result: null,
        notes: [{ kind: 'search', detail: 'Searched “acme anvils”', query: 'acme anvils' }],
      }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        domain: 'acme.com', status: 'done', mode: 'live',
        result: { name: 'Acme', inferredGoal: 'Coyotes with a grudge.', facts: ['B2B'] },
      }) });
    });
    await page.goto('http://localhost:8899/');
    await page.fill('#scanInput', 'acme.com');
    await page.click('#scanBtn');
    await page.waitForSelector('#scanStatus:not([hidden])', { timeout: 3000 });
    const first = await page.textContent('#scanStatusMsg');
    check('the wait opens on the domain', first === 'opening acme.com…', first);
    // The first poll (2 s in) carries notes; the LAST one is the sentence.
    await page.waitForFunction(() => /reading acme\.com\/about…/.test(document.getElementById('scanStatusMsg').textContent), null, { timeout: 5000 })
      .then(() => check('a read note becomes “reading acme.com/about…” — host and path, no scheme, no www', true))
      .catch(async () => check('a read note becomes “reading acme.com/about…” — host and path, no scheme, no www', false, await page.textContent('#scanStatusMsg')));
    await page.waitForFunction(() => /searching for “acme anvils”…/.test(document.getElementById('scanStatusMsg').textContent), null, { timeout: 5000 })
      .then(() => check('a search note becomes “searching for “…”…”', true))
      .catch(async () => check('a search note becomes “searching for “…”…”', false, await page.textContent('#scanStatusMsg')));
    const bar = await page.evaluate(() => parseFloat(document.getElementById('scanBarFill').style.width));
    check('the bar is past a third by the time the second poll lands (~4 s)', bar > 33, bar);
    await page.waitForSelector('#scanResult:not([hidden])', { timeout: 8000 });
    check('and the result still lands', (await page.textContent('#scanName')) === 'Acme');
    await page.close();

    // No notes at all — the timed sentences, against the real envelope.
    const p2 = await browser.newPage();
    let t0 = 0;
    await p2.route('https://studio.prospektor.ai/api/scan**', async route => {
      if (route.request().method() === 'POST') { t0 = Date.now(); return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ domain: 'slow.example', status: 'queued', result: null }) }); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ domain: 'slow.example', status: 'running', result: null }) });
    });
    await p2.goto('http://localhost:8899/');
    await p2.fill('#scanInput', 'slow.example');
    await p2.click('#scanBtn');
    await p2.waitForSelector('#scanStatus:not([hidden])', { timeout: 3000 });
    await p2.waitForFunction(() => document.getElementById('scanStatusMsg').textContent === 'reading slow.example…', null, { timeout: 4000 })
      .then(() => check('with no notes, “reading <domain>…” by 2 s', true))
      .catch(async () => check('with no notes, “reading <domain>…” by 2 s', false, await p2.textContent('#scanStatusMsg')));
    await p2.waitForFunction(() => document.getElementById('scanStatusMsg').textContent === 'writing what it found…', null, { timeout: 8000 })
      .then(() => check('“writing what it found…” by 8 s', true))
      .catch(async () => check('“writing what it found…” by 8 s', false, await p2.textContent('#scanStatusMsg')));
    await p2.waitForFunction(() => /taking longer than usual/.test(document.getElementById('scanStatusMsg').textContent), null, { timeout: 8000 })
      .then(() => check('past 14 s it says the honest thing: taking longer than usual', true))
      .catch(async () => check('past 14 s it says the honest thing: taking longer than usual', false, await p2.textContent('#scanStatusMsg')));
    check('no sentence describes a stage the 20 s bound cannot reach',
      !/drafting your proposal|tightening the wording|one search beyond/.test(await p2.evaluate(() => document.documentElement.outerHTML)));
    await p2.close();

    // /es/ — the same wait, in Spanish, notes included.
    const es = await browser.newPage();
    let esPolls = 0;
    await es.route('https://studio.prospektor.ai/api/scan**', async route => {
      if (route.request().method() === 'POST') return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ domain: 'acme.com', status: 'queued', result: null }) });
      esPolls++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ domain: 'acme.com', status: 'running', result: null,
        notes: esPolls === 1 ? [{ kind: 'read', url: 'https://acme.com/equipo' }] : [] }) });
    });
    await es.goto('http://localhost:8899/es/');
    await es.fill('#scanInput', 'acme.com');
    await es.click('#scanBtn');
    await es.waitForSelector('#scanStatus:not([hidden])', { timeout: 3000 });
    check('on /es/ the wait opens in Spanish', (await es.textContent('#scanStatusMsg')) === 'abriendo acme.com…', await es.textContent('#scanStatusMsg'));
    await es.waitForFunction(() => document.getElementById('scanStatusMsg').textContent === 'leyendo acme.com/equipo…', null, { timeout: 5000 })
      .then(() => check('and a note reads in Spanish too', true))
      .catch(async () => check('and a note reads in Spanish too', false, await es.textContent('#scanStatusMsg')));
    await es.close();
  }

  // 13 — the /resources topic filter (#159). The section is one article per
  //      useful learning, so it grows; a flat grid of every article was fine at
  //      nine and is a wall at twenty-three. Two properties matter and neither
  //      is visible in the built HTML, which is why they are here:
  //      the row is inert markup until the script runs (so a reader with no JS
  //      is never shown buttons that do nothing), and a chip actually filters.
  {
    const page = await browser.newPage();
    await page.goto('http://localhost:8899/resources/', { waitUntil: 'networkidle' });

    const total = await page.$$eval('.res-card', ns => ns.length);
    check('the hub lists every article at rest', total > 9, total);
    check('the filter row is revealed once the script runs', await page.isVisible('[data-topic-filter]'));
    // It shipped as a <nav> once, and main.css styles the bare `nav` element as
    // the site's fixed header — so the row rendered pinned across the logo while
    // every behavioural check above still passed. Ask where it actually is.
    const rowBox = await page.locator('[data-topic-filter]').boundingBox();
    const heroBox = await page.locator('.res-hub-hero').boundingBox();
    check('and sits below the hero rather than over the site header',
      rowBox.y > heroBox.y + heroBox.height - 1, { row: rowBox.y, heroEnds: heroBox.y + heroBox.height });

    // Pick a topic that more than one article carries, and one that is not it.
    const topics = await page.$$eval('.res-card', ns => ns.map(n => n.getAttribute('data-topic')));
    const multi = topics.find((t, i) => topics.indexOf(t) !== i);
    check('at least one topic has more than one article', !!multi, topics);

    await page.click(`[data-topic-filter] button[data-filter="${multi}"]`);
    const shown = await page.$$eval('.res-card:not([hidden])', ns =>
      ns.map(n => n.getAttribute('data-topic')));
    check('a chip hides every card of another topic',
      shown.length > 0 && shown.length < total && shown.every(t => t === multi), shown);
    check('the chip reports itself pressed',
      await page.getAttribute(`[data-topic-filter] button[data-filter="${multi}"]`, 'aria-pressed') === 'true');
    check('and the count is announced',
      new RegExp('article').test(await page.textContent('[data-filter-count]')));

    await page.click('[data-topic-filter] button[data-filter=""]');
    check('Everything brings them all back',
      (await page.$$eval('.res-card:not([hidden])', ns => ns.length)) === total);

    // The keep-reading block, asked of the served pages rather than the source.
    // The pick is #137's ring; what #159 adds is the ordering inside the window
    // it picked — if any of the three shares this article's topic, that one is
    // listed first. Asked here as well as in resources.test.js because this
    // version also proves the links resolve to real pages.
    const ring = await page.evaluate(async () => {
      const cards = [...document.querySelectorAll('.res-card')];
      const topic = new Map(cards.map(c => [c.querySelector('a').getAttribute('href'),
                                            c.getAttribute('data-topic')]));
      const out = [];
      for (const [url, t] of topic) {
        const doc = new DOMParser().parseFromString(await (await fetch(url)).text(), 'text/html');
        const links = [...doc.querySelectorAll('.res-more-list a')].map(a => a.getAttribute('href'));
        out.push({
          url, t, links,
          first: topic.get(links[0]),
          same: links.filter(u => topic.get(u) === t),
          bad: links.filter(u => u === url || !topic.has(u))
        });
      }
      return out;
    });
    check('every article resolves its keep-reading links to other real articles',
      ring.length > 9 && ring.every(r => r.links.length >= 3 && r.bad.length === 0),
      ring.filter(r => r.bad.length).map(r => r.url + ' → ' + r.bad.join(', ')));
    const ordered = ring.filter(r => r.same.length);
    check('and leads with a same-topic one wherever the ring picked one',
      ordered.length > 0 && ordered.every(r => r.first === r.t),
      ordered.filter(r => r.first !== r.t).map(r => r.url + ' → ' + r.links[0]));
    await page.close();
  }

  await browser.close();
  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
