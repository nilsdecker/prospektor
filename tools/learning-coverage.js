// The /resources coverage report (#159).
//
// /resources/ is defined as one article per useful learning. `data/learnings.json`
// is the list it is derived from; this module is the thing that checks the two
// agree, and it is deliberately a library plus a CLI so `npm test` and
// `npm run learnings` cannot drift apart.
//
// What it checks, in both directions:
//   - a ledger row with verdict `article` names an article that exists on disk,
//     and that article declares the row's id in its `learnings:` frontmatter;
//   - an article does not declare a learning id the ledger has never heard of,
//     and does not sit in the section with no learning at all;
//   - a `not-publishable` row carries a written reason, so an exclusion is
//     somebody's argument rather than a silent omission.
//
// What it deliberately does NOT check: how many articles or rows there are.
// Writing more never turns this red — the same rule the help corpus learned the
// hard way (#131 pinned a file count and adding a help article broke an
// unrelated test, which is friction pointing exactly the wrong way).

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LEDGER = path.join(ROOT, 'data', 'learnings.json');
const SRC = path.join(ROOT, 'src', 'resources');

// Minimal frontmatter read, same shape as tools/og.js: the block between the
// first two `---` lines. Going through Eleventy for two string fields would make
// this depend on a build.
function frontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1).replace(/\\"/g, '"');
    }
    out[kv[1]] = v;
  }
  return out;
}

function articles() {
  return fs.readdirSync(SRC)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const fm = frontmatter(path.join(SRC, f)) || {};
      return {
        slug: f.replace(/\.md$/, ''),
        title: fm.title || '',
        topic: fm.topic || '',
        learnings: (fm.learnings || '').split(',').map(s => s.trim()).filter(Boolean)
      };
    });
}

// `rows` and `arts` are injectable so the failure modes below can be proven red
// against fixtures, without planting a broken article in src/resources/ to do it.
function report({ rows, arts } = {}) {
  rows = rows || JSON.parse(fs.readFileSync(LEDGER, 'utf8')).learnings || [];
  arts = arts || articles();
  const bySlug = new Map(arts.map(a => [a.slug, a]));
  const problems = [];

  const seen = new Set();
  for (const row of rows) {
    if (!row.id) { problems.push('A ledger row has no `id`.'); continue; }
    if (seen.has(row.id)) problems.push(`Ledger id \`${row.id}\` appears more than once.`);
    seen.add(row.id);

    if (row.verdict === 'not-publishable') {
      if (!row.reason || row.reason.trim().length < 20) {
        problems.push(
          `Learning \`${row.id}\` (${row.ref}) is excluded with no written reason — ` +
          'say why a reader could not act on it, or give it an article.');
      }
      continue;
    }
    if (row.verdict !== 'article') {
      problems.push(`Learning \`${row.id}\` has verdict \`${row.verdict}\` — expected \`article\` or \`not-publishable\`.`);
      continue;
    }
    const art = bySlug.get(row.article);
    if (!art) {
      problems.push(
        `Learning \`${row.id}\` (${row.ref}) says it is covered by \`${row.article}\`, ` +
        `but src/resources/${row.article}.md does not exist — write it, or change the row.`);
      continue;
    }
    if (!art.learnings.includes(row.id)) {
      problems.push(
        `Learning \`${row.id}\` (${row.ref}) points at \`${row.article}\`, but that article ` +
        `does not declare it. Add \`${row.id}\` to its \`learnings:\` frontmatter.`);
    }
  }

  for (const art of arts) {
    if (!art.learnings.length) {
      problems.push(
        `Article \`${art.slug}\` declares no \`learnings:\`. /resources is one article per ` +
        'useful learning — add the learning to data/learnings.json and name its id here.');
      continue;
    }
    for (const id of art.learnings) {
      if (!seen.has(id)) {
        problems.push(
          `Article \`${art.slug}\` declares learning \`${id}\`, which is not in ` +
          'data/learnings.json. Add the row, or fix the id.');
      }
    }
  }

  const covered = rows.filter(r => r.verdict === 'article');
  const excluded = rows.filter(r => r.verdict === 'not-publishable');
  return {
    problems,
    rows: rows.length,
    covered: covered.length,
    excluded: excluded.length,
    articles: arts.length,
    orphanTopics: [...new Set(arts.map(a => a.topic))].sort()
  };
}

module.exports = { report, articles, frontmatter };

if (require.main === module) {
  const r = report();
  console.log(`/resources coverage — ${r.rows} learnings, ${r.covered} with an article, ` +
              `${r.excluded} excluded with a reason, across ${r.articles} articles.`);
  console.log(`topics: ${r.orphanTopics.join(', ')}`);
  if (!r.problems.length) {
    console.log('\nEvery publishable learning has an article. Nothing to do.');
  } else {
    console.log(`\n${r.problems.length} problem(s):`);
    for (const p of r.problems) console.log(`  - ${p}`);
    process.exitCode = 1;
  }
}
