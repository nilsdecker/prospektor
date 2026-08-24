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
3. **Before pushing: `npm test`** (148 tests, no network, no keys).
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
   sitemap entry. A stale snapshot is therefore a stale set of URLs — the site
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
