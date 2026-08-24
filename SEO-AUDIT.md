# SEO audit — prospektor.ai

**Board item #137** (WEBSITE · ops), 24 August 2026. The rows it filed are **#168**, **#169** and **#170**; the per-guide-help-URL row it refers to is **#166** (renumbered from #158 by a parallel thread while this ran). Queued deliberately behind
**#135** (Search Console) and **#136** (`/help/` prerendered), because an audit
run before those two would have measured a site that was about to change.

The deliverable the spec asked for is *"a ranked fix list with each fix costed,
not a score"*. So there is no score here. §2 is what was found and fixed in this
thread; §3 is the ranked list of what is left, each item costed and owned.

Re-run the whole measurement any time:

```
node tools/seo-audit.js                    # asks production
AUDIT_SITE=http://localhost:8901 node tools/seo-audit.js   # asks a local build
node tools/seo-audit.js --json             # the same data, to diff two runs
```

`test/seo.test.js` pins every finding below as a test, so none of them can come
back quietly. That is the difference between an audit and a document: the audit
is 13 assertions in `npm test`, and this file is why they are there.

---

## 1 · What could be measured, and what could not

Being explicit about this first, because two of the things #137's scope asks for
**do not exist yet**, and an audit that quietly substituted a guess for them
would be worse than one that says so.

| Asked for | Status |
|---|---|
| Titles, descriptions, headings, canonicals, structured data, internal linking, mobile meta, crawlability | ✅ **measured**, against production, 24 Aug 2026 — §2 |
| **Core Web Vitals from field data** | ❌ **does not exist.** See below |
| **Search Console crawl + query data** | ❌ **not yet.** The operator still owes steps 6 and 7 of `RUNBOOK-search-console.md` — five minutes — and then 2–3 weeks of collection |

**Why there is no field CWV data, and why that is not a failure.** Field data
means the Chrome UX Report: real Chrome users, aggregated over 28 days, with a
minimum traffic threshold before Google will report an origin at all. At
prospektor.ai's current traffic there is nothing to report, and
`RUNBOOK-search-console.md` already predicted exactly this — *"Core Web Vitals —
not enough data — ✅ expected for months at this traffic; it needs real
visitors"*. Both routes to it were tried and both are closed: Search Console's
own report needs the property's owner, and the PageSpeed Insights API without a
key answers `429 Quota exceeded` because the keyless quota is shared with every
anonymous caller on the internet and was already spent.

**So what §3 costs instead are the structural determinants of CWV that we
control** — bytes on the wire, render-blocking resources, cacheability,
whether images reserve their space. Those are measurable today, they are what a
lab tool would flag anyway, and unlike a field score they do not need traffic to
become true. Render-blocking scripts are now closed on both halves — four of
them in this thread (**F6**) and `/help/`'s remaining two by **#170** on 24 Aug,
which also turned the defect into a check instead of a fact in a table.
Cacheability (**R2**) closed on 24 Aug as **#169** — css, js and fonts are
served under content-hashed filenames and cached `immutable` for a year, and
`tools/seo-audit.js` now asks production the same question rather than leaving
it to a reader of this document.
There is no image-driven layout shift to fix and there cannot be: the site
serves **zero `<img>` elements** — every graphic on it is inline SVG or CSS, and
the only raster assets are the OG cards, which are never rendered by the page
that names them.

**A note on what "lab data" would have been worth here.** Chromium is installed
in this environment but has no outbound network — the existing `npm run audit`
relays browser traffic through Node's `fetch` for exactly that reason. Timings
measured through a relay are not timings. Reporting them as Core Web Vitals
would have been inventing a number, so this audit does not.

---

## 2 · What was found, and fixed

`node tools/seo-audit.js` against production, before: **34 findings — 0 blockers,
16 major, 18 minor**, across 20 pages (17 in the sitemap, plus `/checkout/`,
`/checkout/done/` and `/404`). After: **0**.

Every one of these was really being served on the morning of 24 Aug 2026.

