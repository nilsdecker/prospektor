---
title: "How to size a market in four minutes"
seoTitle: "Market sizing: TAM vs reachable market"
dek: "Most growth plans die on arithmetic nobody did. Four crude numbers, multiplied on the back of an envelope, will tell you whether a segment can produce your target at all — before you spend a quarter finding out."
description: "The powers-of-ten market sizing test, why total reachable market beats total addressable, and how to kill a bad segment in four minutes, not four months."
topic: targeting
learnings: powers-of-ten, trm-not-tam, size-the-segment-first
date: 2026-08-21
readingTime: 6
ogImage: /assets/img/og/size-a-market.png
---

Here is a way to lose two quarters. Pick a plausible customer segment. Build a
list. Write good outreach. Run it properly. Discover, in month five, that even if
the campaign had worked perfectly it could not have produced the number you
needed, because there were never enough companies in the segment paying enough
money.

That failure is entirely preventable, and the prevention takes about four minutes.
It is deliberately crude, and the crudeness is the point.

## The four numbers

1. **How many companies in the world plausibly have this use case?** Not could-be-sold-to
   in theory. Have the specific problem. Answer in powers of ten — 10³, 10⁴, 10⁵.
   Do not attempt precision.
2. **What share could you realistically reach and convert?** 1%? 10%? Be pessimistic,
   and remember that reaching them is a separate problem from converting them.
3. **What do they pay per month?**
4. **Multiply. Does it reach your goal?**

Then apply the only rule that matters:

> If it's not even within a power of 10 of what I want, then it's just not the
> answer. The numbers are just too small. Now, obviously we made up all those
> numbers and they're not exactly right. But if it's off by a whole power of ten,
> it's just wrong.
>
> Jason Cohen

The made-up-ness is not a weakness of the method. It is what makes it fast enough
to actually run. You are not forecasting; you are checking whether a plan is off
by an order of magnitude — and a startling number of plans are.

## What it looks like when it fails

In a live teardown of ScreenshotOne, a screenshot API doing $32k/month, this test
was run three times against the founder's three best customer use cases.

**Integration testing for hosting providers.** How many companies host more than a
hundred websites? Call it 10,000. What share could be convinced to rebuild their
deploy pipeline around screenshots? The founder's optimistic answer was 10%;
Cohen's was 1%. At $300/month, 1% is **$30,000/month** — against a $100,000 goal.
Off by a factor of three at best, and that assumed the optimistic conversion.

**Screenshots inside cold email.** How many companies in the world would want this,
ever? The founder's own estimate of the *entire global market* was about a
thousand — smaller than his existing customer base. Dead on the first number.

Neither of those conclusions required a campaign. They required four minutes and
the willingness to say a small number out loud.

## What it looks like when it passes

The same test, run by Jesse Schoberg on DropInBlog's move into BigCommerce stores:

- BigCommerce has roughly **37,000** stores.
- About **one in seven** does over $400,000 a year — the ones with budget.
- Convert **5%** of those.
- At the team plan: **$40,000 MRR**. At the business plan: **$100,000 MRR**.

> Those are both respectable numbers that would move us to the next chapter.
>
> Jesse Schoberg

That is what a segment looks like when the arithmetic clears. Note that it is not
a big market — 37,000 companies is small. It does not need to be big. It needs to
be **big enough, reachable, and rich enough**, which is a completely different test
from the one most market-sizing decks run.

## Reachable, not addressable

Which is the second half of this. The standard TAM slide answers *how much money
exists in this category* — a number that is essentially never the constraint for a
company doing outbound with a small team. Rob Walling's version replaces it with
**total reachable market**: not how many could buy, but how many you can actually
get in front of, with the channels and the budget you have.

The distinction matters because the two numbers can differ by three orders of
magnitude. There may be four million small businesses who would benefit from your
product. If your only channel is founder-led outreach and you can run forty real
conversations a month, your reachable market this year is about five hundred
companies. Every plan should be built against **that** number.

The practical consequence is counter-intuitive: a smaller, denser segment usually
beats a larger, diffuse one, because reachability collapses with diffusion. Ten
thousand companies who all attend the same two conferences, read the same
newsletter and hire from each other are worth more than a million companies with
nothing in common — the second group has a bigger TAM and a smaller TRM.

## The version to run this week

Take the segment you are currently working, and fill in one row:

| | |
|---|---|
| Companies with this exact use case | 10^__ |
| Share you can *reach* in 12 months | ___ % |
| Share of those who convert | ___ % |
| Monthly price | $___ |
| **= Monthly revenue if it all works** | **$______** |

Then ask the only question: **is that within a power of ten of what you need?**

If yes, the segment is viable and your problem is execution — go and execute.

If no, no amount of campaign quality will rescue it. You have three moves, and
only three: raise the price, widen the segment, or pick a different one. Doing
better outreach is not on the list, and doing better outreach is what most teams
do for the next two quarters.

The value of this test is not that its numbers are right. It is that it is cheap
enough to run before committing, and it reliably kills the plans that were never
going to work — which is most of them.
