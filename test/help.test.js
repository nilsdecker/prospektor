// /help/ — the card hub, the search, and the prerendered corpus (#145, #136).
//
// What these guard, in the order they would break:
//
//   - the operator's own screenshot query. "how can I create a new workspace"
//     returned "Nothing in the guides matches" while the corpus had answered
//     it since #83, because search matched the whole query as one substring.
//     That exact string is the regression test and it asserts the *section*,
//     not just the file — finding the right guide and dropping the reader at
//     the top of twenty-one thousand characters is only half an answer;
//   - the per-term rules that fix it: stop-words dropped, stems folded, and
//     every meaningful term required, which is the precision the old
//     whole-string match had and the reason it was worth keeping;
//   - that the served HTML actually contains the guides (#136). The page used
//     to be 6,265 bytes whose entire body copy was the nav, the H1, one
//     sentence and the word "Loading…". Since #166 that is asserted of the
//     help SECTION rather than of one file: the guides moved to /help/<slug>/,
//     one URL each, because a URL is the unit Google ranks and eleven guides
//     on one page competed as a single result. What #136 bought — every guide
//     crawlable, no "Loading…" — is unchanged, so it is checked where it now
//     lives, and the property that would silently undo it (a guide's text on
//     two URLs at once) is checked too;
//   - and the rule that a studio outage must never break a website deploy.
//     Three of these tests build the site with the endpoint dead or lying and
//     assert the build still succeeds — a build that fails because an
//     unrelated service blinked is a worse bug than the one being fixed.
const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const H = require('../src/assets/js/help-render.js');
const { siteBuild, buildInto } = require('./helpers.js');

// The committed snapshot is the fixture: real corpus, deterministic, and
// refreshed deliberately by `npm run help:snapshot` rather than by a network
// call inside a test.
const CORPUS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'help-corpus.json'), 'utf8'));
const INDEX = H.buildIndex(CORPUS.files);

const OPERATOR_QUERY = 'how can I create a new workspace';

// A small hand-written corpus for the algorithm's own behaviours, so those
// tests do not go red because somebody edited a guide in the studio.
const FIXTURE = H.buildIndex([
  { name: '01-getting-started.md', text: '# Getting started\n\nWelcome.\n\n## First steps\n\nOpen the library.\n' },
  { name: '04-sharing.md', text: '# Sharing a pitch\n\nA share link travels by email.\n\n## Revoking a link\n\nRevoke it from the pitch page whenever you want.\n' },
  { name: '08-workspace.md', text: '# Workspace settings\n\nSettings live here.\n\n## More than one workspace\n\nAgency workspaces get New client workspace in that menu, so an owner can create a workspace for a client.\n' },
]);

// This file is the one that still builds repeatedly, and deliberately: its
// subject IS the build under a corpus that is offline, slow, lying or dead, so
// each variant needs its own run. The plain offline builds go through
// `siteBuild` instead and reuse the suite's one shared tree (#324).
const build = (outDir, env) => buildInto(outDir, env);
const offlineSite = () => siteBuild('help');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'help-'));

describe('the search bug on #145', () => {
  test("the operator's exact query finds the client-workspaces section", () => {
    const hits = H.search(INDEX, OPERATOR_QUERY);
    assert.ok(hits.length, 'the query that started this row still returns nothing');

    const top = hits[0];
    assert.equal(top.article.name, '08-workspace.md',
      `expected 08-workspace.md, got ${top.article.name}`);
    assert.equal(top.matched, top.terms, 'the top hit should match every meaningful term');

    // The section, not merely the file. This is the heading the reader is
    // dropped at, and 08-workspace.md is 21k characters long.
    const headings = top.snippets.map(s => s.heading);
    assert.ok(headings.some(h => h && /more than one workspace/i.test(h)),
      `expected the client-workspaces section, got ${JSON.stringify(headings)}`);

    // And the answer itself is in the snippet the reader sees.
    const text = top.snippets.map(s => s.snippet.before + s.snippet.match + s.snippet.after).join(' ');
    assert.match(text, /client workspace/i);

    // And the reader is actually thrown there. This asserted only the heading
    // *label* at first and passed while `anchor` was undefined — the jump
    // silently degraded to the top of a 21k-character guide, which is the
    // half of "jump to the nearest heading" that the reader can feel.
    const jump = top.snippets.find(s => s.heading && /more than one workspace/i.test(s.heading));
    assert.equal(jump.anchor, 'workspace--more-than-one-workspace');
  });

  test('the query it used to work for still works', () => {
    const hits = H.search(INDEX, 'client workspace');
    assert.equal(hits[0].article.name, '08-workspace.md');
  });

  test('this is the exact behaviour the old whole-query match could not have', () => {
    // The bug, reproduced: `lower.indexOf(q)` over the plain text of every
    // article. Nothing in the corpus contains the operator's question as a
    // literal substring, which is why the page said nothing matched.
    const q = OPERATOR_QUERY.toLowerCase();
    const anySubstring = INDEX.some(a => a.plain.toLowerCase().indexOf(q) > -1);
    assert.equal(anySubstring, false,
      'the corpus now contains the query verbatim, so this test no longer proves anything — pick another natural-language question');
  });
});

