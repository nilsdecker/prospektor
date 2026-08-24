// /resources/ — the lead-generation blog (#144).
//
// What these guard, in the order they would break:
//   - every article actually builds to its own URL, and the hub lists them all;
//   - newest first, because a blog that lists oldest-first reads as abandoned;
//   - every article carries valid `Article` JSON-LD with a real date and its own
//     OG image — the two things the spec asks for that are invisible on screen
//     and therefore the two that rot silently;
//   - every article ends at the free scan, which is the entire reason the
//     section exists rather than being a blog for its own sake;
//   - the sitemap includes the hub and every article and is still parseable XML
//     (a Nunjucks comment above the declaration once put a blank first line
//     there, which is valid-looking and strictly broken).
const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { articles } = require('../tools/learning-coverage.js');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, '_site');
const SRC = path.join(ROOT, 'src', 'resources');

const read = p => fs.readFileSync(path.join(SITE, p), 'utf8');
const slugs = () => fs.readdirSync(SRC).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));

describe('/resources/', () => {
  before(() => {
    // Build once, from this test, so `npm test` never asserts against a stale
    // _site left over from someone's last `npm start`.
    execFileSync('npx', ['@11ty/eleventy'], { cwd: ROOT, stdio: 'pipe' });
  });

  test('there is at least one article, and each builds to its own URL', () => {
    const all = slugs();
    assert.ok(all.length > 0, 'no articles found in src/resources/');
    for (const slug of all) {
      assert.ok(fs.existsSync(path.join(SITE, 'resources', slug, 'index.html')),
        `${slug} did not build to /resources/${slug}/`);
    }
  });

  test('the hub lists every article', () => {
    const hub = read('resources/index.html');
    for (const slug of slugs()) {
      assert.match(hub, new RegExp(`href="/resources/${slug}/"`), `hub is missing ${slug}`);
    }
  });

  test('the hub lists newest first', () => {
    const hub = read('resources/index.html');
    const dates = [...hub.matchAll(/<time datetime="(\d{4}-\d{2}-\d{2})"/g)].map(m => m[1]);
    assert.ok(dates.length > 1, 'expected several dated cards');
    const sorted = [...dates].sort().reverse();
    assert.deepEqual(dates, sorted, 'hub is not in newest-first order');
  });

  test('every article carries valid Article JSON-LD', () => {
    for (const slug of slugs()) {
      const html = read(`resources/${slug}/index.html`);
      // Every block is parsed (so bad JSON in any of them still throws), and
      // the Article one is found by type — since #137 a page also carries the
      // sitewide Organization/WebSite graph and its own BreadcrumbList.
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
        .map(m => JSON.parse(m[1]));
      assert.ok(blocks.length, `${slug} has no JSON-LD`);
      const ld = blocks.find(v => v['@type'] === 'Article');
      assert.ok(ld, `${slug} is not typed as an Article`);
      assert.ok(ld.headline, `${slug} has no headline`);
      assert.match(ld.datePublished, /^\d{4}-\d{2}-\d{2}$/, `${slug} has no usable date`);
      assert.equal(ld.mainEntityOfPage['@id'], `https://prospektor.ai/resources/${slug}/`);
    }
  });

  test('every article declares og:type article and its own OG image', () => {
    for (const slug of slugs()) {
      const html = read(`resources/${slug}/index.html`);
      assert.match(html, /<meta property="og:type" content="article">/, `${slug} is not og:type article`);
      assert.match(html, new RegExp(`og:image" content="https://prospektor\\.ai/assets/img/og/${slug}\\.png"`),
        `${slug} does not point at its own OG card`);
      assert.ok(fs.existsSync(path.join(SITE, 'assets', 'img', 'og', `${slug}.png`)),
        `${slug}.png is missing — run \`npm run og\``);
    }
  });

  test('every article ends at the free scan', () => {
    for (const slug of slugs()) {
      const html = read(`resources/${slug}/index.html`);
      assert.match(html, /class="res-cta"/, `${slug} has no closing scan CTA`);
    }
  });

  test('the landing page is still og:type website', () => {
    // The per-article og:type is a conditional in base.njk; this is the other
    // branch, which nothing else would notice breaking.
    assert.match(read('index.html'), /<meta property="og:type" content="website">/);
  });

  test('keep-reading lists a same-topic article first when it picked one (#159)', () => {
    // The pick itself is a ring, for the link-equity reason #137 measured — see
    // `related` in .eleventy.js and the inbound-count test in seo.test.js. What
    // #159 asks of it is the ordering *within* the window it picked: if any of
    // the three shares this article's topic, that one is listed first, so the
    // most relevant link is also the first one a reader sees. Ordering cannot
    // change which articles were picked, so this and the ring cannot conflict.
    const topicOf = new Map(articles().map(a => ['/resources/' + a.slug + '/', a.topic]));
    let checked = 0;
    for (const a of articles()) {
      const html = read(`resources/${a.slug}/index.html`);
      const block = html.split('res-more-list')[1] || '';
      const links = [...block.matchAll(/href="(\/resources\/[a-z0-9-]+\/)"/g)].map(m => m[1]);
      assert.ok(links.length, `${a.slug} has no keep-reading links`);
      const sameTopic = links.filter(u => topicOf.get(u) === a.topic);
      if (!sameTopic.length) continue;           // the ring picked none; nothing to order
      assert.equal(topicOf.get(links[0]), a.topic,
        `${a.slug} (${a.topic}) picked ${sameTopic.join(', ')} on its own topic but ` +
        `leads with ${links[0]} (${topicOf.get(links[0])})`);
      checked++;
    }
    assert.ok(checked > 0, 'no article had a same-topic article in its window');
  });

  test('the hub filter row is derived from the articles and ships hidden', () => {
    const hub = read('resources/index.html');
    const topics = [...new Set(articles().map(a => a.topic))];
    assert.match(hub, /<div class="res-filter" role="group" data-topic-filter hidden/,
      'the filter row must ship hidden — resources.js reveals it, so a reader ' +
      'without JS gets the whole grid rather than buttons that do nothing');
    assert.match(hub, /<script src="\/assets\/js\/resources\.js" defer><\/script>/);
    for (const t of topics) {
      assert.ok(hub.includes(`data-filter="${t}"`), `the hub has no filter chip for "${t}"`);
    }
    for (const a of articles()) {
      assert.ok(hub.includes(`data-topic="${a.topic}"`), `no card carries the topic "${a.topic}"`);
    }
  });

  test('the sitemap is parseable and lists the hub and every article', () => {
    const xml = read('sitemap.xml');
    assert.ok(xml.startsWith('<?xml'), 'sitemap has content before the XML declaration');
    assert.match(xml, /<loc>https:\/\/prospektor\.ai\/resources\/<\/loc>/);
    for (const slug of slugs()) {
      assert.match(xml, new RegExp(`<loc>https://prospektor\\.ai/resources/${slug}/</loc>`),
        `sitemap is missing ${slug}`);
    }
  });
});
