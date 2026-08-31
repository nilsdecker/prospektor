---
name: publish-article
description: Publish one article to /resources/ on prospektor.ai. Use when writing, drafting or shipping a resources article, working the SEO content queue, or when asked to publish the next queued piece. Covers picking the topic, the ledger row, the wiring that decides whether the page ranks, and what to verify before and after the push.
---

# Publishing one article to /resources/

The procedure, so a run does not improvise. Written for #446 from
`SEO-AGENT-SETUP.md` §2.4 and adapted to what this repo actually does — three
of the brief's manual steps are **automatic here**, and doing them by hand is
how a redundant edit becomes a bug.

Read `docs/seo/project-facts.md` first. It holds the price, the banned claims
and the voice sample, and it is the file that says what may never be stated.

---

## 0 · Before you write a word

**Claim the board row.** `BOARD.md` lives in `prospektor-ai/studio`; the Claim
rule wants the row in Doing with your branch and conversation link, pushed,
*before* the first line of work.

**Check the cannibalisation report.**

```
npm run gsc:cannibals
```

If a query already has two of our URLs on it, the answer is consolidation, not
a third page. If the report is empty because there is no data yet, say so in
the log rather than treating silence as permission.

**Defend `distinct_from` out loud.** Open the queue item and argue its
`distinct_from` line against the **named** existing articles, on the day, by
reading them. Not against a category — against the pages. If you cannot defend
it honestly, the item does not get written; mark it `blocked` in the queue with
the reason. This is the single instruction in this file most worth obeying,
because breaking it is invisible for weeks and then costs both pages.

---

## 1 · The ledger row — this repo's extra step, and it is not optional

`/resources/` is defined as **one article per useful learning** (#159).
`test/learnings.test.js` enforces it **in both directions**: an article whose
`learnings:` frontmatter names an id the ledger has never heard of fails
`npm test`, and so does an article with no learning at all.

So a new article ships **with its ledger row in the same commit**:

```json
{ "id": "<learning-id>", "ref": "§7.1", "title": "<the finding, in one line>",
  "verdict": "article", "article": "<slug>" }
```

The finding must be real and in
`prospektor-ai/studio` → `docs/research/growth-playbook.md`. **Do not invent a
learning to justify an article.** If the article has no finding behind it, that
is the finding: it should not be written.

Parts 2, 4, 6 and 7 of the playbook carry no rows by default, and the ledger's
own scope note says what to do about it — *"Promote a row out of them the day
one turns out to be — the rule is the reader, not the part number."* Promoting
is legitimate. Note the promotion in the ledger's `$comment` when you do.

---

## 2 · Copy an article, do not write markup from memory

```
cp src/resources/do-not-delegate-sales.md src/resources/<slug>.md
```

Then replace the content. The frontmatter fields, all of them required except
where noted:

```yaml
title:       # the <h1> a reader sees. Write it for the reader.
seoTitle:    # OPTIONAL — only if `title` exceeds the 60-char budget.
dek:         # one sentence under the h1
description: # 140–156 chars. What a search result shows.
topic:       # an EXISTING topic unless there is a reason; it drives the hub filter
learnings:   # comma-separated ledger ids
date:        # YYYY-MM-DD
readingTime: # minutes, integer
ogImage:     # /assets/img/og/<slug>.png
```

**`seoTitle` changes the search result only, never the `<h1>`** (#137 F1). It
is the tool for a headline that reads well and is too long for a result — not
a licence to write a worse headline.

**Do not hand-write a head block.** `src/_includes/base.njk` and
`article.njk` emit the title, description, canonical, OG, Twitter, `Article`
and `BreadcrumbList` for you, from the frontmatter above. A hand-written tag
here is a duplicate, and #137 F2 is what duplicates cost.

---

## 3 · The wiring — what actually decides whether the page ranks

**Three of the brief's wiring steps behave differently here. Read all three.**

1. **The sitemap entry is AUTOMATIC.** `src/sitemap.njk` iterates
   `collections.resources` and takes `lastmod` from the article's own
   frontmatter. **Never hand-add a URL.**

2. **The index card is AUTOMATIC.** `src/resources.njk` renders the same
   collection and derives the topic filter row from the articles themselves.
   **Never hand-add a card.**

3. **INBOUND INTERNAL LINKS ARE NOT — and this is the step that gets skipped.**

   The `related` ring in `.eleventy.js` gives every article exactly three
   inbound links **by construction** (#137 F4 built it after measuring a
   distribution of 9,9,9,4,1,1,1,1,1). So nothing is orphaned, and that is
   genuinely handled.

   **But a ring is not a topic cluster.** Its three links are structural — they
   say *this is an article on this site*, not *this article is about the thing
   you just read*. A page in a cluster additionally earns:

   - **at least two in-prose links from existing sibling articles**, written by
     hand into their body text, in a sentence that would exist anyway;
   - **a link up to the cluster's pillar** from the new article.

   Edit the siblings in the same commit. A link added later is a link that does
   not get added.

---

## 4 · The OG card

```
npm run og
```

Generates `/assets/img/og/<slug>.png` from the frontmatter. The site serves
**zero `<img>` elements** — these cards are never rendered by a page, only
fetched by social crawlers, which is why they are not content-hashed
(`netlify.toml` explains the exception).

---

## 5 · Validate — in this order, and read the output

```
npm test                    # includes the ledger check and the SEO assertions
npm run drive               # a real browser over the built site
node tools/seo-audit.js     # asks PRODUCTION — run it again after the deploy
```

`npm test` is the one that catches the ledger, the title budget, a duplicate
description, a heading jump, an unterminated tag in `<head>`, and an internal
link to a page that does not build.

**Never skip the validator, and never commit a bulk scripted edit without
re-reading the files it touched.**

---

## 6 · Ship

`main` is production. **There is no staging.**

```
git fetch origin main && git rebase origin/main    # CI commits here too
npm test                                            # again, post-rebase
git push -u origin <branch>
```

Then merge to `main`, and **verify against the live site** — rule 5 of the
thread protocol. Netlify takes 15–60 seconds, so a 404 immediately after the
push means nothing:

```
until curl -sf -o /dev/null https://prospektor.ai/resources/<slug>/; do sleep 5; done
```

Warn anyone watching that their browser may have cached that first 404.

---

## 7 · Close the loop

- **Queue** — set the item's `status` to `published` in
  `docs/seo/content-queue.json`. It is only published once the URL answers 200.
- **Board** — move the row to Shipped with the deploy commit, and write the
  `ROADMAP.md` entry. A row leaving Doing gets an archive entry whether or not
  production changed.
- **Log** — anything you learned that the next run needs goes in a **file**.
  #293 is the standing example: an SEO thread reported two real findings into a
  conversation, and nothing on this surface can read a session transcript back.
  They are unrecoverable. Threads are disposable; files are permanent.

---

## Rules that do not bend

- **Never invent a fact** — no customer names, testimonials, review counts,
  user numbers or case studies. There are no renewals at list price yet, so any
  sentence implying an installed base is false.
- **Never name a competitor's price or feature** unless read off their live page
  that day and dated in the article. The current series is teaching-first with
  tool categories generic, which mostly resolves to: do not name rivals.
- **Never publish two pages targeting one keyword.**
- **Never 301 or delete a live URL** without the operator saying so explicitly.
- **Never send email and never post anywhere.** Draft only.
- **A design flaw in this file is likelier than a mistake on your part.** If it
  contradicts the repo, the repo wins — and write the contradiction into the
  queue's `$comment` so the next run does not rediscover it.
