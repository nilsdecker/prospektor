// No personal address in this public repository (24 Aug 2026).
//
// This repo is public, and `OPERATOR_EMAIL` on Netlify is set to the operator's
// personal address. Netlify's secrets scanning greps the repo — not only the
// build output — for the values of environment variables, so any file naming
// that address both publishes it and hard-fails every deploy. It did exactly
// that four times running on 24 Aug: a runbook named the address in a
// parenthetical aside, and production sat two days stale on the 22 Aug build
// while two boards read as pushed.
//
// The lesson is not "remember not to do that", it is this test. What it guards
// is prose — docs, runbooks, comments, copy, config — where a real address has
// no reason to appear. `test/` is deliberately out of scope: fixtures are where
// synthetic addresses belong (buyer@gmail.com is a free-mail test case, not a
// leak), and flagging them would make this test noise and get it deleted.
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Domains that may legitimately appear outside fixtures: our own, and the
// placeholders the copy uses to show a reader what their own address looks like.
const ALLOWED = new Set([
  'prospektor.ai',                                    // ours
  'yourcompany.com', 'acme.com', 'example.com', 'example.org',  // placeholders in copy and doc comments
  // GitHub's reserved noreply domain. `.github/workflows/gsc.yml` has to give
  // git a committer identity to commit the Search Console snapshot at all, and
  // this is the domain GitHub reserves for exactly that: it routes nowhere, it
  // is not a mailbox, and it is our own bot rather than a person. (#446)
  'users.noreply.github.com',
]);

const EMAIL = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

// Binaries carry nothing authored; lockfile integrity hashes look like anything.
const SKIP = /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|pdf|zip)$|(^|\/)package-lock\.json$|^test\//i;

test('no real address is committed outside test fixtures', () => {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(f => f && !SKIP.test(f));

  const found = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of text.matchAll(EMAIL)) {
      const domain = m[1].toLowerCase().replace(/\.$/, '');
      if (ALLOWED.has(domain)) continue;
      // Report the location and domain, never the address — this message goes
      // into CI output, which is itself a place a leak would be published.
      found.push(`${file}:${text.slice(0, m.index).split('\n').length} (@${domain})`);
    }
  }

  assert.deepEqual(found, [],
    'address on a domain that is not ours, in a tracked non-test file:\n  ' +
    found.join('\n  ') +
    '\nIf it is genuinely ours, add the domain to ALLOWED. If it is personal, remove it — ' +
    'this repo is public and Netlify will fail the deploy.');
});