### F1 · Nine article titles were too long to survive a search result · **major**

Measured: `<title>` lengths of 74, 76, 77, 84, 89, 93, 102, 106 and **110**
characters against a budget of roughly 60. The cause was structural, not
editorial — the template appended `— Prospektor · Your AI pre-sales team`, a
**37-character** suffix, to every page on the site. On a 71-character headline
that is not branding: it guarantees the brand never appears *and* the headline
is cut instead.

**Fixed** by fitting the suffix to the space left rather than always spending
the same: the full suffix when it fits, `— Prospektor` when it does not, and the
headline alone when even that would push it further past the line. Five articles
whose own headline exceeds the budget now carry a `seoTitle` in frontmatter —
**that changes the search result only, never the `<h1>` a reader sees.** Those
five are also better keyword targets than the headlines they replace:
*"Cold email personalisation that works"* is a phrase someone types;
*"Personalisation that works, and personalisation that costs you trust"* is not.

All 20 pages are now ≤ 60 characters, measured as a result *renders* them —
`"Too expensive" is never why they left` is 37 characters on the page and 49 in
the HTML source, because each quote is `&quot;`. Measuring the source failed
this suite on two pages that were within budget, which is a good argument for
measuring the right thing.

### F2 · One description, cut in half, on three pages · **major**

`site.description` was **294 characters** and was the meta description of `/`,
`/checkout/` **and** `/checkout/done/` simultaneously. Google shows about 160,
so roughly 45% of it never appeared, and the homepage and the checkout page were
duplicates of each other in search.

**Fixed:** every page now has its own, all inside 160 characters. Seventeen
descriptions were rewritten. `site.description` remains as the last-resort
fallback a new page inherits before anyone writes it one — trimmed to 153
characters so that inheritance is no longer a defect, with a `//description`
note in `site.json` saying why it has a budget.

### F3 · Eight indexable pages had no structured data — including the one with the price · **major**

The only types on the entire site were `Article` (the nine `/resources/` posts)
and `FAQPage` (`/help/`). The homepage, `/pricing/`, `/who-to-pitch/`,
`/what-to-send/`, `/resources/`, `/privacy/`, `/terms/` and the checkout pages
emitted nothing, leaving Google to infer from prose who publishes this site,
what the product is, and what it costs.

**Fixed:**

- **`Organization` + `WebSite` on every page**, both carrying an explicit `@id`,
  so `Article` and `Product` blocks point a `publisher`, `author`, `brand` and
  `seller` at the same node instead of each restating it. The page emits one
  graph rather than a pile of unrelated blocks.
- **`Product` + `Offer` on `/pricing/`** — the type Google shows a price for.
  **The numbers are not transcribed from the copy**: `999.00 USD` is read from
  `netlify/functions/create-checkout-session.js` (`unit_amount: '99900'`,
  `currency: 'usd'`), and `test/seo.test.js` asserts the two against each other.
  Changing the price in one place and not the other now fails the suite — which
  matters more here than usual, because one of the two numbers is what a buyer
  reads in a search result and the other is what leaves their card.
- **`BreadcrumbList` on every article**, so a result can show
  *Prospektor › Resources › this article* instead of a bare URL.

Deliberately **not** added: `SoftwareApplication`. It wants an
`applicationCategory` and an operating system, and it invites the app-install
rich result — the wrong shape for a service sold by subscription. `Product` with
a real `Offer` is the eligible one, and it is the one with the price in it.

### F4 · Five of nine articles were reachable from one page · **major**

The measured inbound-link distribution across the nine `/resources/` articles
was **9, 9, 9, 4, 1, 1, 1, 1, 1**. Five articles were reachable from the hub and
from nowhere else, which is the internal link graph telling Google they are the
least important pages on the site. They are not — they are the same nine
articles.

The cause was one line: the `related` filter sorted the collection by **date**
and took the top three. That is not *related*, it is *recent* — so every article
linked to the same three newest ones, and an article's inbound links depended
entirely on how recently it was published.

