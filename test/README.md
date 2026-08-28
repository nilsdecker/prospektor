# Tests for the website lane

Three commands, in the order a thread uses them. `npm test` runs
`test/run.js`, not `node --test` — read *Why `npm test` is a script* below
before changing that.

| Command | What it asks | Needs |
|---|---|---|
| `npm test` | Do the functions behave, and does the site build what it claims? 192 tests over the guards, the fail-open policy, the webhook, `/resources/` (including the learnings ledger), `/help/` (the hub, and the per-guide pages #166 split it into) and the content-hashed assets #169 introduced. | Nothing — no network, no keys (`HELP_CORPUS_OFFLINE=1` is set for you, so the help corpus comes from the committed snapshot) |
| `npm run drive` | Does the built site wire up in a real browser? 290 checks over the pay form, the ownership block, the website ask and both fallbacks, the help hub and its search, a guide on its own URL and the anchors that forward to it, the /resources topic filter, and what a crawler is served — with the functions and the studio mocked. | Chromium (`CHROME_PATH` to override) |
| `npm run audit` | Is **production** still what the board says it is? Every claim on this lane's board rows, fetched from the live site — the count grows with the board, so it is deliberately not promised here (#135's lesson about the runbook's fixed URL count). Read-only — it runs a real scan and reads pages, and never posts anything that charges. | Chromium, network (`AUDIT_SITE` to point elsewhere) |

## What the function tests are actually protecting

Most of them assert a **refusal**, because this lane's failures have been
things that happened rather than things that did not:

- No Stripe session is minted for an address that already owns a studio, and
  the test proves it by asserting nothing was sent to `api.stripe.com` — not
  merely that a 409 came back.
- No session is minted that the webhook could not provision from, since
  `/api/provision` 400s without a company or a website and Stripe would then
  redeliver for days against a buyer who has paid and has nothing.
- The ownership check **fails open** on every non-answer, and says so with
  `checked:false` rather than reporting a confident "free".
- The webhook never provisions an unpaid session, treats `existing:true` as
  success, and sends no "your studio is ready" when no studio was created.
- A target sentence the studio did not record is shouted about; a purchase
  that sent no sentence is not, because that is the pricing tile's direct path
  working as designed.

## The /resources coverage check (#159)

`test/learnings.test.js` is the odd one out: it asserts a **contract between two
files**, not a behaviour. `/resources` is defined as one article per useful
learning, `data/learnings.json` is the list, and the test makes the two agree in
both directions — see *The resources contract* in `CLAUDE.md`.

Its failure modes are proven against fixtures rather than by planting a broken
article in `src/resources/`, so a red test here always means the real corpus is
wrong and never means the suite is testing itself. One of those fixtures asserts
that **writing more articles never turns it red**, which is the property the help
corpus learned the hard way in #131.

## The asset check (#169)

`test/assets.test.js` is the other contract test, and the contract is between
the build and `netlify.toml`: css, js and fonts are served under a filename
carrying a hash of their bytes, and those three trees — and only those — are
served `max-age=31536000, immutable`. It fails in both directions, because both
are bugs: a hashed tree with no long cache buys a repeat visitor nothing, and a
long immutable cache on an unhashed name serves a stale file for a year. It also
recomputes the hash in every served filename from that file's own contents, so a
manifest that has gone stale cannot pass.

It also guards `npm run audit` and `tools/seo-audit.js` against the mistake made
while shipping #169 itself: the audit asserted `/assets/js/buy.js` appears in the
served `/pricing/` HTML, and after the deploy that URL does not exist — so the
claim failed on a page that was perfectly fine, which is the worst kind of
failure because it teaches you to distrust the audit. Any file that reads
`AUDIT_SITE` and fetches may no longer spell an unhashed css, js or font URL; a
hash-tolerant pattern is what those should use.

See *The asset contract* in `CLAUDE.md`. Like the learnings ledger, nothing in
it counts anything — adding an asset only turns it red by being unhashed or
unreferenced.

## Notes

- Functions read `process.env` inside their handler, so tests set env per case
  without busting the require cache. `stubFetch` returns the calls that were
  made, which is what makes "it refused *before* Stripe" testable.
- `npm run audit` retries a request whose connection drops. It does **not** retry
  a response that arrives *truncated*, and that happens too: on 24 Aug the
  consent claims failed for `/checkout/done/` and `/resources/` on one run and
  held on the next, with `curl` showing `consent.js` present on both pages
  throughout. **Re-run before believing a consent or per-page-content claim** —
  and a claim that fails twice is real.
- `npm run audit` retries a request whose connection drops. This session's
  egress loses roughly one request in six — always a dead connection, never a
  5xx from the app — and a single blip once reported two claims as broken. A
  check that cries wolf stops being read.

## Why `npm test` is a script, and not `node --test` (#324)

For some weeks `npm test` printed `# fail 0` while **ten tests had not run at
all** — the whole of `consent.test.js`, which is what stands between an EU
visitor and an analytics tag. Two independent faults, and the second is the
one that made the first survive.

**Why they did not run.** Seven test files each shelled out to a full Eleventy
build inside their own `before()` hook, and Node runs test *files* in parallel
— so a `npm test` was seven concurrent builds. When one of them died,
`stdio: 'ignore'` threw the reason away. The suite now builds **once**, in
`test/run.js`, before any test process starts, and hands the directory down in
`PPS_TEST_SITE`; `siteBuild()` in `helpers.js` is what every file calls, and a
file run on its own still builds its own copy:

    node --test test/consent.test.js       # builds its own site, no runner

`help.test.js` is the deliberate exception — its subject *is* the build under a
corpus that is offline, slow, lying or dead, so each variant still gets its own
run. Nothing anywhere calls `npx` any more; the binary is invoked directly, and
a failed build now throws with Eleventy's own words instead of silence.

**Why nothing went red.** This is the part worth remembering, because it is a
property of Node and not of this repo. A failed `before()` hook is summarised
as `# fail 0` with `# cancelled N` — cancelled tests are *not* counted as
failures, and `# fail 0` is the line a reader checks. A failed `after()` hook
is worse: it is summarised as a clean pass and exits 0, appearing in no counter
at all. So the counters are read rather than trusted. `verdict()` in
`test/run.js` is the whole rule — a run is a pass only when nothing failed,
**nothing was cancelled**, no hook failed, at least one test passed, and the
runner exited 0 — and every clause of it is pinned by `run.test.js` against
recorded TAP, including the exact deceptive shape #324 reported. A cancelled
test now prints its own name under a `SUITE FAILED` banner and exits 1.

Same class as the studio's #286: a green run that is not green. The rule both
rows land on is that the suite must say what it proved, not merely what it did
not catch.
