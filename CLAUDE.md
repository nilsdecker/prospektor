# Working in this repo

This is the **WEBSITE lane** of Prospektor: prospektor.ai, an Eleventy
static site with Netlify functions. The product itself (Prospektor
Studio — renamed from "Partner Studio", 21 Aug 2026) lives in
`prospektor-ai/studio` — the master board is that repo's `BOARD.md`
(its archive is `ROADMAP.md`), and this lane's contract file is
`HANDOVER-website-funnel.md` there. Read all three before starting
anything; the handover documents the studio's live endpoints
(`/api/scan`, `/api/provision`) and everything needed to build against
them without reading the studio's code.

## Thread protocol

1. **Every thread's opening message starts with the lane and deliverable on
   the first line**: `WEBSITE — the scan field`. One deliverable per thread.
2. Start by reading the handover file (and BOARD.md / ROADMAP.md) in
   `prospektor-ai/studio`. **That repo is private** (found 21 Aug 2026),
   so website sessions must be launched with `prospektor-ai/studio`
   attached in scope — until the operator either restores public
   visibility or changes this protocol, a session that cannot read it
   should say so and stop rather than guess at the contract.
3. **Before pushing: `npm test`** (154 tests, no network, no keys).
   If the change touches a page or a client flow, also `npm run drive` —
   it builds and drives the built site in a browser with the functions
   mocked. `npm run build` must of course succeed.
   After deploying, `npm run audit` asks **production** whether this board is
   still telling the truth: one claim per board row, read-only, safe to run any
   time. It is how `app.prospektor.ai` was found still serving the pre-pivot
   agency page that the log had recorded as gone.
   **`npm run help:snapshot`** refreshes `data/help-corpus.json`, the last-good
   copy of the studio's help corpus that `/help/` falls back to when the studio
   cannot be reached at build time (#136). Run it when the studio ships help
   changes; the build prefers the live endpoint and never fails without it.
   **Since #166 the snapshot decides how many PAGES the build writes**, not just
   what one page says: every guide in the corpus gets `/help/<slug>/` and a
   sitemap entry — and since #535 the snapshots decide which LANGUAGES the help
   section exists in: `data/help-corpus.<code>.json` is written only for a
   language the studio holds a guide in, and `/<code>/help/` exists offline
   exactly when that file does. A stale snapshot is therefore a stale set of URLs — the site
   still shows a newly-added guide (the hub renders it inline at runtime, and an
   edited guide corrects itself on its own page), but it has no URL of its own
   until the next build. See *The help contract* below.
   **`npm run learnings`** prints the `/resources` coverage report — see
   *The resources contract* below. **`npm run og`** re-renders the article
   Open Graph cards with Playwright and commits the PNGs; run it after adding
   or retitling an article, or after changing a `topic:`, since the card shows
   it. It is an authoring step, never a build step — the Netlify build must
   not need a browser.
4. A deliverable is not shipped until the handover file in the studio repo
   is updated to record what was built and what was decided — that update
   is a STUDIO-repo commit, named in the sign-off.
5. **A thread is not done until its work is LIVE.** This site deploys from
   `main`. Merged there, pushed, and **asked of the live site** — fetch
   `https://prospektor.ai/…` and confirm the new element, the new href or
   the changed copy is actually being served. A green build is not a deploy
   and the commit log is not verification: on 18 Aug the studio spent three
   days serving a build from three days earlier while every lane's board
   said the work was shipped. If a deploy must wait on an operator decision
   or on keys that are not set, say so in the sign-off as an explicit
   hand-back — that is the only acceptable way to end a thread with work
   not live.
6. **Write the operator's asks down before building them.** An instruction
   given in chat and not recorded in the studio repo's `ROADMAP.md` gets
   dropped, or built to a different spec and marked done: the pricing CTA
   was asked to go straight to Stripe, was built as a link to `/checkout/`,
   and the board recorded a "direct pay path" as shipped for three days.
7. **Cross-lane requests never travel as chat context.** Anything the
   studio side must change or answer is written into the studio repo's
   relevant handover file (dated, under *Requests from other lanes*).
8. **Secrets stay server-side.** `STUDIO_PROVISION_SECRET` lives in this
   site's server env and is used only from webhook/function code — never in
   browser-delivered JavaScript, page source, or client-side config.

## The help contract — one URL per guide, all of it derived (#136, #166)

`/help/` is not written here. The corpus is the **studio's** `docs/help/`, served
at `studio.prospektor.ai/api/help`, and this repo only ever renders it — which is
what makes the two halves of the contract worth stating.

- **Nothing about the help section is hand-listed.** `src/_data/help.js` fetches
  the corpus at build time, `src/help-guide.njk` paginates over it to write one
  page per guide at `/help/<slug>/`, `src/help.njk` is the hub over them, and
  `src/sitemap.njk` derives its `/help/` entries from the same array. A guide the
  studio adds gets a page, a card, three inbound links and a sitemap entry with
  nobody editing this repo; a guide it retires loses all four the same way.
- **A studio outage must never break a website deploy.** `src/_data/help.js` has
  no code path that throws: live endpoint → committed snapshot → empty corpus,
  every fallback logged loudly. An empty corpus ships the hub runtime-only and
  writes **no** guide pages, which is correct — a sitemap must not ask for URLs
  the build did not write.
- **#76's property survived the split, and that is the interesting part.** A help
  change is live for a reader the moment the *studio* deploys, with no website
  publish in between. Two mechanisms keep it: the hub renders a guide the build
  never saw *inline* and links it by anchor (`data-pages` on `#helpGuides` is the
  build's list of slugs that do have a page), and each guide page reconciles its
  own markdown against the live corpus by hash. Both are driven in `test/drive.js`
  §7c and neither may be dropped without putting #76 back on the table.
- **Every fetch of the corpus has a deadline, and the runtime ones are short**
  (#185). The chain above answers a studio that is *dead*; it did not answer one
  that *hangs*, because an unbounded fetch never fails and so never falls back.
  `H.fetchCorpus()` in `help-render.js` is the one door — `H.CORPUS_TIMEOUT_MS`
  is 3s in the browser, because the guides are already in the HTML and the
  reader is not waiting on the studio for anything; the build allows 8s and
  `npm run help:snapshot` 20s, since those are waited on by a machine and not by
  a person. A bare `fetch(API)` added back to `help.js` or `help-guide.js` fails
  `test/help.test.js` by name, and `test/drive.js` §8b drives a studio that
  accepts the connection and never answers.
- **A guide's text must live on exactly one URL.** Leaving the stacked copy on
  the hub as well would recreate the duplication #166 removed, silently and
  without failing anything else. `test/help.test.js` asserts it directly.
- **Nothing in the checks counts guides.** Writing a twelfth guide, or a short
  one, must never turn the suite red — the #131 lesson, the same way the
  learnings ledger keeps it.

## The resources contract — one article per useful learning

`/resources/` is not a blog with a content calendar. The operator's definition,
24 Aug 2026: *"we should create one article per useful learning under /resources
or /blog on the website"*. #144 shipped the section with a fixed list of nine
articles; **#159 made the list derived**, because a fixed list drifts in silence
— a learning lands in the research, nobody writes it up, and nothing goes red.

- **`data/learnings.json` is the ledger.** One row per learning, each carrying
  the source `ref` that finds it in
  `prospektor-ai/studio` → `docs/research/growth-playbook.md`, and a verdict:
  `article` (naming the article that covers it) or `not-publishable` (carrying a
  **written reason** — an exclusion is somebody's argument, never a silent
  omission).
- **Each article declares the ids it covers** in its `learnings:` frontmatter.
- **`test/learnings.test.js` binds the two**, in both directions: a row that
  names a missing article fails, an article that does not declare a row that
  points at it fails, an article with no learning at all fails, and an id no row
  carries fails. `npm run learnings` prints the same report on demand.
- **Nothing in the check counts articles or rows.** Writing more never turns the
  suite red — that is the #131 lesson, where a pinned file count made adding a
  help article break an unrelated test, which is friction pointing exactly the
  wrong way.

**The one thing no test can catch, said plainly:** this repo cannot see the
research. A learning added to the playbook and never entered in the ledger is
invisible here. Adding the row is the job of the thread that adds the learning.

Two mechanics the section's size depends on, both in `.eleventy.js`. The
`related` filter is a **ring** — #137 measured what date-ordering cost (inbound
links ran 9,9,9,4,1,1,1,1,1 and five of nine articles were reachable from the
hub and nowhere else), so each article links to the `n` that follow it and every
article ends up with exactly `n` inbound links by construction. Inside the
window it picks, a **same-topic article is listed first**, so the most relevant
link is also the first one a reader sees. The `topics` filter derives the hub's
filter row from the articles themselves. Keep topics few and populated — a topic
with one article is a chip that selects one card and never appears in anybody's
keep-reading block. Ten topics over twenty-three articles is the shape as of
#159.

## The asset contract — the name carries the bytes (#169)

Every asset used to answer `public, max-age=0, must-revalidate`, because a
filename like `main.css` cannot safely be cached: a long cache on it serves a
stale stylesheet after the next deploy. That never cost bandwidth — an `ETag`
made each one a 304 — it cost a repeat visitor **eight conditional round trips
before anything rendered**, on exactly the visitor most likely to buy.

- **The build names css, js and fonts after their contents.** `lib/assets.js`
  is the whole mechanism and carries the reasoning; `.eleventy.js` writes the
  output and exposes one `asset` filter. Assets are no longer passthrough-
  copied.
- **Every reference in a template goes through `{{ '/assets/…' | asset }}`** —
  including the ones served verbatim, which resolve to themselves. A path the
  build does not produce throws at build time instead of 404ing in a browser,
  which is how a missing Open Graph card gets found before it is a blank card
  in somebody's Slack.
- **`fonts.css` is rewritten before it is hashed**, because it names the four
  woff2 files by URL. Hashing it first would publish a stylesheet whose name no
  longer matched its contents — the one failure this exists to prevent.
- **The hashing and the `netlify.toml` headers are ONE change.** `immutable` on
  a tree whose names are not hashed serves stale files for a year; hashing with
  no header buys nothing. `test/assets.test.js` fails in **both** directions,
  and `tools/seo-audit.js` plus `npm run audit` ask production the same.
- **Images are deliberately excluded, and that is not a TODO.** The OG cards
  are referenced by absolute URL from caches this repo does not control, so
  their URLs must not move; `/assets/img/*` gets a day's cache and no
  `immutable`. `test/assets.test.js` pins that too, so a later thread that
  "finishes the job" by hashing them has to argue with a red test first.
- **Nothing counts assets.** Adding a stylesheet, a script or a font can only
  turn the suite red by being unhashed or unreferenced — the #131 rule, that
  friction points at the defect and never at the work.

## The script contract — nothing blocks the parser (#137 F6, #170)

Every `<script src>` this site serves carries `defer` (or `async`, for a tag
Netlify injects). A blocking script stops the parser where it sits, and on
`/help/` — the heaviest page on the site — the two that stayed blocking cost
two serial round trips plus a synchronous index build before the document could
finish parsing.

- **`test/pages.test.js` fails on any built page serving a blocking script**,
  naming the page and the file. It is derived from the build, never from a list
  of filenames: adding a page or a script can only turn it red by adding a
  *blocking* one. Same rule as everywhere else here — friction points at the
  defect, not at the work.
- **`tools/seo-audit.js` flags the same defect against production**, because a
  tag injected into the response is not in this repo's output at all.
- The reason `/help/` was the exception until #170, and why it stopped being
  one, is `SEO-AUDIT.md` **R3**: #136's no-double-render stamp is a comparison
  of two hashes, not a race, so `defer` cannot break it — and the drive proves
  it rather than the reasoning doing so.

## The typeahead contract — one door, and nothing but the characters typed (#241)

The scan field suggests companies as the visitor types — one line each, name
and domain — and a pick fills the field with the domain, because the scan is
domain-keyed underneath. Nothing else on the page moves, and Scan is still the
visitor's press.

- **The source is Clearbit's public suggest endpoint, and only that.** It is
  what the studio has called since before #42 wrote it down, and `/privacy/`
  §08 names it as the recipient (#90). No new third party, no key, no account.
- **The browser never talks to the provider.** `netlify/functions/company-suggest.js`
  is the one door: it forwards the typed characters and nothing else — no
  header, no identifier — and answers `{ name, domain }` pairs. A provider
  entry is **never a URL** (studio #443): Clearbit's `logo` is dropped at the
  boundary, so a browser can never be made to fetch from `logo.clearbit.com`.
  `test/company-suggest.test.js` pins both; `test/drive.js` §15 watches the
  browser's outbound hosts while it types.
- **Every failure is no list.** A dead, slow or odd provider — or the function
  itself unreachable — answers an empty list or nothing, and the field is the
  plain text box it was before. There is no error state to draw.
- **The cost posture per keystroke** is a 200 ms debounce, two characters
  minimum, one request in flight (the previous one is aborted), a ten-minute
  memo in the warm container and a ten-minute browser cache on the answer.
  The provider is free; the meter is Netlify invocations.
- **The list speaks the page's language** through `t()`, the same way every
  other sentence a script says does — its one sentence is in every catalogue.
- **`/privacy/` §08's Clearbit row and §05's typed-in paragraph say the scan
  field sends this.** They said the opposite until #241; the row and the
  sentence were changed in the same push as the field, because the notice may
  never state something false. Studio-side, `DATA-HANDLING.md` §2 and §5 carry
  the same correction.

## The price contract — two plans, one table, and the default sends nothing (#542)

A workspace is $999 a month or **$9,990 a year** — ten months' money for twelve
months, which is the operator's *"two months free thing for prepayment for the
year"* (7 Sep 2026) — and `/terms/` §02 says the yearly price is fixed for that
year. Four surfaces carry a figure and exactly one of them decides it.

- **`PLANS` in `netlify/functions/create-checkout-session.js` is the only place
  either figure is written.** Both are inline `price_data`, so a plan is a row
  in that table and never a product somebody has to remember to create in the
  Stripe dashboard — which is what keeps the number on `/pricing/` and the
  number that leaves a card the same number by construction.
  `test/seo.test.js` reads the exported table and asserts **both ways**: a plan
  with no `Offer` on `/pricing/`, and an `Offer` no plan backs, each fail.
  `test/llms.test.js` reads every figure `/llms.txt` quotes against the same
  page. Adding a third plan is a row and a second `Offer`; forgetting either
  half is red.
- **A plan the table does not hold is monthly, and monthly writes nothing.**
  `planOf` whitelists against the table itself (`hasOwnProperty`, so
  `constructor` is not a plan), and the default adds no metadata, exactly as
  English adds no `locale` — so a monthly purchase is the Stripe request this
  function always sent, byte for byte, and nothing a browser can be made to
  send charges a price this repo does not carry.
- **One primary action per screen, so the switch is a segmented control and
  never a second buy button** (the style skill, rule 8). Both figures and both
  sentences are written into the page by the build, in the reader's language;
  `plan.js` only decides which of them is hidden. A switch therefore cannot say
  a price the build did not write, ships no sentence of its own to translate,
  and degrades — no JS, no keys, a crawler — to the monthly page it has always
  been. `plan.js` loads **after** the page's own script, because deferred
  scripts run in document order and `buy.js` has to be listening for the `plan`
  event before a `?plan=` in the URL is announced.
- **The choice crosses pages as `?plan=`, never as storage.** That is the path
  a yearly buyer takes when there are no Stripe keys and `/pricing/`'s CTA is a
  link rather than a form — and it declares nothing to `consent.js`'s
  inventory, because nothing is kept on the visitor's device.
- **`/checkout/done/` shows what was bought, not what is usual.** It printed
  `$999/mo` as a constant until #542; `checkout-session-status` now answers
  `plan`, which is **the only** thing that crosses from a session's metadata —
  the domain, the company and the buyer's target sentence stay server-side, and
  `test/checkout-session-status.test.js` pins that they do.
- **The billing gate is interval-agnostic, and that was verified rather than
  assumed.** `stripe-webhook.js` keys on the event type and the address and
  reads nothing about money; the studio's #68 cascade gates on suspension
  reasons. A yearly renewal is the same five events twelve months apart.
  `test/stripe-webhook.test.js` drives a yearly invoice through both halves, so
  a future line that starts reading an interval, an amount or a price id turns
  red.
- **Switching an existing workspace between plans is a mailto, and the copy
  says so** — `/pricing/`'s FAQ and `/terms/` §02 both name `hello@`. It stops
  being a sentence and starts being a button when billing is self-serve, and
  not before.
- **Nothing counts plans.** A third one can only turn the suite red by having
  no `Offer`, no `billingPeriod`, or a figure `/llms.txt` contradicts — the
  #131 rule, that friction points at the defect and never at the work.

## The language contract — the English sentence is the key (#114, #535)

Every page a visitor reads — the funnel (`/`, `/pricing/`, `/checkout/`,
`/checkout/done/`), the two product pages, `/contact/` and its thanks page, the
cookie notice on all of them and, where the studio holds the corpus in the
language, `/help/` — is served in Spanish, German and Dutch under `/es/`,
`/de/`, `/nl/`; `/` stays English for a visitor who never chose. The convention
is #113's, carried over from the studio where it transfers, and the reasons are
the same.

- **One catalogue file per language, and the English sentence is the key.**
  `src/_data/strings/<code>.json` is `{ "English sentence": "translation" }`.
  There is no English catalogue to be incomplete and no key that can render
  raw: a sentence a catalogue lacks renders in English and is logged once at
  build time, never thrown. **Untranslated is reported, never red** — a feature
  ships its English in the code that uses it and `npm run i18n:coverage` lists
  what a sweep should catch up on (#113, #131). Red is reserved for what rots
  silently: a catalogue entry for a sentence the site no longer says, a
  translation that drops a `{placeholder}`, a `{% t %}` block the extractor
  cannot read (`test/i18n.test.js`).
- **English is a no-op, byte for byte.** `lib/i18n.js` returns the key
  untouched for `en` before it looks anything up, so the English pages are the
  pages the build wrote before #114 — checked by diffing a pre-#114 build
  against a post-#114 one on the day it shipped: additions only (hreflang, the
  switcher, the payload), not one moved byte. Keep it that way: wrap a
  sentence, never rewrite it to make it wrappable.
- **A language exists exactly when its catalogue does.** `lib/i18n.js`'s
  `built()` is the list. The funnel templates paginate over it
  (`pagination: data: languages`) to write one page per language; the layout
  derives `<html lang>`, `hreflang` (every sibling, itself and `x-default`
  included — SEO-AUDIT.md R5), `og:locale`, the footer switcher and the nav's
  hrefs from the built page list; `sitemap.njk` derives the twins the same
  way. Nothing lists `/es/` anywhere. Delete `es.json` and every one of those
  leaves the same way.
- **How copy is written.** `{% t %}…{% endt %}` around a sentence in a
  template, markup inside allowed — **a link inside a sentence stays written
  English-side** (`href="/pricing/"`) and the shortcode localizes it on the way
  out, translation or not; written as `{{ '/pricing/' | localize }}` inside the
  block it would render differently on every page and never match its key, and
  the extractor refuses it by name (#535). `{{ value | t }}` for a value that
  arrives in a variable (a frontmatter title, a site.json label, a `faqs:`
  entry — the inventory reads frontmatter through gray-matter, the parser
  Eleventy uses, so a YAML list is a list); `{{ value | t({ n: 3 }) }}` fills a
  placeholder. A miss is logged only for a sentence the inventory knows: a
  value the studio already serves in the page's language (a help guide's
  title) is looked up like any other and falls back without a word. `t('…')`
  in a script
  under `src/assets/js/` (the page ships exactly the sentences its scripts ask
  for, inline, only where a twin exists — `i18n.js` defines `window.t` first
  on every page) and in a Netlify function (`netlify/lib/strings.js` carries
  the catalogues as literal requires, because a bundler ships what it can see).
  Internal hrefs go through `{{ '/pricing/' | localize }}`, which answers the
  twin where the build wrote one and the English page where it did not — so a
  link on a localized page can never point at a URL the build did not produce.
- **The browser's language nudges. It never redirects** (#114 → #544). On an
  English page, when the browser's first-ranked language (`navigator.languages[0]`
  — never the IP or a geo lookup: a German VPN is not a German reader) is one
  the page is built in, `src/assets/js/i18n.js` draws one line under the nav in
  that language — *Diese Seite gibt es auf Deutsch →* — which is itself the
  link to the twin, plus an × named *Not now* for a screen reader. Nothing to
  read, nothing to decide. **It is shown once per browser**: `prospektor.lang`
  (declared in `consent.js`'s inventory) is written the moment the line is
  drawn, so ignoring it counts the same as closing it, and taking it overwrites
  the flag with the language chosen. A translated page is never nudged — it was
  chosen — and the build sends it no `suggest` payload at all. Only the first-
  ranked language counts, for #113's reason. `test/i18n.test.js` fails on a
  `location.assign` in that file, on any sign of a geo lookup, or on an
  `Accept-Language` redirect in `netlify.toml`; `test/drive.js` §14 drives a
  Spanish browser onto `/` and proves all four: offered, not moved; ignored,
  not asked again; closed; taken. Nothing to add to `/privacy/` — a preference
  flag on the visitor's own device, the same class as the cookie notice's own
  remembered choice.
- **The scan says the language on BOTH requests, and English says nothing on
  either (#114 → #536).** `scan.js` reads it from `<html lang>` once, and one
  `langQuery()` decides what the GET adds: the POST carries `language` in its
  body, the poll carries `&language=` on the URL, and for `en` both are the
  request they were before #114. The poll is not decoration — since the
  studio's #534 a Spanish reading is **its own record beside** the English one,
  keyed `(domain, language)`, so a poll naming no language reads the English
  record and a Spanish visitor whose domain somebody already scanned in English
  was shown that English card while their own reading finished unseen. The
  studio bridges the case where only one reading exists, so a poll can never
  come back empty; naming the language is what makes it come back *right*. The
  reply's `language` says which reading answered — `"es"`, absent for English —
  and that is what `npm run audit` asserts against the live studio.
  `test/drive.js` §16 drives both halves.
- **Checkout speaks the buyer's language and English sends nothing.** The
  pages post `locale` only when it is not `en`; `create-checkout-session`
  whitelists it against the closed set and, for a hit, sets Stripe's own
  `locale` (a translated hosted page for one parameter), returns the buyer to
  the translated pages, and writes `metadata[language]`; the webhook welcomes
  them in it, tells the operator, and offers it to `/api/provision`. An
  English purchase is byte for byte the Stripe request and the email it always
  was — `test/checkout-session.test.js` and `test/stripe-webhook.test.js` pin
  both halves.
- **`/help/` is an EDITION per language, and the studio decides which exist
  (#535).** Since #113 Slice D `/api/help?lang=es` answers the same files with
  `language: "es"` where a translation exists and `"en"` where it does not —
  per document, so a page never goes missing. `src/_data/help.js` asks for
  one edition per built language and writes `/<code>/help/` and its guide
  pages **only when the studio holds at least one guide in that language**;
  the offline build reads the same answer from `data/help-corpus.<code>.json`,
  which `npm run help:snapshot` writes for exactly those languages and removes
  for the rest. German and Dutch answer today with every file in English, so
  they get no edition, no URLs, and their nav item falls back to `/help/` — a
  hub of English text under `/de/` would be duplicate content wearing a flag.
  Nothing lists `es` anywhere: the day the studio ships one German guide,
  `/de/help/` exists at the next build. A guide the edition holds in English
  is still written (a reader following the hub must never 404), says so above
  the text and on its card, carries `lang="en"` on the body, is `noindex` and
  is left out of the sitemap — its English twin is the page to rank. The
  scripts ask for the corpus in the page's language (`data-lang` on
  `#helpGuides`; `<html lang>` on a guide page) and the English fetch is byte
  for byte what it was; the not-yet-translated note is shown or hidden at
  runtime from the live answer, so #76's property holds in every language. A
  guide's title and body are the studio's, in the language it served them —
  no catalogue is asked for them, and a title past the ~60-character budget
  gives search its head before the studio's own dash (`seoTitle`), never a
  clipped one. `test/help.test.js` holds all of it; `test/drive.js` §7f
  drives the runtime half; `npm run audit` asks production.
- **What stays English, and why.** `/terms/`, `/privacy/` and `/dpa/` are
  COMPLIANCE's and not a translation job — pinned by
  `test/privacy-claims.test.js` in the studio repo, and two of them carry
  wording still unmerged on the operator's desk (#529, #531); `/resources/` is
  written, not translated (its nav item falls back to the English page, by
  the rule above); the scan card's guess and the free run answer in the
  language the studio chooses (#113, #534). The cookie notice is the studio's
  copy (#131 → #143) and stays a copy: its sentences pass through a local
  `t()` that defers to `window.t` where i18n.js has defined it and says the
  English anywhere else, so the file still drops into a site that has never
  heard of a catalogue.
- **Nothing counts sentences, pages, languages or editions.** Adding a language
  is one JSON file plus its literal require; adding a page to the funnel is a
  `pagination:` block and its sentences wrapped; a help edition arrives from
  the studio with nobody editing this repo. Any of them can only turn the suite
  red by being stale, unreadable, dead-linked or past a search budget — the
  #131 rule.

## The sign-off

When the deliverable is shipped, end the thread with exactly this shape and
nothing after it:

> ✅ **Shipped:** one line on what now works that didn't.
> 🚀 **Live:** the commit on `main`, and the fetch of the live page that
> proves it is being served — the actual response, not "should be". If it
> is deliberately not live, say what it waits on and who owes it.
> 📝 **Updated:** the docs updated, and any handover entries written for
> other lanes.
> ⏭ **Still open:** what this deliberately left undone, or "nothing".
> 🗄 **Archive this thread.** Opening message for the next thread in this
> lane:
>
> ```
> WEBSITE — <next deliverable>
> Read HANDOVER-website-funnel.md in prospektor-ai/studio, and CLAUDE.md
> here, first. <Two or three sentences: what was just shipped, what this
> deliverable is, and where to start looking.>
> ```

The opening message must stand alone — the next thread has no memory of
this one. If the lane's queue is empty, say so and propose the next item
from the studio repo's ROADMAP.md instead of inventing one.
