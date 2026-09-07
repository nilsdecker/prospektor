'use strict';

// #109 — the DPA carries the connector model, and the terms bind it.
//
// The operator's decision of 23 Aug 2026 was "no Slack limitations — update
// our TOS", and #108 has since shipped a connector that stores third parties'
// Slack messages. A ToS binds the customer only, so the instrument is the
// standard one: the customer is controller, Prospektor is processor, the terms
// carry a warranty that the customer may connect what they connect, and the
// retention rule for ingested content states what the code does (each read
// replaces the last; Disconnect deletes everything read; 90 days).
//
// What this pins is the set of sentences that would go silently untrue if
// somebody trimmed the pages: the roles, the warranty, and the three retention
// facts — because those are the ones `DATA-HANDLING.md` §3f in the studio
// says the code holds, and a legal page that stops saying them is the
// false-by-omission case. Nothing here counts sections or words: a fourteenth
// section, or a shorter one, never turns this red.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { siteBuild } = require('./helpers.js');

let built;
const page = p => fs.readFileSync(path.join(built.dir, ...p.split('/').filter(Boolean), 'index.html'), 'utf8');
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/&#39;|&rsquo;/g, "'")
  .replace(/&mdash;/g, '—').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('#109 — the DPA carries the connector model, and the terms bind it', () => {
  before(() => { built = siteBuild('dpa'); });
  after(() => built && built.cleanup());

  test('/dpa/ builds, and the sitemap asks for it to be ranked', () => {
    assert.ok(fs.existsSync(path.join(built.dir, 'dpa', 'index.html')), '/dpa/ did not build');
    const xml = fs.readFileSync(path.join(built.dir, 'sitemap.xml'), 'utf8');
    assert.match(xml, /<loc>https:\/\/prospektor\.ai\/dpa\/<\/loc>/, 'sitemap is missing /dpa/');
  });

  test('the DPA names the roles — customer as controller, Prospektor as processor', () => {
    const t = text(page('/dpa/'));
    assert.match(t, /You are the controller of everything inside your workspace/);
    assert.match(t, /We are the processor/);
  });

  test('the DPA states the retention rule for connected content that the code holds', () => {
    // DATA-HANDLING.md §3f, verbatim facts: a 90-day window, each read
    // replacing the last, Disconnect deleting every channel record.
    const t = text(page('/dpa/'));
    assert.match(t, /the last 90 days/, 'the 90-day window is not stated');
    assert.match(t, /replaces what the previous read held/, 'each-read-replaces-the-last is not stated');
    assert.match(t, /Disconnect deletes everything read/, 'Disconnect-deletes is not stated');
  });

  test('the terms make the DPA part of themselves and carry the connector warranty', () => {
    const html = page('/terms/');
    assert.ok(html.includes('href="/dpa/"'), '/terms/ does not link to /dpa/');
    assert.ok(/<section class="legal-block" id="connect">/.test(html), '/terms/ has no "Connecting your own tools" section');
    const t = text(html);
    assert.match(t, /allowed to give us that access/, 'the right-to-connect warranty is gone');
    assert.match(t, /notice to them is yours to give/, 'the notice-to-your-own-people clause is gone');
    assert.match(t, /is part of these terms/, 'the DPA is no longer incorporated into the terms');
  });

  test('the terms\' contents list matches the numbered sections on the page', () => {
    // The list and the sections are hand-numbered separately, and they had
    // drifted (the list skipped the marketing section, so it said 06 where the
    // page said 07). Derived from the page: any section added later either
    // appears in the list under its own number, or this names it.
    const html = page('/terms/');
    const toc = [...html.matchAll(/<a href="#([^"]+)"><span class="legal-toc-n">(\d+)<\/span>/g)]
      .map(m => [m[1], m[2]]);
    const sections = [...html.matchAll(/<section class="legal-block" id="([^"]+)">\s*<span class="legal-n">(\d+)<\/span>/g)]
      .map(m => [m[1], m[2]]);
    assert.deepEqual(toc, sections, 'the contents list and the section numbers disagree');
  });

  test('/privacy/ §01 points at the DPA instead of calling the split unsettled', () => {
    const html = page('/privacy/');
    assert.ok(html.includes('href="/dpa/"'), '/privacy/ does not link to /dpa/');
    assert.doesNotMatch(text(html), /settling the formal split/, 'the privacy page still says the split is being settled');
  });

  test('the footer reaches the DPA from every page', () => {
    const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : e.name === 'index.html' ? [path.join(dir, e.name)] : []);
    const missing = walk(built.dir).filter(f => !fs.readFileSync(f, 'utf8').includes('href="/dpa/"'))
      .map(f => path.relative(built.dir, f));
    assert.deepEqual(missing, [], 'pages whose footer does not reach /dpa/');
  });
});
