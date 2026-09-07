'use strict';

// The contact form (#456), and the four ways it fails silently.
//
// A form is not like a page: a page that breaks is visibly broken, and a form
// that breaks accepts the submission, says thank you, and drops it. Nobody
// finds out until somebody asks why we never replied. So each of these pins a
// failure that production would NOT show:
//
//   - the success URL is a page the build does not write. `netlify.toml` ends
//     in a `/*` → `/404.html` catch-all; Netlify handles the POST ahead of
//     redirects, so the message IS captured and the person who just wrote to
//     us gets a 404 as their receipt;
//   - the `form-name` hidden input goes missing. Netlify needs the form's name
//     in the POST body itself; without it the submission is accepted and filed
//     under nothing;
//   - the Netlify attributes come off the tag, so the form is never registered
//     at deploy time at all and every POST lands on the catch-all;
//   - reCAPTCHA arrives. That is the #456 decision reversed by accident: it
//     puts an active Google script on the page, which lands on consent.js's
//     gate, on privacy §08's table and on §12's transfer paragraph. If it is
//     ever genuinely wanted it is its own row, with those three documents in
//     it — never a quiet import.
//
// The fifth is not a mechanism but a promise: `llms.txt` says *"No sales call.
// The price is on the page and checkout is the next click"*, and a contact form
// is the obvious way to reintroduce a qualification call by the back door. That
// check is a list of CLAIM shapes, never of files — the same construction as
// the free-offering denials in pages.test.js, and for the same reason (#131):
// writing a new page cannot turn it red, only asking somebody to book a call.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const site = require('../src/_data/site.json');
const { siteBuild } = require('./helpers.js');

let SITE, built;
const read = p => fs.readFileSync(path.join(SITE, p), 'utf8');
const htmlPages = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? htmlPages(path.join(dir, e.name))
    : e.name.endsWith('.html') ? [path.join(dir, e.name)] : []);

// The whole <form …> open tag, however many lines the template broke it over.
const formTag = html => (html.match(/<form\b[^>]*class="contact-form"[^>]*>/s)
  || html.match(/<form\b[^>]*name="contact"[^>]*>/s) || [null])[0];

