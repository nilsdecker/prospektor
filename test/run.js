#!/usr/bin/env node
'use strict';

// `npm test` — one build, then the suite, then a verdict that cannot be quiet.
//
// #324: `npm test` printed `# fail 0` while ten tests — the whole cookie
// consent gate, the thing standing between an EU visitor and an analytics
// tag — had not run at all. Two separate faults, and both are fixed here.
//
// WHY THE TESTS DID NOT RUN. Seven test files each shelled out to a full
// Eleventy build inside their own `before()` hook, and Node runs test FILES in
// parallel — so a `npm test` was seven concurrent builds. When one of them
// died, `stdio: 'ignore'` discarded the reason. The build is now done ONCE,
// here, before any test process starts, and handed down in PPS_TEST_SITE
// (`siteBuild` in `helpers.js`); when it fails, it fails here, loudly, with
// Eleventy's own words.
//
// WHY NOTHING WENT RED. Node summarises a failed `before()` hook as
// `# fail 0` with `# cancelled N` — the cancelled subtests are not counted as
// failures, and `# fail 0` is the line a reader checks. Worse, an `after()`
// hook that throws is summarised as a clean pass and exits 0 with no trace in
// the counters at all. So the exit code and the fail count are both read here
// rather than trusted: `verdict()` below is the whole rule, it is pinned by
// `run.test.js`, and a cancelled test can never again reach a green line.
//
// Run one file the ordinary way and nothing changes:
//   node --test test/consent.test.js      (it builds its own site)

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// ── the verdict ───────────────────────────────────────────────────────────
//
// Everything the runner is allowed to call a pass, in one pure function, so
// the rule is testable without running a suite to produce each shape.
// `tap` is the TAP 13 stream; `code` is what `node --test` exited with.
function verdict(tap, code) {
  const count = name => {
    const m = tap.match(new RegExp(`^# ${name} (\\d+)$`, 'm'));
    return m ? Number(m[1]) : null;
  };

  // Which tests were cancelled, by name: a count alone sends a reader hunting.
  const cancelled = [];
  let last = null;
  for (const line of tap.split('\n')) {
    const notOk = line.match(/^\s*not ok \d+ - (.+?)\s*$/);
    if (notOk) { last = notOk[1]; continue; }
    if (/failureType: 'cancelledByParent'/.test(line) && last) { cancelled.push(last); last = null; }
  }

  const reasons = [];
  const n = { tests: count('tests'), pass: count('pass'), fail: count('fail'), cancelled: count('cancelled') };

  if (n.pass === null)
    reasons.push('the runner produced no summary at all — it died before finishing');
  else if (n.pass === 0)
    reasons.push('no test passed — nothing was proven');

  if (n.fail) reasons.push(`${n.fail} test${n.fail === 1 ? '' : 's'} failed`);

  // The #324 rule. A cancelled test is a test that did not run, and a suite
  // that did not run its tests is not a suite that passed.
  if (n.cancelled)
    reasons.push(`${n.cancelled} test${n.cancelled === 1 ? ' was' : 's were'} CANCELLED — `
      + 'they never ran, so nothing they guard is proven'
      + (cancelled.length ? ':\n    - ' + cancelled.join('\n    - ') : ''));

  // A hook that throws is the usual reason for the line above — and an
  // `after()` hook that throws is invisible in every counter, so it is read
  // out of the stream directly rather than inferred from them.
  if (/failureType: 'hookFailed'/.test(tap) && !n.cancelled)
    reasons.push('a before/after hook failed — see `hookFailed` above');

  if (code !== 0 && !reasons.length) reasons.push(`the test runner exited ${code}`);

  return { ok: reasons.length === 0, reasons, counts: n, cancelled };
}

// ── the run ───────────────────────────────────────────────────────────────

function main() {
  const { siteBuild } = require('./helpers.js');

  // The one build. Offline: the suite must never depend on the studio's help
  // endpoint being up, and `help.test.js` asks for a live corpus explicitly
  // when a live corpus is what it is testing.
  process.env.HELP_CORPUS_OFFLINE = '1';
  delete process.env.PPS_TEST_SITE;
  let built;
  try {
    built = siteBuild('pps-suite');
  } catch (err) {
    console.error('\n' + '='.repeat(72));
    console.error('  SUITE FAILED — the site did not build, so no test that reads');
    console.error('  built HTML could run.\n');
    console.error('  ' + err.message.split('\n').join('\n  '));
    console.error('='.repeat(72) + '\n');
    process.exit(1);
  }
  process.env.PPS_TEST_SITE = built.dir;

  const tapFile = path.join(os.tmpdir(), `pps-suite-${process.pid}.tap`);
  const files = fs.readdirSync(path.join(ROOT, 'test'))
    .filter(f => f.endsWith('.test.js')).sort()
    .map(f => path.join('test', f));

  const res = spawnSync(process.execPath, [
    '--test',
    '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=tap', '--test-reporter-destination=' + tapFile,
    ...files,
  ], { cwd: ROOT, stdio: 'inherit' });

  const tap = fs.existsSync(tapFile) ? fs.readFileSync(tapFile, 'utf8') : '';
  const v = verdict(tap, res.status === null ? 1 : res.status);

  if (v.ok) {
    console.log(`\n  SUITE OK — ${v.counts.pass} passed, 0 failed, 0 cancelled.\n`);
  } else {
    console.error('\n' + '='.repeat(72));
    console.error('  SUITE FAILED — this run proves nothing. Reasons:\n');
    for (const r of v.reasons) console.error('  * ' + r);
    console.error(`\n  counts: ${JSON.stringify(v.counts)}`);
    console.error('='.repeat(72) + '\n');
  }

  fs.rmSync(tapFile, { force: true });
  built.cleanup();
  process.exit(v.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = { verdict };