describe('every anchor search hands out is a real id on the page', () => {
  // The search and the renderer derive the anchor separately — one from the
  // plain-text index, one from the markdown — so they can disagree silently.
  // A wrong anchor is not an error anywhere: the browser just does nothing.
  test('across every guide and every heading', () => {
    for (const article of INDEX) {
      const ids = new Set([...article.html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]));
      for (const h of article.plainHeadings) {
        assert.ok(ids.has(h.id),
          `${article.name}: search would jump to #${h.id}, which is on no element`);
      }
    }
  });

  test('and the anchors survive into the built page', () => {
    // Since #166 a guide's anchors are on the guide's OWN page. A search hit
    // that reads `/help/sharing/#sharing--revoking` is only an answer if that
    // id is really on that page; a wrong anchor is not an error anywhere,
    // the browser just does nothing.
    const out = offlineSite().dir;
    for (const article of INDEX) {
      const page = path.join(out, 'help', article.slug, 'index.html');
      assert.ok(fs.existsSync(page), `${article.slug} has no page of its own`);
      const html = fs.readFileSync(page, 'utf8');
      for (const h of article.plainHeadings) {
        assert.ok(html.includes(`id="${h.id}"`), `#${h.id} is not in the served HTML of /help/${article.slug}/`);
      }
    }
  });
});

describe('per-term scoring', () => {
  test('stop-words are dropped, so the question words carry no weight', () => {
    assert.deepEqual(H.terms('how can I create a new workspace').map(t => t.word),
      ['create', 'new', 'workspace']);
  });

  test('a query of nothing but stop-words still searches rather than dying', () => {
    // Falling back to "nothing matches" is the failure this row exists to fix.
    assert.ok(H.terms('how do i').length > 0);
  });

  test('simple plurals and stems fold together', () => {
    assert.equal(H.stem('workspaces'), H.stem('workspace'));
    assert.equal(H.stem('revoked'), H.stem('revoke'));
    assert.equal(H.stem('sharing'), H.stem('shared'));
    assert.equal(H.stem('companies'), H.stem('company'));
  });

  test('every meaningful term must appear somewhere in the article', () => {
    const hits = H.search(FIXTURE, 'revoke a share link');
    assert.equal(hits[0].article.name, '04-sharing.md');
    assert.equal(hits[0].partial, false);
    // Getting started mentions neither, so it is not among the full matches.
    assert.ok(!hits.filter(h => !h.partial).some(h => h.article.name === '01-getting-started.md'));
  });

  test('title beats body', () => {
    const hits = H.search(FIXTURE, 'sharing');
    assert.equal(hits[0].article.name, '04-sharing.md');
  });

  test('a term nothing has still returns nothing', () => {
    assert.deepEqual(H.search(INDEX, 'zzzunfindable'), []);
  });

  test('a partly-matching query says so rather than implying a full answer', () => {
    const hits = H.search(FIXTURE, 'revoke a zzzunfindable link');
    assert.ok(hits.length, 'a partial match should still answer');
    assert.equal(hits[0].partial, true);
  });
});