**Fixed** with a ring instead of a sort: articles are put in a stable order and
each links to the three that follow it, wrapping around. The inbound count is
now **exactly 3 for every article, by construction rather than by luck** — a
tenth article changes nobody else's count. Within the three it picks, a
same-topic article is listed first, so the most relevant link is also the first
one a reader sees; ordering inside the window cannot change *which* articles
were picked, so the evenness survives it.

`test/seo.test.js` asserts the counts are all *equal*, not merely above a floor
— a floor would pass again the moment somebody re-sorted by date and left one
article on top.

### F5 · Two heading-structure defects · **minor**

- The **homepage outline read `h1` → `h3`(empty) → `h2`**. The scan result was
  marked up as `<h3 class="scan-guess">` and is empty until `scan.js` fills it,
  so every crawler read an empty heading between the `<h1>` and the first
  `<h2>`. It is a `<p role="status" aria-live="polite">` now — which is what it
  actually is, a line of result text that happens to be large — and it looks
  identical, because `.scan-guess` was always a class rule and never an element
  one.
- **`/checkout/` had three `<h1>`s.** They are three steps of one flow with only
  one visible at a time, but a crawler sees the whole document at once. Steps 2
  and 3 are `<h2>` now, styled by the same class.

### F6 · Four scripts blocked the parser mid-document · **CWV, structural**

`scan.js` sat at line 62 of the homepage with no `defer`, so the parser stopped
there and rendered nothing below it until the script had been fetched and run.
Same for `buy.js` on two pages, `checkout.js`, and `main.js`.

**Fixed.** Every one of them is an IIFE that looks its elements up by id and
returns if they are absent — which is precisely the case `defer` is for, so this
is not only cheaper to render, it runs them with the DOM guaranteed complete
instead of guaranteed partial.

`/help/`'s two scripts are **deliberately left alone**: #136 tuned that page's
render and stamped a corpus hash specifically to prevent a double render, and
this thread has not verified that deferring them keeps that true. Ranked as
**R3** below rather than done blind. *(#170 verified it and deferred them on
24 Aug — R3 carries the measurement and the reason the stamp was never at
risk.)*

### What was checked and was already right

Worth recording, so the next audit does not re-derive it: canonicals are correct
and self-referential on all 20 pages; `lang="en"`, `charset` and `viewport` are
everywhere; `og:` and `twitter:` cards are complete with real images (the nine
articles have their own); `noindex` is correctly on `/checkout/done/` and `/404`
and correctly absent everywhere else; a missing URL really answers **404** and
`/app/` really **301**s to `/`; `robots.txt` names the sitemap; no page links to
a URL that does not build; no images are missing `alt`; and the sitemap's 17
URLs all answer 200 and agree with their own canonicals.

**`/checkout/`'s index posture — the decision #137 was asked to make.** It stays
out of the sitemap. The runbook's argument holds: a sitemap states what we want
*ranked*, and that page is a form, not an answer to any search. It remains
crawlable and linked from the homepage CTA, so nothing is lost. The actual harm
it was doing was being a *duplicate of the homepage* in search (F2), and that is
now fixed. Revisit with query data, not before.

---

## 3 · The ranked fix list — what is left

Ranked by expected value, which at this traffic means *"how much does this change
what a stranger finds and believes"*, not by how easy it is.

### R1 · The site is written in a vocabulary nobody searches · **#168 · CEO lane · S to implement, blocked on evidence**

**This is the biggest SEO fact about prospektor.ai and it is not a bug.**

#137's scope asks *"whether the homepage says what a buyer would search for."*
Measured, against nineteen phrases a buyer for this product would plausibly
type: **zero appear in the homepage's `<title>` or meta description.** Only
*"cold email"* appears in the homepage's visible copy at all. Not present
anywhere on the site: *lead generation*, *sales prospecting*, *B2B leads*,
*sales intelligence*, *prospect research*, *sales automation*, *AI sales*,
*lead list*, *go to market*.

