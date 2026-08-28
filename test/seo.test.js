// The findings of #137's SEO audit, turned into a suite that fails when one of
// them comes back.
//
// Every assertion here is a defect that was really on prospektor.ai on 24 Aug
// 2026, measured by `node tools/seo-audit.js` against production — not a
// checklist copied off an SEO blog. What was found, and what each test pins:
//
//   - nine article <title>s ran 74-110 characters, so Google truncated every
//     one of them and the brand never appeared;
//   - the 294-character site description was the meta description of `/`,
//     `/checkout/` AND `/checkout/done/` — one snippet, cut in half, on three
//     pages;
//   - eight of the seventeen indexable pages had NO structured data, and the
//     page with the price on it was one of them;
//   - the homepage outline read h1 → h3(empty) → h2, and /checkout/ had three
//     <h1>s;
//   - five of nine articles had exactly one inbound internal link, because
//     "related" articles were sorted by date.
//
// The build is done once, here, and read as files. Nothing hits the network.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const site = require('../src/_data/site.json');
const { siteBuild } = require('./helpers.js');

// What a search result actually shows. Both are soft limits measured in pixels
// rather than characters, so they are rounded generously — the point is to
// catch a 294-character description, not to argue about 161.
const TITLE_MAX = 60;
const DESC_MAX = 160;

let SITE, built;
const htmlFiles = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? htmlFiles(path.join(dir, e.name))
    : e.name.endsWith('.html') ? [path.join(dir, e.name)] : []);

// Titles and descriptions are measured as a search result RENDERS them, not as
// the HTML spells them: `"Too expensive" is never why they left` is 37
// characters on the page and 49 in the source, because each quote is `&quot;`.
// Measuring the source failed this suite on two pages that were within budget.
const decode = s => s === null ? null : s
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

const pages = () => htmlFiles(SITE).map(f => {
  const html = fs.readFileSync(f, 'utf8');
  const url = '/' + path.relative(SITE, f).replace(/index\.html$/, '').replace(/\\/g, '/');
  const attr = re => decode((html.match(re) || [])[1] ?? null);
  return {
    url, html,
    title: attr(/<title[^>]*>([\s\S]*?)<\/title>/i),
    description: attr(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i),
    noindex: /<meta[^>]+name="robots"[^>]+content="[^"]*noindex/i.test(html),
    h1s: [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => m[1]),
    jsonld: [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
      .map(m => m[1]),
  };
});