describe("bodyOf — the guide's title, said once (#166)", () => {
  test('the leading title heading is dropped and nothing else is', () => {
    const g = H.buildIndex([{ name: '04-sharing.md',
      text: '# Sharing a pitch\n\nA share link travels by email.\n\n## Revoking a link\n\nRevoke it.\n' }])[0];
    assert.match(g.html, /^<h2 id="sharing--sharing-a-pitch">/);
    const body = H.bodyOf(g.html);
    assert.equal(/Sharing a pitch/.test(body), false, 'the title survived into the body');
    assert.match(body, /id="sharing--revoking-a-link"/, 'a real section heading was dropped');
    assert.match(body, /A share link travels by email/);
  });

  test('every anchor the search hands out survives it', () => {
    // The one thing that would make this dangerous: dropping a heading that
    // something links to. Only level-2-and-deeper headings are ever linked,
    // and the dropped one is the h1-turned-h2 — this asserts that, over the
    // real corpus rather than over the reasoning.
    for (const a of INDEX) {
      const body = H.bodyOf(a.html);
      for (const h of a.plainHeadings)
        assert.ok(body.includes(`id="${h.id}"`), `${a.name}: bodyOf dropped #${h.id}`);
    }
  });

  test('a guide with no leading heading is left alone', () => {
    assert.equal(H.bodyOf('<p>Just prose.</p>'), '<p>Just prose.</p>');
  });
});

describe('the corpus hash — the "no double render" check', () => {
  test('the same corpus hashes the same, a changed one does not', () => {
    assert.equal(H.corpusHash(CORPUS.files), H.corpusHash(CORPUS.files.slice()));
    const moved = CORPUS.files.map((f, i) => i ? f : { ...f, text: f.text + '\n' });
    assert.notEqual(H.corpusHash(CORPUS.files), H.corpusHash(moved));
  });

  test('order matters, because a reordered corpus renders a reordered hub', () => {
    const swapped = CORPUS.files.slice();
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    assert.notEqual(H.corpusHash(CORPUS.files), H.corpusHash(swapped));
  });
});

