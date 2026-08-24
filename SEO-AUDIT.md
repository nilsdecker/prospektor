# SEO audit — prospektor.ai

**Board item #137** (WEBSITE · ops), 24 August 2026. Queued deliberately behind
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
become true. One of them (**R2**) was fixed in this thread; the other (**R3**)
is a real cost with a real fix and is ranked accordingly.

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
**R3** below rather than done blind.

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

### R1 · The site is written in a vocabulary nobody searches · **CEO lane · S to implement, blocked on evidence**

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

### R2 · Assets cannot be cached, so every repeat visit revalidates all of them · **M**

Measured on production: `/assets/css/main.css` answers
`cache-control: public, max-age=0, must-revalidate`. So does every other asset.
The filenames carry no content hash, so Netlify cannot safely do better — a
long cache on `main.css` would serve a stale stylesheet after the next deploy.

The cost is not bandwidth (an `ETag` makes each one a 304, and the compressed
payloads are healthy: homepage **6.2 KB**, `main.css` **11.4 KB**, `scan.js`
**3.3 KB** on the wire). The cost is **eight conditional round-trips before a
repeat visitor sees anything**, which is a real LCP tax on exactly the visitor
most likely to buy.

**Fix:** content-hashed asset filenames at build time plus
`Cache-Control: public, max-age=31536000, immutable` for `/assets/*` in
`netlify.toml`. **M** — it touches the build, every template reference, and the
OG-card tooling, and it wants the drive re-run. Worth doing before any paid
traffic arrives, not urgent while traffic is what it is.

### R3 · `/help/`'s two scripts still block, on the heaviest page on the site · **S**

`/help/` is **127 KB** of HTML (31 KB compressed) — the whole help corpus,
prerendered by #136, which is correct and is why it can rank. Its two scripts
were left un-deferred by F6 because #136 stamps a corpus hash to prevent a
double render and that guarantee was not re-verified here.

**Fix:** verify the stamp still holds with `defer`, then defer them. **S** — one
attribute each and a re-run of `test/help.test.js`, whose *"the browser would
re-render on load"* assertion is the exact thing that must not break.

### R4 · Eleven help guides compete as one URL · **already filed as #158 · M**

`/help/` is one 24,000-pixel page holding eleven guides, so *"Sharing a pitch"*
and *"Billing, pausing, deleting"* cannot rank separately for the different
questions they answer. Per-guide URLs (`/help/<slug>/`) are the better long-tail
shape.

**Unchanged by this audit, and #158's own reasoning still stands:** it wants
Search Console data on which guides actually earn impressions, and it has a real
cost against #76 (a guide the studio adds would have no page until the next
website build, where today the runtime fetch shows it immediately). **This audit
adds one input:** `/help/` is now the only page on the site carrying long-tail
content that is *not* individually addressable — the nine articles each have
their own URL, their own title, their own description and their own OG card.
That asymmetry is the argument for #158, and it is still an argument to settle
with data.

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
answer at this traffic — it is not a problem to fix, and R2 is the thing to do
in the meantime because it does not need traffic to be true.

---

## 4 · What the next audit should do

Run `node tools/seo-audit.js` first — it takes about a minute and it will say
whether anything in §2 came back. Then, and only then, the thing this audit
could not do: open Search Console's *Performance* report and read the queries
prospektor.ai actually earns impressions on. **R1 and R4 are both waiting on
exactly that data**, and both are decisions that get worse when made from a
hunch. Nothing else here needs re-deriving.
