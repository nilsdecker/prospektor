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

  // 7 — the help hub is served whole, and search answers the operator's own
  //     question (#145/#136). Nothing is mocked before the first assertions on
  //     purpose: everything here has to be true of the HTML the build wrote,
  //     because that is what a crawler and a reader with a slow studio get.
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
    check('every guide is in the served HTML before any fetch',
      (await page.$$eval('.help-guide', n => n.length)) === guides);
    check('the hub shows a card per guide',
      (await page.$$eval('.card', n => n.length)) === guides);
    check('the search box the operator kept is present', await page.isVisible('#helpSearch'));
    check('a guide body is real text, not a placeholder',
      /New client workspace/.test(await page.textContent('#guide-workspace')));
    check('tables render', await page.isVisible('.help-guide table'));
    check('nested list renders', await page.isVisible('.help-guide li ul li'));
    check('studio-relative links point at the studio',
      (await page.getAttribute('.help-guide a[target="_blank"]', 'href') || '').startsWith('https://studio.prospektor.ai/'));

    // The bug this row exists for.
    await page.fill('#helpSearch', 'how can I create a new workspace');
    await page.waitForSelector('#helpResults:not([hidden])', { timeout: 5000 });
    const results = await page.textContent('#helpResults');
    check("the operator's question finds the workspace guide", /Workspace settings/.test(results), results.slice(0, 120));
    check('the answer is in the snippet', /client workspace/i.test(results));
    check('search marks the matched words', await page.isVisible('#helpResults mark'));
    check('the guides step aside while searching', await page.isHidden('#helpGuides'));
    check('so does the card hub', await page.isHidden('#helpHub'));

    await page.click('#helpResults .help-hit-snippet');
    await page.waitForSelector('#helpGuides:not([hidden])', { timeout: 5000 });
    check('a result click restores the guides, search cleared',
      (await page.inputValue('#helpSearch')) === '');
    // The section anchor, not just the guide: `workspace--<heading>`. Accepting
    // `guide-workspace` here hid an undefined anchor once already.
    check('and lands on the section, not the top of a 21k-character guide',
      /#workspace--/.test(page.url()), page.url());

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
    check('and nothing was duplicated',
      (await page.$$eval('.help-guide', n => n.length)) === guides);
    await page.close();
  }

  // 7b — the studio HAS moved on since the build: the runtime fetch is still
  //      what keeps a help change live for a human the moment the studio
  //      deploys (#76), so a changed corpus must actually replace the page.
  {
    const SNAPSHOT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'help-corpus.json'), 'utf8'));
    const moved = { files: SNAPSHOT.files.concat([{ name: '99-brand-new.md', text: '# A brand new guide\n\nShipped by the studio after this site was built.\n' }]) };
    const page = await browser.newPage();
    await page.route('https://studio.prospektor.ai/api/help', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(moved) }));
    await page.goto('http://localhost:8899/help/');
    await page.waitForFunction(
      n => document.querySelectorAll('.help-guide').length === n,
      moved.files.length, { timeout: 5000 });
    check('a corpus that moved is picked up at runtime',
      (await page.$$eval('.help-guide', n => n.length)) === moved.files.length);
    check('the new guide is on the page', await page.isVisible('#guide-brand-new'));
    check('the hub gained its card',
      (await page.$$eval('.card', n => n.length)) === moved.files.length);
    check('and the reconcile said so',
      (await page.getAttribute('#helpGuides', 'data-corpus-source')) === 'runtime');
    check('an unknown guide still gets a card',
      /Guide/.test(await page.textContent('#guide-brand-new .help-guide-topic')));
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
    await page.goto('http://localhost:8899/help/');
    await page.waitForSelector('.help-guide', { timeout: 5000 });
    check('a dead studio leaves the prerendered guides on screen',
      (await page.$$eval('.help-guide', n => n.length)) > 0);
    check('and shows no error over them',
      !/could not be loaded/.test(await page.textContent('body')));
    check('search still works with the studio down',
      await (async () => {
        await page.fill('#helpSearch', 'how can I create a new workspace');
        await page.waitForSelector('#helpResults:not([hidden])', { timeout: 5000 });
        return /Workspace settings/.test(await page.textContent('#helpResults'));
      })());
    await page.close();
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
    const STATIC = ['https://prospektor.ai/', 'https://prospektor.ai/privacy/',
                    'https://prospektor.ai/terms/', 'https://prospektor.ai/resources/',
                    'https://prospektor.ai/help/'];
    const articleLocs = locs.filter(l => !STATIC.includes(l));
    check('sitemap lists exactly the static pages we want ranked',
      JSON.stringify(locs.slice(0, STATIC.length)) === JSON.stringify(STATIC), locs);

    const slugs = fs.readdirSync(path.join(__dirname, '..', 'src', 'resources'))
      .filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));
    check('sitemap lists every /resources/ article and nothing else besides',
      articleLocs.length === slugs.length
      && slugs.every(s => articleLocs.includes('https://prospektor.ai/resources/' + s + '/')),
      { listed: articleLocs.length, onDisk: slugs.length });

    // A <lastmod> is a promise a crawler acts on, so it has to be a real date
    // rather than a build stamp — the terms #135 set for adding them at all.
    check('every article carries a real lastmod, and no static page does',
      [...xml.matchAll(/<loc>([^<]+)<\/loc>(<lastmod>[^<]+<\/lastmod>)?/g)]
        .every(([, loc, mod]) => STATIC.includes(loc)
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
    // entry and the guarantee behind it are checked together.
    const helpHtml = fs.readFileSync(path.join(ROOT, 'help', 'index.html'), 'utf8');
    check('sitemap lists /help/ now that it serves real content (#136)',
      locs.includes('https://prospektor.ai/help/'));
    check('and /help/ is not a Loading… shell any more',
      !/Loading…/.test(helpHtml) && /id="guide-workspace"/.test(helpHtml));

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
      check('the panel names every declared item', rows.length === 4, rows);
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
      const pages = ['/', '/privacy/', '/terms/', '/checkout/', '/help/', '/resources/', '/resources/who-to-approach/'];
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

  await browser.close();
  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
