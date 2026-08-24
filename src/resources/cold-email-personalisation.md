---
title: "Personalisation that works, and personalisation that costs you trust"
seoTitle: "Cold email personalisation that works"
dek: "Using someone's first name is not personalisation — and the people you most want to reach read it as proof that a machine sent the email. Here is the line between the two."
description: "Why first-name merge tags reduce reply rates with sophisticated buyers, what actually reads as personal in a cold email, and how to do it at volume."
topic: cold email
date: 2026-08-24
readingTime: 6
ogImage: /assets/img/og/cold-email-personalisation.png
---

There is a piece of advice that has survived twenty years of sales training
without anyone checking whether it still works: *use their name*. Put it in the
subject line. Use it again in the opener. Use it a third time before the ask.

Here is Jason Cohen — founder of Smart Bear and WP Engine, and a person whose
inbox is a reasonable proxy for the inbox of anyone you are trying to reach —
describing what that actually does:

> There's that thing where you're supposed to use the other person's name all the
> time. People do that on purpose, and that means I don't trust you. So to me it
> has the opposite effect.
>
> Jason Cohen

That is worth sitting with, because it inverts the intent. The merge tag was
supposed to signal *I see you.* To an experienced buyer it signals the opposite:
**only automation is that disciplined about repeating a name.** No human writing
to one person writes that way. The tell is not that the name is wrong. The tell
is that it is deployed.

## The distinction that actually matters

In the same conversation, Cohen describes the version that does land — a cold
email containing a screenshot of the recipient's own website:

> If you show me my own stuff, then it seems more personalized. Maybe I'll look
> at it, and it doesn't seem quite so cold of an email.
>
> Jason Cohen

Both of those are "personalisation". They are not remotely the same move, and
the difference is not stylistic. It is **evidence of work**.

- `{{ "{{FirstName}}" }}` costs nothing. It is one column in a CSV. Because it costs
  nothing, it proves nothing — and a buyer who has received four hundred of these
  knows exactly what it cost.
- A specific, verifiable observation about the recipient's business costs
  somebody twenty minutes. It proves that a person — or something acting with a
  person's diligence — actually looked before they wrote.

Cold outreach is a trust transaction conducted entirely through inference. The
recipient cannot check your claims, so they grade the **signal of effort** instead.
Every element of your email is read as a proxy for how much you cared. Merge tags
read as *not at all*.

## What counts as showing someone their own stuff

The screenshot is one instance of a general rule: reference something that could
only be true of this company, that you could only know by looking.

**Strong signals** — things that require someone to have read:

- What they actually sell, described in their own vocabulary rather than their
  category's. Every project-management tool says "project management"; the good
  ones describe a specific job.
- Something that changed recently, with the source. A new market they announced,
  a role they are hiring for, a partner they added, a page they rewrote.
- A named constraint you can infer from their setup — they sell to enterprise but
  have no security page, they have twelve integrations but not the one their
  segment needs.
- Who else is already selling to their buyer without competing with them. This is
  the most useful thing you can put in a first email, because it is immediately
  actionable and it is about them, not you.

**Weak signals** — things a list vendor supplies, which the recipient knows:

- First name, company name, job title, headcount, funding round, tech stack.
- "I saw you're in [industry] and thought I'd reach out."
- "Congrats on the round!" — the highest-volume opener in B2B, and therefore the
  one with the least information in it.

The test is simple and slightly uncomfortable: **could you paste this sentence
into an email to a different company and have it still make sense?** If yes, it
is not personalisation. It is a template with a variable in it, and it will be
read as one.

## The objection, and the honest answer

The obvious problem: strong signals do not scale. Twenty minutes of reading per
prospect is four prospects a morning. Merge tags exist because volume exists.

There are only three real answers to that.

**One: accept lower volume.** If your average contract is worth enough, forty
researched emails beat four hundred merged ones — and at high enough deal sizes
this is simply correct. The threshold practitioners tend to name for outbound
being economic at all sits somewhere around $3,000–$5,000 of annual contract
value. Below it, the maths gets hard.

**Two: narrow the segment until the research generalises.** If you only write to
BigCommerce stores doing over $400k, a lot of the reading is shared across the
list. You do the work once and the specifics stay specific. This is the quiet
argument for niching: it is not only a positioning move, it is a **research
efficiency** move.

**Three: automate the reading, not the writing.** This is the interesting one,
and it is the distinction most "AI SDR" tools get backwards. They automate the
*writing* — which produces four hundred fluent, personalised-looking emails that
say nothing only a reader of that company could have written. The recipient's
inference machine catches it immediately, because the tell was never grammar. It
was evidence.

Automating the *reading* is the opposite: open the company's actual site, follow
the pages that say what they sell and to whom, note what changed and when, record
what you ruled out — and then let a human write the email from a page of real
findings. The volume goes up. The evidence stays real.

## What to do on Monday

1. Open your current sequence. Delete every merge tag that is not strictly
   necessary for the sentence to parse.
2. Take the first line of email one and apply the paste test. If it survives being
   moved to another company, it is doing no work — replace it with one verifiable
   observation.
3. Pick the three signals above that you can actually source for your segment and
   make them a required field on your list. If a row cannot be filled in, that row
   is not ready to email.
4. Measure reply rate, not open rate. Merge tags do fine on opens. They lose on
   the only metric that pays.

The uncomfortable summary is that good cold email has always been expensive, and
most of the tooling built in the last decade has made it cheaper rather than
better. The cost was never the writing. It was the looking.