The homepage title is `Prospektor · Your AI pre-sales team` — 35 of ~60
characters used, and *"AI pre-sales team"* is a category we invented. The `<h1>`
is *"Who to pitch. What to send."*, which is the product thesis and an excellent
line, and is also not a phrase anyone types into Google.

**This is deliberately not fixed here, and the reason matters.** Rewriting the
homepage title and tagline is repositioning, which is a CEO decision and not a
builder's. #130 already argues that **ads, not SEO, are the positioning
laboratory** — and it is right: a paid test buys an answer in days, where
changing the title and waiting buys one in months. The nine `/resources/`
articles are already the hedge, because they rank for the language a buyer uses
while the homepage keeps the language we chose.

**Recommended sequence, and no step of it is "guess":** finish #135's steps 6–7
→ wait 2–3 weeks → read Search Console's *Performance* report for the queries
prospektor.ai **already** earns impressions on → then decide, with evidence,
whether the homepage should meet those words or keep its own. Filed as a board
row rather than acted on.

### ~~R2 · Assets cannot be cached, so every repeat visit revalidates all of them~~ · **#169 · SHIPPED 24 Aug 2026**

Measured on production: `/assets/css/main.css` answers
`cache-control: public, max-age=0, must-revalidate`. So does every other asset.
The filenames carry no content hash, so Netlify cannot safely do better — a
long cache on `main.css` would serve a stale stylesheet after the next deploy.

The cost is not bandwidth (an `ETag` makes each one a 304, and the compressed
payloads are healthy: homepage **6.2 KB**, `main.css` **11.4 KB**, `scan.js`
**3.3 KB** on the wire). The cost is **eight conditional round-trips before a
repeat visitor sees anything**, which is a real LCP tax on exactly the visitor
most likely to buy.

**Fixed as specified, with one deliberate narrowing.** `lib/assets.js` writes
css, js and fonts under a filename carrying a hash of their bytes, every
template reference goes through an `asset` filter that throws on a path the
build does not produce, and `netlify.toml` answers
`public, max-age=31536000, immutable` for those three trees. A repeat visitor's
eight conditional round trips are now **one** — the HTML, which must revalidate
and always did.

**The narrowing: images are not hashed, and are not immutable.** The row said
`/assets/*`, and `/assets/img/*` is the part of that which would have been a
bug. The Open Graph cards are referenced by absolute URL from caches this repo
does not control — Slack, X, LinkedIn, and every link already shared — so moving
their URLs blanks cards that render today, and a year-long immutable cache on an
unhashed name is exactly the staleness the hashing exists to prevent. They get
`max-age=86400` instead, which takes the favicon off the repeat visitor's
request list and still lets a re-rendered card reach the crawlers within a day.
The OG-card tooling therefore did not need to change at all.

**Both halves are checked, in both directions.** `test/assets.test.js` fails if
a hashed tree loses its header, if a header promises `immutable` for a tree the
build does not hash, if a page names an asset the build does not write, or if a
served filename's hash does not match its own bytes. `tools/seo-audit.js` and
`npm run audit` ask production the same. Nothing counts assets — adding a
stylesheet, a script or a font can only turn the suite red by being unhashed or
unreferenced.

### R3 · `/help/`'s two scripts still block, on the heaviest page on the site · **#170 · S**

`/help/` was **127 KB** of HTML (31 KB compressed) — the whole help corpus,
prerendered by #136, which is correct and is why it can rank. Its two scripts
were left un-deferred by F6 because #136 stamps a corpus hash to prevent a
double render and that guarantee was not re-verified here.

