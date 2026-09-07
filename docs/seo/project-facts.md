# SEO agent — project facts

**Board item #446** (WEBSITE · ops), 31 August 2026. Section 0 of
`SEO-AGENT-SETUP.md`, answered. The brief is emphatic that these are asked and
never guessed — *"publishing a guessed postal code or price is worse than
publishing nothing"* — so every line below is either the operator's own answer
or a value read out of this repo, and the source is named where it is read.

Anything an agent needs mid-run is here. Anything it must not invent is here
too, said as a prohibition rather than left as an omission.

```yaml
site:
  name:            Prospektor                       # src/_data/site.json
  domain:          https://prospektor.ai            # canonical, non-www
  repo:            prospektor-ai/prospektor-website
  deploy_branch:   main                             # pushing here deploys to production
  has_staging:     false                            # THERE IS NO STAGING. main IS production.

business:
  what_it_sells:   A Prospektor workspace — research target companies,
                   score fit, draft the deck/emails/proposal/call prep.
  primary_locations: none — not a local business, no local SEO, no NAP
  canonical_NAP:   NOT PUBLISHED, and not to be invented. #55 (Impressum) is
                   still open and #154 records that the operator's address must
                   stay out of this public repo. No address, no phone.
  pricing:         $999 / month, per workspace, subscription.
  delivery_promise: Free scan, ~90 seconds, no account and no card.
  hard_facts_source: data/learnings.json (the ledger) + the article already on
                   disk. Podcast quotes come from the studio repo's
                   docs/research/growth-playbook.md and nowhere else.
```

## What may be stated as fact

**The price** is `$999/month per workspace`. It is not transcribed from copy:
`netlify/functions/create-checkout-session.js` carries
`unit_amount: '99900'`, `currency: 'usd'`, `interval: 'month'`, and
`test/seo.test.js` asserts the `/pricing/` `Offer` against that same constant.
An article naming a price names this one or names none.

**The product claims** already published on `/`, `/who-to-pitch/`,
`/what-to-send/` and `/pricing/`. If a claim is not on one of those pages or in
the ledger, it is not established.

**Podcast quotes** are quotable when the ledger carries the learning they came
from. A quote that cannot be traced to a `data/learnings.json` row does not go
in an article, however good it sounds.

## What may never be stated

No customer names, no testimonials, no review counts, no logos, no awards, no
user counts, no revenue figures, no case studies, no "trusted by" anything.
**There are no renewals at list price yet** (`CLAUDE.md`) — so any sentence
implying an installed base is false, and a false sentence on this site is worse
than a missing one.

No competitor pricing, feature matrix or capability claim unless it is read off
that competitor's own live page on the day of writing and dated in the article.
The operator's 31 Aug ruling on #447 keeps the founder-led-sales series
**teaching-first with tool categories generic** — which means this prohibition
mostly resolves to *don't name rivals*, and that is the cheap way to stay true.

No discounts, no trials and no guarantees beyond what `/pricing/` already says.

## Content

```yaml
article_dir:       src/resources/<slug>.md         # permalink /resources/<slug>/
index_page:        src/resources.njk               # derived — needs NO edit per article
template_article:  src/resources/do-not-delegate-sales.md
shared_components: src/_includes/base.njk, src/_includes/article.njk
image_host:        none. The site serves ZERO <img> elements.
                   OG cards are generated: npm run og
schema_types:      Article + BreadcrumbList per article (src/_includes/article.njk)
                   Organization + WebSite sitewide (base.njk)
```

**Three wiring steps the brief calls the ones that get skipped, and what each
costs here.** They are worth stating precisely, because on this site two of the
three are already automatic and treating them as manual is how a redundant edit
becomes a bug:

1. **Sitemap entry — automatic.** `src/sitemap.njk` iterates
   `collections.resources`. A new article is in the sitemap at the next build
   with `lastmod` from its own frontmatter. **Do not hand-add a URL.**
2. **Index-page card — automatic.** `src/resources.njk` renders the same
   collection, and the topic filter row is derived from the articles' own
   `topic` fields. **Do not hand-add a card.**
3. **Inbound internal links — automatic *and* insufficient.** The `related`
   ring in `.eleventy.js` gives every article exactly three inbound links by
   construction (#137 F4), so nothing is orphaned. **But a ring is not a
   topic cluster.** An article in a cluster additionally earns **at least two
   in-prose links from its siblings**, written by hand into the body, because
   the ring's three are structural and say nothing about what the page is
   about.

**And one this site has that the brief's site did not: the ledger.**
`/resources/` is defined as one article per useful learning (#159), and
`test/learnings.test.js` enforces it in both directions. An article whose
`learnings:` frontmatter names an id `data/learnings.json` has never heard of
fails `npm test`, and so does a ledger row claiming an article that does not
exist. **A new article therefore ships with its ledger row in the same commit.**

## Voice

Three sentences off the live site, for a writer to match rather than to guess at:

> The wish is universal and completely understandable: hire someone who is good
> at selling, so the founder can go back to building the thing. It is also the
> most reliably expensive early hire in software, and the reason is not that
> salespeople are bad at their jobs.

> That is worth sitting with, because it inverts the intent. The merge tag was
> supposed to signal *I see you.* To an experienced buyer it signals the
> opposite.

> Prospektor reads a company's own website before it says anything about them —
> what they sell, to whom, and what changed recently.

The register: **second person, present tense, concrete nouns, no hedging.** A
claim arrives with the number or the name that makes it checkable. Paragraphs
are short. Em dashes are used and are not apologised for. British spelling
(*personalisation*, *organisation*, *recognise*).

**`.claude/skills/style/SKILL.md` in the studio repo is binding** on anything
that writes customer-facing words, this file included. Its law: *less is more;
the design question is what to hide.* Rule 1 — lead with the fact, kill the
windup — is the one an article draft breaks most.

**Banned:** *leverage* (verb), *utilise*, *seamless*, *robust*, *cutting-edge*,
*game-changer*, *supercharge*, *unlock*, *empower*, *in today's fast-paced*,
*it's no secret that*, *look no further*. Also banned: the listicle opener that
restates the headline as a question, and any sentence beginning *"In this
article, we'll…"*.

## Owner rules

- **Never send email and never post anywhere.** Draft only.
- **Never 301 or delete a live URL** without the operator saying so explicitly.
- **Never publish two pages targeting one keyword.** Run the cannibalisation
  check first; `distinct_from` in the queue must be defensible against the
  named existing pages, not against a category.
- **Never invent a fact.** If a section needs a number nobody has, the section
  comes out and the gap is flagged.
- **main is production.** There is no staging and no preview to hide behind.
- **Everything durable goes in a file.** #293 is the standing worked example:
  an SEO thread reported two real findings into a conversation and nothing
  else, and they are now unrecoverable — no tool on this surface can read
  another session's transcript.