describe('the prerendered help section (#136, split by #166)', () => {
  let out, hub, guidePages;
  before(() => {
    out = offlineSite().dir;
    hub = fs.readFileSync(path.join(out, 'help', 'index.html'), 'utf8');
    guidePages = new Map(INDEX.map(a => {
      const file = path.join(out, 'help', a.slug, 'index.html');
      return [a.slug, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null];
    }));
  });

  const bodyText = html => html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();

  test('every guide has its own URL', () => {
    for (const a of INDEX)
      assert.ok(guidePages.get(a.slug), `/help/${a.slug}/ was not built`);
  });

  test('and its text is really on it, not the word Loading', () => {
    for (const a of INDEX) {
      const html = guidePages.get(a.slug);
      assert.equal(/Loading…/.test(html), false, `/help/${a.slug}/ is a Loading… shell`);
      // The guide's first heading below the title, verbatim, in the bytes.
      const heading = a.plainHeadings[0];
      if (heading) assert.ok(html.includes(`id="${heading.id}"`),
        `/help/${a.slug}/ does not carry its own body`);
      assert.ok(bodyText(html).length > 400, `/help/${a.slug}/ has almost no body copy`);
    }
  });

  test('the answer to the screenshot question is in the served bytes', () => {
    assert.match(guidePages.get('workspace'), /New client workspace/);
  });

  test('the help section still carries the long-tail content #136 bought', () => {
    // #136's own assertion was "more than 20,000 characters of body copy on
    // /help/". #166 moved that copy onto eleven URLs, so the same claim is
    // made of the section. Deliberately NOT a per-page floor and deliberately
    // not a count of pages: writing a twelfth guide, or a short one, must
    // never turn this red (#131).
    const total = [...guidePages.values()].reduce((n, html) => n + bodyText(html).length, 0);
    assert.ok(total > 20000, `only ${total} characters of guide copy across the section`);
  });

  test('and no guide is served on two URLs at once', () => {
    // The failure mode that would silently undo this row: leave the stacked
    // copy on the hub as well, and every guide competes with itself. The hub
    // may name a guide — the cards do — but it must not carry its body.
    for (const a of INDEX) {
      assert.equal(hub.includes(`id="guide-${a.slug}"`), false,
        `the hub still renders ${a.slug}'s body — it is duplicated with /help/${a.slug}/`);
      for (const h of a.plainHeadings)
        assert.equal(hub.includes(`id="${h.id}"`), false,
          `the hub still carries ${a.slug}'s heading "${h.text}"`);
    }
  });

  test('the hub is a directory: a card per guide, each linking to its page', () => {
    assert.equal((hub.match(/class="card"/g) || []).length, CORPUS.files.length);
    for (const a of INDEX)
      assert.ok(hub.includes(`href="/help/${a.slug}/"`),
        `the hub has no link to /help/${a.slug}/`);
  });

  test('the hub tells the browser which guides got a page', () => {
    // `data-pages` is the whole of how help.js tells a guide with a URL from
    // one the studio added since the build. If it is empty or partial, every
    // link on the hub silently reverts to a same-page anchor.
    const pages = (hub.match(/data-pages="([^"]*)"/) || [])[1].split(' ').filter(Boolean);
    assert.deepEqual(pages.sort(), INDEX.map(a => a.slug).sort());
  });

  test('the search box the operator asked to keep is still there', () => {
    assert.match(hub, /id="helpSearch"/);
  });

  test('and the search index it needs is still embedded, hash and all', () => {
    const embedded = JSON.parse(hub.match(/id="helpCorpus">([\s\S]*?)<\/script>/)[1]);
    const stamped = hub.match(/data-corpus-hash="([a-f0-9]+)"/)[1];
    assert.equal(embedded.hash, stamped);
    assert.equal(H.corpusHash(embedded.files), stamped,
      'the browser would re-render on load — that is the double render this stamp exists to prevent');
  });

  test('each guide page stamps its own hash, not the corpus hash', () => {
    // A guide page only cares whether ITS markdown moved. Stamping the whole
    // corpus would make every page re-render whenever any guide changed.
    const corpusHash = H.corpusHash(CORPUS.files);
    for (const f of CORPUS.files) {
      const slug = H.slugOf(f.name);
      const stamped = (guidePages.get(slug).match(/data-guide-hash="([a-f0-9]+)"/) || [])[1];
      assert.equal(stamped, H.corpusHash([{ name: f.name, text: f.text }]),
        `/help/${slug}/ stamps the wrong hash`);
      assert.notEqual(stamped, corpusHash, `/help/${slug}/ stamped the corpus hash`);
    }
  });

  test("a guide's title is said once, as the page's h1", () => {
    for (const a of INDEX) {
      const html = guidePages.get(a.slug);
      const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map(m => m[1].trim());
      assert.deepEqual(h1s, [H.esc(a.title)], `/help/${a.slug}/ h1s: ${JSON.stringify(h1s)}`);
      // render() emits the guide's own `# Title` as an <h2>; bodyOf() takes it
      // out here, because the <h1> above already says it.
      assert.equal(new RegExp(`<h2[^>]*>${a.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`).test(html), false,
        `/help/${a.slug}/ says its title twice`);
    }
  });

  test('every guide page is reachable from three others, not one', () => {
    // #137's finding, applied before it can happen here: five of nine articles
    // had exactly one inbound link because "related" sorted by date, and the
    // link graph is how Google reads which pages of a section matter. The ring
    // makes the count identical for every guide by construction.
    const inbound = Object.fromEntries(INDEX.map(a => [a.slug, 0]));
    for (const a of INDEX) {
      const links = new Set([...guidePages.get(a.slug).matchAll(/href="\/help\/([^"\/#?]+)\/"/g)].map(m => m[1]));
      for (const to of links) if (to !== a.slug && to in inbound) inbound[to]++;
    }
    const counts = [...new Set(Object.values(inbound))];
    assert.equal(counts.length, 1, `guides do not share one inbound count: ${JSON.stringify(inbound)}`);
    assert.ok(counts[0] >= 3, `each guide has only ${counts[0]} inbound guide links`);
  });

  test('the sitemap asks for every guide, derived rather than listed', () => {
    const sm = fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
    for (const a of INDEX)
      assert.ok(sm.includes(`<loc>https://prospektor.ai/help/${a.slug}/</loc>`),
        `/help/${a.slug}/ is not in the sitemap`);
    assert.ok(sm.includes('<loc>https://prospektor.ai/help/</loc>'), 'the hub left the sitemap');
  });

  test('the FAQ block is valid FAQPage structured data', () => {
    // Found by type, not by position: since #137 every page also carries a
    // sitewide Organization/WebSite graph, and it is emitted first.
    const ld = [...hub.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map(m => JSON.parse(m[1])).find(v => v['@type'] === 'FAQPage');
    assert.ok(ld, 'no FAQPage block on /help/');
    assert.ok(ld.mainEntity.length >= 4);
    for (const q of ld.mainEntity) {
      assert.equal(q['@type'], 'Question');
      assert.ok(q.name && q.acceptedAnswer.text);
      // The visible <dt> and the structured data come from one frontmatter
      // list; if that ever forks, this catches it.
      assert.ok(hub.includes(q.name), `${q.name} is in the JSON-LD but not on the page`);
    }
  });

  test('a single h1 on the hub, over a grid of cards', () => {
    assert.equal((hub.match(/<h1/g) || []).length, 1);
  });
});

describe('a studio outage must never break the build', () => {
  test('endpoint unreachable: the build succeeds from the snapshot', () => {
    const out = tmp();
    build(out, { HELP_CORPUS_OFFLINE: '', HELP_API: 'http://127.0.0.1:9/api/help', HELP_CORPUS_TIMEOUT_MS: '2000' });
    assert.match(fs.readFileSync(path.join(out, 'help', 'workspace', 'index.html'), 'utf8'),
      /New client workspace/);
  });

  test('endpoint lying: an app shell with a 200 on it is not a corpus', async () => {
    // #131 hit exactly this — a path expected to be a file served the app
    // shell, with a perfectly good status code on it.
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>studio</title>');
    });
    await new Promise(r => server.listen(0, r));
    try {
      const out = tmp();
      build(out, { HELP_CORPUS_OFFLINE: '', HELP_API: `http://127.0.0.1:${server.address().port}/api/help` });
      assert.match(fs.readFileSync(path.join(out, 'help', 'workspace', 'index.html'), 'utf8'),
        /New client workspace/, 'the build did not fall back to the snapshot');
    } finally {
      server.close();
    }
  });

  test('corpus present but malformed: rejected, and the snapshot is used', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ files: [{ name: '01-x.md', text: '' }] }));
    });
    await new Promise(r => server.listen(0, r));
    try {
      const out = tmp();
      build(out, { HELP_CORPUS_OFFLINE: '', HELP_API: `http://127.0.0.1:${server.address().port}/api/help` });
      assert.ok(fs.existsSync(path.join(out, 'help', 'workspace', 'index.html')),
        'the build did not fall back to the snapshot');
      assert.equal(fs.existsSync(path.join(out, 'help', 'x', 'index.html')), false,
        'an empty guide was accepted and given a URL');
    } finally {
      server.close();
    }
  });

  test('no snapshot and no studio: the page still ships, runtime-only', () => {
    const snapshot = path.join(ROOT, 'data', 'help-corpus.json');
    const kept = fs.readFileSync(snapshot);
    try {
      fs.unlinkSync(snapshot);
      const out = tmp();
      build(out, { HELP_CORPUS_OFFLINE: '', HELP_API: 'http://127.0.0.1:9/api/help', HELP_CORPUS_TIMEOUT_MS: '2000' });
      const html = fs.readFileSync(path.join(out, 'help', 'index.html'), 'utf8');
      // Nothing prerendered — but the build succeeded and the page is the
      // pre-#136 runtime-only page rather than a failed deploy. Since #166
      // that also means no guide has a URL, so `data-pages` is empty and
      // help.js renders every guide inline on the hub, exactly as it did
      // before this row existed. That is the correct degradation, not a bug.
      assert.match(html, /id="helpSearch"/);
      assert.match(html, /helpGuides/);
      assert.match(html, /data-pages=""/);
      assert.deepEqual(fs.readdirSync(path.join(out, 'help')), ['index.html'],
        'guide pages were built from a corpus the build never had');
      const sm = fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
      assert.equal(/help\/[a-z-]+\//.test(sm), false,
        'the sitemap asks for guide URLs the build did not write');
    } finally {
      fs.writeFileSync(snapshot, kept);
    }
  });
});