**Re-measured after #166 (24 Aug), because this row's numbers moved and a stale
figure would send #170 at the wrong thing.** The rendered guides left the hub
for their own URLs, so `/help/` is **85 KB** of HTML — but only **28 KB
compressed**, barely under the 31 KB above, because what dominates it now is the
embedded corpus JSON (`#helpCorpus`), not the rendered guides. That JSON is not
waste: it is what makes search answer instantly and keeps answering with the
studio down. So R3's fix is unchanged and its premise is intact — `/help/` is
still the heaviest page on the site, and the new guide pages carry the same two
scripts plus `help-guide.js`, which is where the same defer question now also
applies. The heaviest single guide is `/help/workspace/` at 37 KB of HTML.

**Fix:** verify the stamp still holds with `defer`, then defer them. **S** — one
attribute each and a re-run of `test/help.test.js`, whose *"the browser would
re-render on load"* assertion is the exact thing that must not break.

**SHIPPED 24 Aug 2026 as #170 — and the guarantee held, for a reason worth
writing down.** `defer` on all four tags (the hub's two, and `help-render.js` +
`help-guide.js` on each of the eleven guide pages). The stamp survives because
**it is a comparison of two hashes, not a race**: `help.js` reads
`data-corpus-hash` off `#helpGuides` and returns without touching the DOM when
the live corpus agrees; `help-guide.js` does the same with one guide's
`data-guide-hash`. Neither cares *when* it runs, only that the element it reads
is parsed — which `defer` guarantees where before it was merely likely. Order
holds for the same kind of reason: deferred scripts run in document order, so
`help-render.js` still defines `window.HelpRender` before the other two read it.

*Verified, not reasoned:* `test/drive.js` §7 (*"an unchanged corpus re-renders
nothing"*, alongside *"the live corpus was fetched"* — so the script demonstrably
ran and demonstrably did nothing), §7b (*"an unchanged guide re-renders
nothing"*), §7c(a)/(b) (#76's edited and brand-new guides still correct
themselves at runtime) and §7d (the three generations of legacy `#anchor` still
forward). 255 drive checks and 149 tests, both green.

*And verified again against the deploy, because a green suite is not a deploy.*
Production's own served bytes — `/help/`, `/help/workspace/`, `/help/sharing/`
and the three scripts, fetched from prospektor.ai and served back unmodified,
with only the studio's `/api/help` stubbed because Chromium has no egress here
— driven in a browser, **18/18**. The corpus fed back is the one production
itself embedded (`f8a722ab`), so *unchanged* means the literal bytes the live
page was built from. Both halves were asserted, which is what makes it worth
anything: the deferred script demonstrably **ran** (it fetched) and demonstrably
**did nothing** (`data-corpus-source` never became `runtime`, no guide returned
to the hub) — and when the corpus was moved instead, it re-rendered as it
should.

*Measured, and modestly.* Same build, twice, differing only by the attribute;
Chromium at a 4× CPU throttle with 150 ms per asset standing in for a mobile
round trip; median of nine. Lab and local, and labelled as such — there is still
no field data and none was invented.

| | `/help/` | `/help/workspace/` |
|---|---|---|
| `domInteractive`, blocking | 483 ms | 491 ms |
| `domInteractive`, deferred | **66 ms** | **60 ms** |
| First Contentful Paint, blocking | 508 ms | 544 ms |
| First Contentful Paint, deferred | **464 ms** | **508 ms** |

The honest reading: the parser finishes **~420 ms earlier**, because two
blocking scripts cost two *serial* round trips plus the synchronous
`buildIndex()` over the whole corpus before the parser may continue. **FCP moves
only ~40 ms**, because first paint is gated by the stylesheet either way — so
this is a real win and a small one, and F6's homepage framing (*"rendered
nothing below it"*) overstates it here: on `/help/` the tags sit near the foot of
the document, so what was blocked below them was the footer.

The one behaviour that could have got worse was checked rather than assumed:
#166's client-side forward for `/help/#guide-sharing` runs from `help.js`'s
synchronous body, so deferring moves it after the parse. Measured the same way,
814 ms blocking → 834 ms deferred — one step of run-to-run noise, on a legacy
anchor. A server redirect could not do better; a fragment is never sent to the
server.

