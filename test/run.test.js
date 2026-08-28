// The suite's own verdict (#324).
//
// `npm test` used to print `# fail 0` over ten tests that had never run. The
// counters Node hands out are not enough on their own to tell a green run from
// a silent one — a failed `before()` hook is `fail 0 / cancelled N`, and a
// failed `after()` hook is a clean pass that exits 0 — so `test/run.js` reads
// the TAP stream and decides for itself. That decision is the one thing in
// this repo whose being wrong makes every other test meaningless, so it is
// pinned here rather than trusted.
//
// The fixtures are real TAP, captured from Node's own runner: the first is the
// exact output shape #324 reported.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { verdict } = require('./run.js');

const summary = ({ tests = 0, pass = 0, fail = 0, cancelled = 0 }) =>
  `1..1\n# tests ${tests}\n# suites 1\n# pass ${pass}\n# fail ${fail}\n`
  + `# cancelled ${cancelled}\n# skipped 0\n# todo 0\n# duration_ms 1\n`;

const CANCELLED_BY_HOOK = `TAP version 13
# Subtest: consent gate
    # Subtest: every built page loads the gate, and offers withdrawal
    not ok 1 - every built page loads the gate, and offers withdrawal
      ---
      failureType: 'cancelledByParent'
      error: 'test did not finish before its parent and was cancelled'
      ...
    # Subtest: the gate is in the head
    not ok 2 - the gate is in the head
      ---
      failureType: 'cancelledByParent'
      error: 'test did not finish before its parent and was cancelled'
      ...
not ok 1 - consent gate
  ---
  failureType: 'hookFailed'
  error: 'eleventy build failed'
  ...
` + summary({ tests: 2, pass: 0, fail: 0, cancelled: 2 });

describe('the suite cannot report a pass it did not earn', () => {
  test('a cancelled test fails the run, whatever the counters say', () => {
    // The #324 shape exactly: `fail 0`, and ten tests that never ran. This is
    // the assertion the whole row exists for.
    const v = verdict(CANCELLED_BY_HOOK, 0);
    assert.strictEqual(v.ok, false, 'a run with cancelled tests must never be OK');
    assert.strictEqual(v.counts.fail, 0, 'the fixture is the deceptive shape: fail 0');
    assert.match(v.reasons.join('\n'), /CANCELLED/);
  });

  test('it names the tests that were cancelled, not just how many', () => {
    // A count sends a reader hunting through a thousand lines of TAP.
    const v = verdict(CANCELLED_BY_HOOK, 0);
    assert.deepStrictEqual(v.cancelled, [
      'every built page loads the gate, and offers withdrawal',
      'the gate is in the head',
    ]);
    assert.match(v.reasons.join('\n'), /every built page loads the gate/);
  });

  test('a hook failure fails the run even when nothing is cancelled', () => {
    // An `after()` hook that throws is Node's other silent hole: the tests
    // pass, the counters are clean, and the process exits 0.
    const tap = `TAP version 13\nok 1 - one\nnot ok 1 - suite\n  ---\n  failureType: 'hookFailed'\n  ...\n`
      + summary({ tests: 1, pass: 1 });
    const v = verdict(tap, 0);
    assert.strictEqual(v.ok, false);
    assert.match(v.reasons.join('\n'), /hook failed/);
  });

  test('a run that proved nothing is not a pass', () => {
    assert.strictEqual(verdict(summary({}), 0).ok, false, 'zero passing tests is not green');
    assert.strictEqual(verdict('', 0).ok, false, 'no summary at all is not green');
    assert.match(verdict('', 0).reasons.join(), /no summary/);
  });

  test('a non-zero exit is a failure even when the summary looks clean', () => {
    const v = verdict(summary({ tests: 1, pass: 1 }), 1);
    assert.strictEqual(v.ok, false);
    assert.match(v.reasons.join('\n'), /exited 1/);
  });

  test('a genuinely clean run still passes', () => {
    const v = verdict(`TAP version 13\nok 1 - one\n` + summary({ tests: 1, pass: 1 }), 0);
    assert.deepStrictEqual(v.reasons, []);
    assert.strictEqual(v.ok, true);
    assert.strictEqual(v.counts.pass, 1);
  });

  test('a failing test fails the run', () => {
    const v = verdict(summary({ tests: 2, pass: 1, fail: 1 }), 1);
    assert.strictEqual(v.ok, false);
    assert.match(v.reasons.join('\n'), /1 test failed/);
  });
});
