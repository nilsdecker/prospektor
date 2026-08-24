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
//     sentence and the word "Loading…";
//   - and the rule that a studio outage must never break a website deploy.
//     Three of these tests build the site with the endpoint dead or lying and
//     assert the build still succeeds — a build that fails because an
//     unrelated service blinked is a worse bug than the one being fixed.
const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const H = require('../src/assets/js/help-render.js');

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

const build = (outDir, env) => execFileSync('npx', ['@11ty/eleventy', '--quiet', '--output=' + outDir], {
  cwd: ROOT, stdio: 'pipe', env: { ...process.env, ...env },
});

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

describe('the prerendered page (#136)', () => {
  let html, out;
  before(() => {
    out = tmp();
    build(out, { HELP_CORPUS_OFFLINE: '1' });
    html = fs.readFileSync(path.join(out, 'help', 'index.html'), 'utf8');
  });

  test('the served HTML carries every guide, not the word Loading', () => {
    assert.equal(/Loading…/.test(html), false, '/help/ is still shipping a Loading… shell');
    for (const f of CORPUS.files) {
      const slug = H.slugOf(f.name);
      assert.match(html, new RegExp(`id="guide-${slug}"`), `${slug} was not prerendered`);
    }
  });

  test('the answer to the screenshot question is in the served bytes', () => {
    assert.match(html, /New client workspace/);
  });

  test('there is real body copy, not a shell', () => {
    const body = html
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ').trim();
    assert.ok(body.length > 20000, `only ${body.length} characters of body copy`);
  });

  test('the search box the operator asked to keep is still there', () => {
    assert.match(html, /id="helpSearch"/);
  });

  test('the hub renders a card per guide', () => {
    assert.equal((html.match(/class="card"/g) || []).length, CORPUS.files.length);
  });

  test('the embedded corpus matches the stamped hash', () => {
    const embedded = JSON.parse(html.match(/id="helpCorpus">([\s\S]*?)<\/script>/)[1]);
    const stamped = html.match(/data-corpus-hash="([a-f0-9]+)"/)[1];
    assert.equal(embedded.hash, stamped);
    assert.equal(H.corpusHash(embedded.files), stamped,
      'the browser would re-render on load — that is the double render this stamp exists to prevent');
  });

  test('the FAQ block is valid FAQPage structured data', () => {
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(ld['@type'], 'FAQPage');
    assert.ok(ld.mainEntity.length >= 4);
    for (const q of ld.mainEntity) {
      assert.equal(q['@type'], 'Question');
      assert.ok(q.name && q.acceptedAnswer.text);
      // The visible <dt> and the structured data come from one frontmatter
      // list; if that ever forks, this catches it.
      assert.ok(html.includes(q.name), `${q.name} is in the JSON-LD but not on the page`);
    }
  });

  test('a single h1, with ten guides stacked under it', () => {
    assert.equal((html.match(/<h1/g) || []).length, 1);
  });
});

describe('a studio outage must never break the build', () => {
  test('endpoint unreachable: the build succeeds from the snapshot', () => {
    const out = tmp();
    build(out, { HELP_CORPUS_OFFLINE: '', HELP_API: 'http://127.0.0.1:9/api/help', HELP_CORPUS_TIMEOUT_MS: '2000' });
    const html = fs.readFileSync(path.join(out, 'help', 'index.html'), 'utf8');
    assert.match(html, /id="guide-workspace"/);
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
      const html = fs.readFileSync(path.join(out, 'help', 'index.html'), 'utf8');
      assert.match(html, /id="guide-workspace"/, 'the build did not fall back to the snapshot');
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
      const html = fs.readFileSync(path.join(out, 'help', 'index.html'), 'utf8');
      assert.match(html, /id="guide-workspace"/);
      assert.equal(/id="guide-x"/.test(html), false, 'an empty guide was accepted');
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
      // pre-#136 runtime-only page rather than a failed deploy.
      assert.match(html, /id="helpSearch"/);
      assert.match(html, /helpGuides/);
    } finally {
      fs.writeFileSync(snapshot, kept);
    }
  });
});
