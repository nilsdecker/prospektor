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

  // 7 — the help center renders the studio's corpus and search finds things
  {
    const CORPUS = { files: [
      { name: '01-getting-started.md', text: '# Getting started\n\nWelcome to the studio.\n\n## First steps\n\n- Open [Library](/library) to see pitches\n- The **tour** walks the screens\n  - it is skippable\n\n| Screen | Path |\n|---|---|\n| Library | `/library` |\n' },
      { name: '02-sharing.md', text: '# Sharing a pitch\n\nA share link travels by email.\n\n## Revoking\n\nRevoke it from the pitch page.\n' },
    ] };
    const page = await browser.newPage();
    await page.route('https://studio.prospektor.ai/api/help', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) }));
    await page.goto('http://localhost:8899/help/');
    await page.waitForSelector('#helpArticle h1', { timeout: 5000 });

    check('nav lists every guide', (await page.$$eval('#helpNav a', a => a.length)) === 2);
    check('first guide renders as the landing article',
      (await page.textContent('#helpArticle h1')) === 'Getting started');
    check('studio-relative links point at the studio',
      (await page.getAttribute('#helpArticle a[target="_blank"]', 'href')) === 'https://studio.prospektor.ai/library');
    check('tables render', await page.isVisible('#helpArticle table'));
    check('nested list renders', await page.isVisible('#helpArticle li ul li'));

    await page.click('#helpNav a[data-slug="sharing"]');
    await page.waitForFunction(() => document.querySelector('#helpArticle h1')?.textContent === 'Sharing a pitch');
    check('the hash routes to the second guide', page.url().endsWith('#sharing'));
    check('nav marks the open guide',
      await page.$eval('#helpNav a[data-slug="sharing"]', a => a.classList.contains('is-current')));

    await page.fill('#helpSearch', 'revoke');
    await page.waitForSelector('#helpResults:not([hidden])', { timeout: 5000 });
    check('search surfaces the matching guide', /Sharing a pitch/.test(await page.textContent('#helpResults')));
    check('search marks the matched words', await page.isVisible('#helpResults mark'));
    check('the article steps aside while searching', await page.isHidden('#helpArticle'));
    await page.click('#helpResults .help-hit-snippet');
    await page.waitForSelector('#helpArticle:not([hidden])', { timeout: 5000 });
    check('a result click lands on the guide, search cleared',
      (await page.inputValue('#helpSearch')) === '');

    await page.fill('#helpSearch', 'zzzunfindable');
    await page.waitForSelector('#helpResults:not([hidden])');
    check('a miss says so instead of an empty pane', /Nothing in the guides/.test(await page.textContent('#helpResults')));
    await page.close();
  }

  // 8 — the studio unreachable: the help page says so and offers a retry
  {
    const page = await browser.newPage();
    let calls = 0;
    await page.route('https://studio.prospektor.ai/api/help', route => {
      calls++;
      if (calls === 1) return route.fulfill({ status: 502, body: 'bad gateway' });
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ files: [{ name: '01-a.md', text: '# Recovered\n\nBack again.\n' }] }) });
    });
    await page.goto('http://localhost:8899/help/');
    await page.waitForSelector('#helpRetry', { timeout: 5000 });
    check('a dead studio yields the honest message', /could not be loaded/.test(await page.textContent('#helpArticle')));
    await page.click('#helpRetry');
    await page.waitForFunction(() => document.querySelector('#helpArticle h1')?.textContent === 'Recovered', null, { timeout: 5000 });
    check('retry recovers without a reload', true);
    await page.close();
  }

  await browser.close();
  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