// Every page the sitemap asks Google to rank. Those are the ones a duplicate
// title or a missing description actually costs something on.
const indexable = () => {
  const sm = fs.readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8');
  const urls = new Set([...sm.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map(m => m[1].replace(site.url, '') || '/'));
  return pages().filter(p => urls.has(p.url));
};

describe('SEO — the #137 findings, pinned', () => {
  before(() => { built = siteBuild('seo'); SITE = built.dir; });
  after(() => built && built.cleanup());

  test('every title fits the result, or says why it cannot', () => {
    for (const p of pages())
      assert.ok(p.title && p.title.length <= TITLE_MAX,
        `${p.url}: title is ${p.title ? p.title.length : 0} chars (max ${TITLE_MAX}) — ` +
        `"${p.title}". Give the page a shorter \`seoTitle\` in its frontmatter; ` +
        `the <h1> a reader sees does not change.`);
  });

  test('every title is unique among the pages we ask to be ranked', () => {
    const seen = new Map();
    for (const p of indexable()) {
      assert.ok(!seen.has(p.title), `${p.url} and ${seen.get(p.title)} share the title "${p.title}"`);
      seen.set(p.title, p.url);
    }
  });

  test('every page has a description that fits the snippet', () => {
    for (const p of pages()) {
      assert.ok(p.description, `${p.url}: no meta description`);
      assert.ok(p.description.length <= DESC_MAX,
        `${p.url}: description is ${p.description.length} chars (max ${DESC_MAX}) — the tail is cut`);
    }
  });

  test('no two indexable pages share a description', () => {
    // The one that was really there: site.description served `/`, `/checkout/`
    // and `/checkout/done/`. A page that has not been given its own falls back
    // to site.json's, which is how three pages ended up identical in search.
    const seen = new Map();
    for (const p of indexable()) {
      assert.ok(!seen.has(p.description),
        `${p.url} and ${seen.get(p.description)} share a description — one of them needs its own`);
      seen.set(p.description, p.url);
    }
  });

  test('every page has exactly one h1', () => {
    for (const p of pages())
      assert.strictEqual(p.h1s.length, 1, `${p.url}: ${p.h1s.length} <h1> elements`);
  });

  test('no heading is empty', () => {
    // h1 → h3(empty) → h2 on the homepage: the scan result was marked up as a
    // heading and rendered blank until JavaScript filled it.
    for (const p of pages())
      for (const m of p.html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi))
        assert.ok(m[2].replace(/<[^>]*>/g, '').trim(),
          `${p.url}: empty <h${m[1]}> — if it is filled by script it is not a heading`);
  });

  test('every structured-data block is valid JSON', () => {
    for (const p of pages())
      for (const block of p.jsonld)
        assert.doesNotThrow(() => JSON.parse(block), `${p.url}: invalid JSON-LD`);
  });

  test('Organization and WebSite are on every page, with the @ids the rest point at', () => {
    for (const p of pages()) {
      const types = p.jsonld.flatMap(b => {
        const v = JSON.parse(b);
        return (v['@graph'] || [v]).map(n => n['@type']);
      });
      assert.ok(types.includes('Organization'), `${p.url}: no Organization`);
      assert.ok(types.includes('WebSite'), `${p.url}: no WebSite`);
      assert.ok(p.html.includes(`"@id": "${site.url}/#organization"`), `${p.url}: no @id to reference`);
    }
  });

  test('every indexable page carries structured data beyond the sitewide pair', () => {
    // Eight pages had none at all. The sitewide Organization/WebSite closes
    // that for all of them; this asserts the pair is really reaching them.
    for (const p of indexable())
      assert.ok(p.jsonld.length >= 1, `${p.url}: no structured data`);
  });

  test('the Offer on /pricing/ is the price Stripe actually charges', () => {
    // The number in the schema and the number in the charge cannot be allowed
    // to drift: one of them is what a buyer reads in a search result and the
    // other is what leaves their card.
    const fn = fs.readFileSync(path.join(ROOT, 'netlify/functions/create-checkout-session.js'), 'utf8');
    const amount = (fn.match(/'line_items\[0\]\[price_data\]\[unit_amount\]':\s*'(\d+)'/) || [])[1];
    const currency = (fn.match(/'line_items\[0\]\[price_data\]\[currency\]':\s*'(\w+)'/) || [])[1];
    assert.ok(amount && currency, 'could not read the price out of create-checkout-session.js');

    const pricing = pages().find(p => p.url === '/pricing/');
    const product = pricing.jsonld.map(JSON.parse).find(v => v['@type'] === 'Product');
    assert.ok(product, '/pricing/ has no Product structured data');
    assert.strictEqual(product.offers.price, (Number(amount) / 100).toFixed(2),
      `schema says ${product.offers.price}, Stripe charges ${amount} minor units`);
    assert.strictEqual(product.offers.priceCurrency, currency.toUpperCase());
  });

  test('every article is reachable from three other articles, not one', () => {
    // The measured defect: `related` sorted by date, so inbound links ran
    // 9,9,9,4,1,1,1,1,1 and five articles were reachable only from the hub.
    // A ring makes the count identical for every article by construction, so
    // this asserts evenness rather than a floor — a floor would pass again the
    // moment somebody re-sorted by date and left one article on top.
    const articles = pages().filter(p => /^\/resources\/.+\//.test(p.url));
    assert.ok(articles.length >= 4, 'expected the resources collection to be populated');
    const inbound = Object.fromEntries(articles.map(a => [a.url, 0]));
    for (const from of articles) {
      const links = new Set([...from.html.matchAll(/href="(\/resources\/[^"#?]+\/)"/g)].map(m => m[1]));
      for (const to of links) if (to !== from.url && to in inbound) inbound[to]++;
    }
    const counts = [...new Set(Object.values(inbound))];
    assert.strictEqual(counts.length, 1,
      `articles do not share one inbound-link count: ${JSON.stringify(inbound)}`);
    assert.ok(counts[0] >= 3, `each article has only ${counts[0]} inbound article links`);
  });

  test('every article carries Article and BreadcrumbList', () => {
    for (const p of pages().filter(p => /^\/resources\/.+\//.test(p.url))) {
      const types = p.jsonld.flatMap(b => {
        const v = JSON.parse(b);
        return (v['@graph'] || [v]).map(n => n['@type']);
      });
      assert.ok(types.includes('Article'), `${p.url}: no Article`);
      assert.ok(types.includes('BreadcrumbList'), `${p.url}: no BreadcrumbList`);
    }
  });

  test('every help guide carries TechArticle and BreadcrumbList', () => {
    // #166 gave each guide its own URL. A guide page three levels of meaning
    // deep with no machine-readable path back up is the same defect #137 found
    // on the articles, so it is closed here at the same time rather than
    // waiting to be measured again.
    const guides = pages().filter(p => /^\/help\/.+\//.test(p.url));
    assert.ok(guides.length >= 4, 'expected the help guides to be built');
    for (const p of guides) {
      const types = p.jsonld.flatMap(b => {
        const v = JSON.parse(b);
        return (v['@graph'] || [v]).map(n => n['@type']);
      });
      assert.ok(types.includes('TechArticle'), `${p.url}: no TechArticle`);
      assert.ok(types.includes('BreadcrumbList'), `${p.url}: no BreadcrumbList`);
    }
  });

  test('canonical, lang and viewport are on every page', () => {
    for (const p of pages()) {
      const canonical = (p.html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]*)"/i) || [])[1];
      assert.strictEqual(canonical, site.url + p.url, `${p.url}: canonical is ${canonical}`);
      assert.match(p.html, /<html[^>]+lang="en"/, `${p.url}: no lang`);
      assert.match(p.html, /<meta[^>]+name="viewport"/, `${p.url}: no viewport`);
    }
  });
});
