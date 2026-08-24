// /resources is one article per useful learning — checked, not trusted (#159).
//
// The operator's ask was "one article per useful learning". #144 shipped a fixed
// list of nine, and a fixed list drifts silently: a learning lands in the
// research, nobody writes it up, and nothing anywhere goes red. `data/learnings.json`
// is the list the section is derived from and these tests are what make it bind.
//
// The failure modes are proven against fixtures rather than by planting a broken
// article in src/resources/, so a red test here always means the real corpus is
// wrong and never means the suite is testing itself.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { report, articles } = require('../tools/learning-coverage.js');

const LEDGER = path.join(__dirname, '..', 'data', 'learnings.json');

describe('the learnings ledger', () => {
  test('every publishable learning has an article, and every article a learning', () => {
    const r = report();
    assert.deepEqual(r.problems, [],
      '\n' + r.problems.map(p => '  - ' + p).join('\n') +
      '\n\nRun `npm run learnings` for the same report.\n');
  });

  test('the ledger says where each learning came from', () => {
    const rows = JSON.parse(fs.readFileSync(LEDGER, 'utf8')).learnings;
    assert.ok(rows.length > 0, 'the ledger is empty');
    for (const row of rows) {
      // Without a `ref` a row cannot be found in the source, which is the only
      // thing that lets a later thread check whether it is still true.
      assert.match(row.ref || '', /\S/, `learning \`${row.id}\` has no source ref`);
      assert.match(row.title || '', /\S/, `learning \`${row.id}\` has no title`);
    }
  });

  test('the ledger names the research it is derived from', () => {
    const d = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
    assert.ok(d.source && d.source.repo && d.source.file,
      'the ledger must name the repo and file its learnings come from — it is the ' +
      'only pointer this repo has to research it cannot see');
  });

  test('every article carries a topic, because the hub filter is derived from it', () => {
    for (const a of articles()) {
      assert.match(a.topic, /\S/,
        `${a.slug} has no \`topic:\` — the /resources filter row is built from these`);
    }
  });
});

describe('the coverage check itself', () => {
  const ok = { id: 'x', ref: '§1.1', title: 'A learning', verdict: 'article', article: 'an-article' };
  const art = { slug: 'an-article', title: 'T', topic: 'pricing', learnings: ['x'] };

  test('a clean pair passes', () => {
    assert.deepEqual(report({ rows: [ok], arts: [art] }).problems, []);
  });

  test('a learning whose article does not exist fails, by name', () => {
    const p = report({ rows: [ok], arts: [] }).problems;
    assert.equal(p.length, 1);
    assert.match(p[0], /an-article.*does not exist/);
  });

  test('a learning the article does not declare fails', () => {
    const p = report({ rows: [ok], arts: [{ ...art, learnings: ['something-else'] }] }).problems;
    assert.ok(p.some(m => /does not declare it/.test(m)), p.join('\n'));
  });

  test('an article declaring an unknown learning fails', () => {
    const p = report({ rows: [ok], arts: [{ ...art, learnings: ['x', 'invented'] }] }).problems;
    assert.ok(p.some(m => /`invented`.*not in/.test(m)), p.join('\n'));
  });

  test('an article with no learning at all fails', () => {
    const p = report({ rows: [], arts: [{ ...art, learnings: [] }] }).problems;
    assert.ok(p.some(m => /declares no `learnings:`/.test(m)), p.join('\n'));
  });

  test('an exclusion without a written reason fails — silence is not an argument', () => {
    const bare = { id: 'y', ref: '§9.9', title: 'A learning', verdict: 'not-publishable' };
    assert.ok(report({ rows: [bare], arts: [] }).problems.some(m => /no written reason/.test(m)));
    assert.ok(report({ rows: [{ ...bare, reason: 'too short' }], arts: [] })
      .problems.some(m => /no written reason/.test(m)));
    assert.deepEqual(
      report({ rows: [{ ...bare, reason: 'It is a build-side decision for this company rather than a finding a reader could act on.' }], arts: [] }).problems, []);
  });

  test('a duplicated learning id fails', () => {
    const p = report({ rows: [ok, { ...ok }], arts: [art] }).problems;
    assert.ok(p.some(m => /appears more than once/.test(m)), p.join('\n'));
  });

  test('writing more articles never turns it red', () => {
    // The #131 lesson, kept as an assertion: nothing here counts. Ten more
    // articles, each with its own learning, must still be clean.
    const rows = [], arts = [];
    for (let i = 0; i < 10; i++) {
      rows.push({ id: 'l' + i, ref: '§1.' + i, title: 'L' + i, verdict: 'article', article: 'a' + i });
      arts.push({ slug: 'a' + i, title: 'T', topic: 'pricing', learnings: ['l' + i] });
    }
    assert.deepEqual(report({ rows, arts }).problems, []);
  });
});