**And the gap this closed that the row did not name.** F6 was found by *reading
the fact table by eye* — `tools/seo-audit.js` recorded `async`/`defer` per script
and flagged no defect, and nothing in `npm test` pinned the four scripts #137
did defer. So a fifth blocking script could have arrived tomorrow in silence.
Both halves are checked now: `test/pages.test.js` fails on any built page
serving a `<script src>` with neither `defer` nor `async` (derived from the
build, never a list of filenames — adding a page or a script can only turn it
red by adding a *blocking* one), and the audit flags the same defect against
production. That flag is what produced this row's before-and-after:
**24 findings across 12 pages before the deploy, 0 after.**

### R4 · Eleven help guides compete as one URL · **already filed as #166 · M**

`/help/` is one 24,000-pixel page holding eleven guides, so *"Sharing a pitch"*
and *"Billing, pausing, deleting"* cannot rank separately for the different
questions they answer. Per-guide URLs (`/help/<slug>/`) are the better long-tail
shape.

**Unchanged by this audit, and #166's own reasoning still stood at the time:** it
wanted Search Console data on which guides actually earn impressions, and it had
a real cost against #76 (a guide the studio adds would have no page until the
next website build, where today the runtime fetch shows it immediately). **This
audit added one input:** `/help/` was then the only page on the site carrying
long-tail content that is *not* individually addressable — the articles each have
their own URL, their own title, their own description and their own OG card.

**SHIPPED 24 Aug 2026 as #166, and the two objections were answered rather than
overruled.**

- *The data.* Search Console reports per URL. While eleven guides shared one, no
  amount of waiting could produce an impression count for a guide — the evidence
  the row wanted could not exist until the thing it would have judged was built.
  And the pages are **derived from the corpus**, so there was no per-guide
  judgment left for data to inform: the studio's docs decide what exists. What
  the data can still answer, once the operator finishes #135's steps 6–7 and
  three weeks pass, is the question that is now askable for the first time —
  *which guides earn impressions* — and that is an input to the help corpus
  itself, which is the studio's to write.
- *The #76 cost.* Removed, not accepted. The hub still renders a guide the last
  build never saw, inline and immediately, and points its card at the anchor —
  it simply has no URL of its own until the next build. And each guide page runs
  a reconcile of its own, so an **edited** guide corrects itself in the browser
  the moment the studio deploys. Both are driven in `test/drive.js` §7c.

What shipped: eleven URLs, each with its own title, description, `TechArticle`
and `BreadcrumbList`, all in the sitemap, all linked from the hub and from three
sibling guides by the same ring this audit's F13 built for `/resources/`. The
hub kept the search, the FAQ block and the embedded index. Old anchors
(`/help/#guide-sharing`, `/help/#sharing`, `/help/#sharing--revoking`) forward.

### R5 · `hreflang` — nothing to do yet · **blocked on #113/#114**

The site is single-language and correctly declares `lang="en"` everywhere. There
is no `hreflang` and there should not be: it is meaningless without a second
locale. The note for whoever builds #114 is that `hreflang` and the canonical
have to be designed **together** — every locale's page must self-canonicalise
and name every sibling including itself, and getting that pair wrong is the most
common way a translated site loses the ranking the English one already had.

### R6 · Field Core Web Vitals · **operator · 5 minutes, then wait**

Steps 6 and 7 of `RUNBOOK-search-console.md`. Then the *Core Web Vitals* report
will say *"not enough data"* for months, which is the correct and expected
answer at this traffic — it is not a problem to fix. R2 was the thing to do in
the meantime because it did not need traffic to be true, and it is done.

---

## 4 · What the next audit should do

Run `node tools/seo-audit.js` first — it takes about a minute and it will say
whether anything in §2 came back. Then, and only then, the thing this audit
could not do: open Search Console's *Performance* report and read the queries
prospektor.ai actually earns impressions on. **R1 and R4 are both waiting on
exactly that data**, and both are decisions that get worse when made from a
hunch. Nothing else here needs re-deriving.