describe('the contact form (#456)', () => {
  before(() => { built = siteBuild('contact'); SITE = built.dir; });
  after(() => built && built.cleanup());

  test('the form posts to a page the build actually writes', () => {
    const tag = formTag(read('contact/index.html'));
    assert.ok(tag, '/contact/ has no contact form at all');
    const action = (tag.match(/\saction="([^"]*)"/) || [])[1];
    assert.ok(action, 'the contact form has no action — it would post to itself');
    assert.ok(action.startsWith('/'), `action ${action} is not an internal URL`);
    const target = path.join(SITE, action.replace(/^\//, ''), 'index.html');
    assert.ok(fs.existsSync(target),
      `the form's success page ${action} is not written by the build — netlify.toml's `
      + `/* → /404.html catch-all would answer it, so the message is captured and the `
      + `person who sent it gets a 404 as their receipt`);
  });

  test('the success page is noindex and out of the sitemap', () => {
    // The /checkout/done/ case: thin, transactional, meaningless cold.
    const thanks = read('contact/thanks/index.html');
    assert.match(thanks, /<meta name="robots" content="noindex/,
      '/contact/thanks/ is indexable — a thank-you page answers no search');
    assert.doesNotMatch(read('sitemap.xml'), /<loc>[^<]*\/contact\/thanks\//,
      '/contact/thanks/ is in the sitemap');
  });

  test('Netlify is told this is a form, and told which form it is', () => {
    const tag = formTag(read('contact/index.html'));
    // Either spelling registers it; the site already uses the bare attribute
    // for `founding-spot` on /checkout/, so both are accepted deliberately.
    assert.ok(/\snetlify\b|\sdata-netlify="true"/.test(tag),
      'the form carries neither `netlify` nor `data-netlify="true"` — Netlify never '
      + 'registers it at deploy time and every submission hits the catch-all');
    assert.match(tag, /\sname="contact"/, 'the form has no name for Netlify to file under');
    assert.match(read('contact/index.html'),
      /<input type="hidden" name="form-name" value="contact">/,
      'the form-name hidden input is gone — Netlify accepts the POST and files it under nothing');
  });

  test('spam control is the honeypot, not a Google script', () => {
    const html = read('contact/index.html');
    const tag = formTag(html);
    const field = (tag.match(/netlify-honeypot="([^"]*)"/) || [])[1];
    assert.ok(field, 'the honeypot declaration is gone from the form tag (#456)');
    assert.ok(html.includes(`name="${field}"`),
      `the form declares the honeypot "${field}" but never renders the field`);
    assert.doesNotMatch(html, /recaptcha|gstatic\.com|google\.com\/recaptcha/i,
      'reCAPTCHA is on /contact/ — #456 chose the honeypot precisely to keep an active '
      + 'Google script off this page: it lands on consent.js\'s gate, on privacy §08\'s '
      + 'table and on §12\'s transfer paragraph. That is its own row, not a quiet import');
  });

  test('both doors are on every page — the nav and the footer', () => {
    // The operator asked for two: *"reachable both via the main nav and
    // footer"*. pages.test.js derives the header from site.json and already
    // covers the nav on every page; nothing covered the footer, and the footer
    // entry is deliberately NOT in site.legal (Contact is not a legal page),
    // so no derived check would have reached it.
    const inNav = site.nav.some(i => i.url === '/contact/');
    assert.ok(inNav, 'Contact has left site.nav — the header door is gone (#456)');
    // In the page's own language since #535: /de/… links /de/contact/,
    // derived from lib/i18n.js the way the footer derives it.
    const i18n = require('../lib/i18n.js');
    for (const p of htmlPages(SITE)) {
      const html = fs.readFileSync(p, 'utf8');
      const footer = (html.match(/<footer[\s\S]*?<\/footer>/) || [''])[0];
      const url = '/' + path.relative(SITE, p).replace(/index\.html$/, '').replace(/\\/g, '/');
      const twin = i18n.twin('/contact/', i18n.localeOf(url));
      const want = fs.existsSync(path.join(SITE, twin, 'index.html')) ? twin : '/contact/';
      assert.ok(footer.includes(`href="${want}"`),
        `${path.relative(SITE, p)} has no Contact link in its footer — the operator asked `
        + 'for two doors and this is the second');
    }
  });

  test('the contact page does not reintroduce the sales call', () => {
    // llms.txt: "No sales call. The price is on the page and checkout is the
    // next click." Claim shapes, never a list of files.
    //
    // Scoped to the two pages this deliverable owns, and that scope is the
    // claim rather than a convenience. Run sitewide it fails on three honest
    // sentences: /help/ tells a PAYING customer they can "Book a time" for
    // onboarding — a different thing from a pre-sale qualification call, and
    // it comes from the studio's corpus, which this repo only renders and
    // cannot fix — and an article quotes another company's "book a demo"
    // button in an anecdote about their funnel. What llms.txt denies is a call
    // between a stranger and the price. That is a property of the BUYING path,
    // so this is where it is asserted; a check that also policed the editorial
    // would be paid for by deleting true sentences.
    const CALL = [
      /book\s+(?:a|your)\s+(?:call|demo|meeting|time)/i,
      /schedule\s+(?:a|your)\s+(?:call|demo|meeting)/i,
      /request\s+(?:a|your)\s+demo/i,
      /talk\s+to\s+(?:a\s+)?sales/i,
      /speak\s+to\s+(?:a\s+)?(?:sales|rep|representative)/i,
      /get\s+a\s+quote/i,
    ];
    const found = [];
    for (const page of ['contact/index.html', 'contact/thanks/index.html']) {
      const text = read(page).replace(/<[^>]*>/g, ' ');
      for (const re of CALL) {
        const m = text.match(re);
        if (m) found.push(`${page} → ${JSON.stringify(m[0])}`);
      }
    }
    assert.deepEqual(found, [],
      'llms.txt promises "No sales call. The price is on the page and checkout is the next '
      + 'click" — a contact form is the obvious way to walk that back by accident (#456):\n  '
      + found.join('\n  '));
  });

  test('the form asks for three things, and the privacy page says so', () => {
    // §03 enumerates what the form collects. A field added here and not there
    // makes the privacy page incomplete — the #430 failure shape, where every
    // pinned sentence stays true while the published list stops being whole.
    const tag = formTag(read('contact/index.html'));
    const honeypot = (tag.match(/netlify-honeypot="([^"]*)"/) || [])[1];
    const form = read('contact/index.html').slice(read('contact/index.html').indexOf(tag));
    const named = [...form.slice(0, form.indexOf('</form>')).matchAll(/\sname="([^"]+)"/g)]
      .map(m => m[1])
      .filter(n => n !== 'form-name' && n !== honeypot && n !== 'contact');
    assert.deepEqual([...new Set(named)].sort(), ['email', 'message', 'name'],
      'the contact form\'s fields have changed — privacy §03 enumerates exactly what it '
      + 'collects, so update that section in the same commit (#456)');
  });
});
