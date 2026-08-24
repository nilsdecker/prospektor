# Tests for the website lane

Three commands, in the order a thread uses them.

| Command | What it asks | Needs |
|---|---|---|
| `npm test` | Do the functions behave, and does the site build what it claims? 137 tests over the guards, the fail-open policy, the webhook, `/resources/` (including the learnings ledger) and `/help/`. | Nothing — no network, no keys (`HELP_CORPUS_OFFLINE=1` is set for you, so the help corpus comes from the committed snapshot) |
| `npm run drive` | Does the built site wire up in a real browser? 208 checks over the pay form, the ownership block, the website ask and both fallbacks, the help hub and its search, the /resources topic filter, and what a crawler is served — with the functions and the studio mocked. | Chromium (`CHROME_PATH` to override) |
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
