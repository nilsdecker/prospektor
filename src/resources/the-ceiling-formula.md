---
title: "The one number that caps how big your company can get"
seoTitle: "The one number that caps company size"
dek: "Divide your new revenue each month by your churn rate. That number is the size your company stops growing at — and no marketing channel, however good, can push you past it."
description: "The MRR ceiling formula: why churn is a hard cap on company size rather than a health metric, and the benchmark ladder for monthly churn."
topic: retention
learnings: ceiling-formula, ceiling-convergence, churn-benchmarks
date: 2026-08-24
readingTime: 7
ogImage: /assets/img/og/the-ceiling-formula.png
---

There is a chart almost every subscription business eventually produces. Revenue
climbs for eighteen months, then goes flat, and stays flat, while everybody keeps
doing the same amount of work. Marketing is landing customers. Sales is closing.
Nothing broke. The line simply stopped.

The explanation is one division, and it takes about ten seconds:

> **MRR ceiling = new MRR per month ÷ monthly churn rate**

Here is Jason Cohen running it live on a business doing $3,000 a month in new
recurring revenue at 9% monthly churn:

> So 3K of MRR comes in, but at 9%, so divided by 9%, and you get about 30, 40k in
> MRR, which is about where you are. And that's why this chart was flat, because
> you brought in 3K, but 3K left.
>
> Jason Cohen

The mechanism is worth stating slowly, because it is the part that surprises
people:

> If marketing is adding one K of MRR per month in new revenue, but cancellation
> is nine percent — as the company gets bigger and bigger, nine percent is nine
> percent of a bigger and bigger number. But marketing is still putting in 1K, 1K,
> 1K each month. So at some point, you're at a size where the number of customers
> or revenue that walks out the door in churn is equal to the amount that marketing
> is bringing in. And at that point the company is literally not growing.
>
> Jason Cohen

Churn is a *percentage* of a growing base. New revenue is an *absolute* number
produced by a team of fixed size. One of those scales with you and the other one
doesn't, so they always meet. Where they meet is your ceiling, and you can compute
it today.

## Why this is not a health metric

Most dashboards file churn next to NPS and support response time — things you keep
an eye on. It doesn't belong there. It belongs next to your headcount plan, because
it decides the maximum size of the company you are building.

Below the ceiling, every hour of acquisition work compounds: customers stack up and
the base grows. At the ceiling, the identical hour of acquisition work is a
treadmill — you are replacing people who left, at full cost, forever. The work
looks the same from inside. The outcome is completely different.

Which means the most important thing about the number is *when* you compute it. At
forty customers, changing churn means changing a product that forty people have
built habits around. At zero customers it means choosing a different cohort, which
is free.

## Run it on yourself

| New revenue per month | 8% churn | 5% churn | 3% churn | 2% churn |
|---|---|---|---|---|
| **$1,000** | ~$12.5K | ~$20K | ~$33K | ~$50K |
| **$2,000** | ~$25K | ~$40K | ~$66K | ~$100K |
| **$5,000** | ~$62.5K | ~$100K | ~$167K | ~$250K |

Read across a row rather than down a column. The row is what your acquisition
effort produces; the columns are what happens to it. **Halving churn does more for
the ceiling than doubling the sales team, and it is usually much cheaper.**

Two more pieces of arithmetic fall out of the same number and are worth having in
your head:

- **Average customer lifetime, in months, is 1 ÷ monthly churn.** At 5% that is
  twenty months. At 10% it is ten — and roughly 90% of a cohort is gone inside
  eight.
- **Your payback period has to fit inside that lifetime.** A four-month payback on
  a ten-month customer is a business; on a five-month customer it is a hobby with
  invoices.

## What counts as bad

Rob Walling's published ladder for monthly logo churn in B2B SaaS is blunt and
easy to remember:

| Monthly churn | Verdict |
|---|---|
| under 2% | great |
| around 7–8% | *"company on fire"* |
| over 10% | catastrophic |

The gap between "great" and "on fire" is six percentage points. It does not feel
like much on a dashboard. It is the difference between a $100K/month ceiling and a
$25K one at identical sales effort.

## The reason to trust this over most business advice

Walling arrives at the same formula independently, in a different year, about a
different company — *$4,000 in new MRR ÷ 4% churn = a $100,000/month ceiling* —
and adds the line that removes the mystique from the whole phenomenon:

> There is no magic revenue level at which companies plateau — only this
> arithmetic.

Two operators who built at very different scales, working from different data,
reaching for the same instrument first. That is about as close to consensus as
this field produces, and it is a much stronger reason to take the number seriously
than any single person's opinion about it.

## What to do this week

1. **Compute it.** New MRR added last month, divided by last month's churn rate.
   One line. If you cannot produce both numbers, that is the finding — go and
   instrument the second one, because you already have the first.
2. **Compare it to your goal.** If the ceiling is below the number you are
   planning around, no channel fixes it. Stop reading channel advice and go and
   look at who is leaving.
3. **Split churn by cohort before you react to it.** A 10% blended rate that lives
   entirely in one segment is not a churn problem, it is a targeting problem
   wearing a churn costume — and the fix is the list, not the product.
4. **If you are pre-revenue, choose the cohort with the ceiling in mind.** The
   cheapest possible moment to fix churn is before anyone has churned.

The uncomfortable version: if you are flat and busy, you are almost certainly at
your ceiling, and every additional hour of prospecting is being spent to stand
still. The way out is not more of it. The way out is a base that leaks less, which
begins with picking different people to sell to.
