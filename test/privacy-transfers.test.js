'use strict';

// §08's two lists have to agree, and until #441 nothing checked that they did.
//
// The section publishes a table of who receives data, and then a sentence
// naming who among them processes it outside the EEA. Both are hand-written,
// the table is where a new recipient gets added, and the sentence is a
// paragraph below it — so for months the table said six and the sentence said
// five. The missing one was **Google**: a US recipient through OAuth sign-in
// since the studio had sign-in at all, present in the table the whole time and
// never once in the transfer sentence. Nothing was false, exactly; the sentence
// was short, which is the failure mode a reader cannot detect, because the one
// thing they use this list for is ruling a company OUT.
//
// The sentence also carried a count — *"all five providers"* — against a table
// of six. A number in prose is a second thing to keep in sync and it is the
// thing that goes stale first, so the sentence states no count now and this
// file fails if one comes back.
//
// Both checks are derived from the table rather than from a list kept here: add
// a seventh recipient and the suite names it, which is the whole point. If a
// provider is ever genuinely inside the EEA, that is the one legitimate reason
// to have a name in the table and not in the sentence — add it to
// INSIDE_THE_EEA below with the reason, the way the studio's own claims file
// keeps its exceptions in the open next to the sentence they are exceptions to.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { siteBuild } = require('./helpers.js');

// Recipients on the table that do NOT belong in the transfer sentence, each
// with the reason it is out. Empty today: every provider we use is American.
const INSIDE_THE_EEA = {};

const strip = html => html.replace(/<[^>]*>/g, ' ').replace(/&mdash;/g, '—')
  .replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();

let built, section;

describe('§08: the transfer sentence names everyone the table does (#441)', () => {
  before(() => {
    built = siteBuild('privacy-transfers');
    const html = fs.readFileSync(path.join(built.dir, 'privacy', 'index.html'), 'utf8');
    const from = html.indexOf('id="tracking"');
    assert.ok(from > -1, 'privacy §08 (id="tracking") is not on the built page');
    const to = html.indexOf('<section', from + 1);
    section = html.slice(from, to > -1 ? to : html.length);
  });
  after(() => built && built.cleanup());

  // The table's first column, read off the built page — never a list held here.
  const providers = () => [...section.matchAll(/<tr>\s*<td>([^<]+)<\/td>/g)]
    .map(m => strip(m[1]));

  // The paragraph that says who is outside the EEA.
  const transferSentence = () => {
    const found = [...section.matchAll(/<p>([\s\S]*?)<\/p>/g)]
      .map(m => strip(m[1]))
      .filter(p => /outside the European Economic Area/.test(p));
    assert.equal(found.length, 1,
      `§08 should hold exactly one transfer paragraph, found ${found.length}`);
    return found[0];
  };

  test('the table is read, and it is not empty', () => {
    const names = providers();
    assert.ok(names.length >= 6,
      `only ${names.length} provider rows parsed out of §08 — the table's markup moved, `
      + 'so this whole file is checking nothing');
  });

  test('every provider on the table is in the transfer sentence', () => {
    const sentence = transferSentence();
    for (const name of providers()) {
      if (name in INSIDE_THE_EEA) continue;
      assert.ok(sentence.includes(name),
        `/privacy/ §08 lists ${name} as a recipient, but the transfer paragraph does not name `
        + `it — a reader ruling ${name} out of "processed outside the EEA" would be wrong. `
        + 'Add it to the sentence, or to INSIDE_THE_EEA in this file with the reason (#441).');
    }
  });

  test('the transfer sentence names nobody the table does not', () => {
    const sentence = transferSentence();
    const upto = sentence.slice(0, sentence.indexOf('all process data'));
    const names = providers();
    for (const word of upto.split(/[,\s]+/).filter(w => /^[A-Z][a-z]+$/.test(w)))
      if (!['That', 'The', 'Ask', 'We'].includes(word))
        assert.ok(names.includes(word),
          `the transfer paragraph names ${word}, who is on no row of §08's table — `
          + 'the table is what a reader checks, so a recipient named in only one of '
          + 'the two is a recipient they cannot look up (#441).');
  });

  test('the transfer sentence states no count', () => {
    const sentence = transferSentence();
    const counted = sentence.match(/\b(all )?(two|three|four|five|six|seven|eight|\d+) providers?\b/i);
    assert.equal(counted, null,
      `the transfer paragraph says "${counted && counted[0]}" — a number in prose is a second `
      + 'list to keep in sync and it is the one that goes stale (it read "all five providers" '
      + 'against a table of six for months). Name them and leave the arithmetic out (#441).');
  });

  test('it does not claim documentation that does not exist', () => {
    const sentence = transferSentence();
    assert.ok(!/working (that|it) through/i.test(sentence),
      'the transfer paragraph says we are "working that through", which is a claim of progress '
      + '`DATA-HANDLING.md` §5 and `OPEN-DECISIONS.md` §6 both contradict ("still undone"). '
      + 'When the safeguard IS documented, say what it is — not that it is in hand (#441).');
  });
});