/* #185 — the fallback chain had no clock on it.

   The four tests above rehearse a studio that is DEAD: refusing the
   connection, serving an app shell, serving a malformed corpus. All three fail
   *fast*, which is why the fallback worked. A studio that accepts the
   connection and then says nothing fails not at all — and every fetch of
   /api/help in this repo was unbounded, so the build waited, `npm run
   help:snapshot` waited, and in the browser the promise simply never settled:
   no catch, no "showing the build-time copy" line, and on a page that
   prerendered nothing, no "Try again" button either. A hang is not a slow
   failure, it is the absence of one.

   `hangingServer()` is the missing fixture — it accepts and never answers. */
function hangingServer() {
  const sockets = [];
  const server = http.createServer((req, res) => { sockets.push(res); });
  server.on('connection', (s) => sockets.push(s));
  return {
    server,
    listen: () => new Promise((r) => server.listen(0, r)),
    url: () => `http://127.0.0.1:${server.address().port}/api/help`,
    close: () => {
      for (const s of sockets) { try { s.destroy ? s.destroy() : s.end(); } catch (e) {} }
      server.close();
    },
  };
}

describe('a hanging studio is a failure, not a wait (#185)', () => {
  test('fetchCorpus rejects on its own deadline rather than pending forever', async () => {
    const h = hangingServer();
    await h.listen();
    try {
      const began = Date.now();
      await assert.rejects(H.fetchCorpus(h.url(), 300), /no answer in 300ms/);
      // The deadline is the point: it has to be the thing that ends the wait.
      assert.ok(Date.now() - began < 3000, 'the deadline did not end the wait');
    } finally {
      h.close();
    }
  });

  test('and still resolves, or rejects, on the ordinary answers', async () => {
    const good = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ files: [{ name: '01-x.md', text: '# X\n\nyes.\n' }] }));
    });
    await new Promise((r) => good.listen(0, r));
    const bad = http.createServer((req, res) => { res.writeHead(500); res.end('nope'); });
    await new Promise((r) => bad.listen(0, r));
    try {
      const body = await H.fetchCorpus(`http://127.0.0.1:${good.address().port}/api/help`, 5000);
      assert.equal(body.files.length, 1);
      await assert.rejects(H.fetchCorpus(`http://127.0.0.1:${bad.address().port}/api/help`, 5000), /HTTP 500/);
      await assert.rejects(H.fetchCorpus('http://127.0.0.1:9/api/help', 5000), (e) => !/no answer/.test(e.message));
    } finally {
      good.close();
      bad.close();
    }
  });

  test('the deadline is short enough that the reader is not waiting on it', () => {
    // The guides are already in the HTML since #136; this fetch only
    // reconciles. Three seconds is the argument, and a later edit that
    // quietly raises it to thirty should have to change this line.
    assert.ok(H.CORPUS_TIMEOUT_MS <= 3000, `${H.CORPUS_TIMEOUT_MS}ms is too long to hold a reader`);
  });

  test('both runtime fetches of the corpus go through it', () => {
    // Not a style check: a new `fetch(API)` added to either file is exactly
    // the bug this row fixed, and it would pass every other test here.
    for (const f of ['help.js', 'help-guide.js']) {
      const src = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'js', f), 'utf8');
      assert.match(src, /H\.fetchCorpus\(API/, `${f} does not fetch the corpus with a deadline`);
      assert.equal(/[^.\w]fetch\(API/.test(src), false, `${f} still fetches the corpus without one`);
    }
  });

  test('the build survives a studio that hangs, from the snapshot', async () => {
    const h = hangingServer();
    await h.listen();
    try {
      const out = tmp();
      build(out, { HELP_CORPUS_OFFLINE: '', HELP_API: h.url(), HELP_CORPUS_TIMEOUT_MS: '1500' });
      assert.match(fs.readFileSync(path.join(out, 'help', 'workspace', 'index.html'), 'utf8'),
        /New client workspace/, 'the build did not fall back to the snapshot');
    } finally {
      h.close();
    }
  });
});
