# Runbook: Google Search Console for prospektor.ai

**Board item #135** (WEBSITE · ops), 24 Aug 2026. The operator's ask, verbatim
(23 Aug): *"I will, in parallel, set up GSC to be able to track some site
visits. spawn a new thread for this and give me step-by-step instructions what
I need to do."*

This is that. Steps 1–7 are the operator's; they take about fifteen minutes and
need no deploy. Everything the repo owed was shipped with this file — see
*What the repo already does for you* at the bottom, and don't redo it.

There is a page version of this runbook — the same steps, easier to follow on
a second screen while clicking through Google's console:
<https://claude.ai/code/artifact/de7bbac5-f6c6-45dd-b079-380845db4662>

> ## Status — 24 Aug 2026
>
> **Steps 1–5 are done.** The operator added the record and Google verified
> the property while this was being written. Confirmed independently against a
> public resolver the same day: `prospektor.ai` now answers with **two** TXT
> records — the Spacemail SPF, untouched, and
> `google-site-verification=fxqB0sei8tktzRG7mYCI7J0a1dEA6KJkYLEYNth7ptU`.
> Leave both in place; Google re-checks its one periodically and un-verifies
> the property if it disappears.
>
> **What is left for the operator: step 6 and step 7.** Step 6 wants doing
> *after* this push is deployed — the sitemap it submits changed in the same
> release, from four URLs to three, and submitting the old one just means
> re-reading a report about a page we decided not to rank.
>
> Steps 1–5 are kept below rather than deleted. This is the record of how the
> property was verified, and the day anyone has to redo it — a lost account, a
> registrar move, a second domain — it is the thing they will be looking for.

---

## The decision, made and why

**Verify a Domain property (`prospektor.ai`) with a DNS TXT record.** Not the
HTML file, not the meta tag, not Google Analytics or Tag Manager.

| | Domain property + DNS TXT ✅ | URL-prefix + HTML tag |
|---|---|---|
| Needs a deploy | no | yes, every time |
| Covers `www.prospektor.ai` | yes | no — a second property |
| Covers `studio.prospektor.ai` | yes | no |
| Covers `http://` as well as `https://` | yes | no |
| Survives moving off Netlify | yes | no — the token lives in the build |
| Survives losing the Google account | yes — re-verify from the same record | yes |

The one thing the Domain property does that the URL-prefix one doesn't is pull
`studio.prospektor.ai` into the same reports. That was an argument against it
until today: the studio answers HTTP 200 with the same ~400KB app shell for
every path it doesn't recognise, so it would have filled the coverage report
with thousands of URLs that are all one page. **#135 shipped the studio's own
`robots.txt` and a `X-Robots-Tag: noindex, nofollow` header on that origin in
the same push**, so it now reports as a host that politely declines to be
indexed — three lines in the report instead of noise, and the report tells you
if a share link ever leaks into search, which is worth knowing.

If DNS genuinely isn't an option, the meta-tag fallback is prepared and tested
— see *If you have to use the meta tag instead* at the bottom. Prefer DNS.

---

## Before you start

Two facts, measured 24 Aug 2026, so you know what you're looking at:

- **DNS for prospektor.ai is at Spaceship**, not Netlify and not Cloudflare.
  The nameservers are `launch1.spaceship.net` and `launch2.spaceship.net`. If
  the panel you're in doesn't say Spaceship, you're in the wrong place.
- **The domain already has exactly one TXT record at the root**, the mail SPF:
  `v=spf1 include:spf.spacemail.com ~all`. You are **adding a second TXT
  record, not editing that one.** A domain is allowed many TXT records;
  overwriting the SPF would silently break outbound mail deliverability, which
  is the one way this task can do damage.

Pick the Google account before you start, and pick one you will still control
in two years — the property, and every report in it, belongs to that account.
The operator's own Google account is fine — this file deliberately does not
name it. **No personal address goes in this repository**: it is public, and
`OPERATOR_EMAIL` is set to that address on Netlify, so secrets scanning fails
every build that finds it here (it did, four times, 24 Aug 2026). The DNS
record is the real proof of ownership, so even a lost account is recoverable:
re-verify from the same record. Add a second owner at step 7 anyway.

---

## The steps

### 1 · Create the property

1. Go to <https://search.google.com/search-console> and sign in.
2. If it's your first property, Google offers the two boxes directly. If not:
   the property dropdown at the top left → **Add property**.
3. Choose the **Domain** box (the left one).
4. Type `prospektor.ai` — **no `https://`, no `www.`, no trailing slash.**
5. **Continue.**

### 2 · Copy the TXT record Google gives you

Google shows one line that looks like:

```
google-site-verification=abcdefGHIJKL1234567890_mnopQRSTUVwxyz0123456
```

Copy **the whole string, including the `google-site-verification=` prefix.**
Leave the tab open — you'll come back to press Verify.

### 3 · Add it at Spaceship

1. <https://www.spaceship.com> → sign in → **Domains** → **prospektor.ai** →
   **Manage** → the DNS records section (labelled *Advanced DNS* or
   *DNS records* depending on the panel version).
2. **Add record**, and set:
   - **Type:** `TXT`
   - **Host / Name:** `@` — this means the root of the domain. Some panels
     want it blank instead; if `@` is rejected, blank is the same thing. Do
     **not** put `prospektor.ai` in this field, or you'll create a record at
     `prospektor.ai.prospektor.ai`.
   - **Value / Content:** the whole `google-site-verification=…` string from
     step 2, with no quotes of your own.
   - **TTL:** leave the default (or set the minimum, e.g. 60 or 300 — it makes
     the next step faster and nothing depends on it being long).
3. **Save.** The existing SPF TXT record must still be listed afterwards. If
   the panel replaced it, put it back: `v=spf1 include:spf.spacemail.com ~all`.

### 4 · Wait for it to be visible, then check

Usually under five minutes; occasionally up to an hour. Check it yourself
rather than guessing — paste this into a browser:

```
https://cloudflare-dns.com/dns-query?name=prospektor.ai&type=TXT&ct=application/dns-json
```

or, from a terminal:

```
dig TXT prospektor.ai +short
```

You should see **two** strings: the SPF one and the `google-site-verification=…`
one. If you see only the SPF, wait and check again.

### 5 · Verify

Back in the Search Console tab → **Verify**. Green means done. If it fails,
it is almost always one of three things, in this order of likelihood: the
record hasn't propagated yet (step 4 says so — wait), the host field was
`prospektor.ai` instead of `@`, or the `google-site-verification=` prefix was
trimmed off when pasting.

**Do not remove the TXT record afterwards.** Google re-checks it periodically
and un-verifies the property if it's gone.

### 6 · Submit the sitemap, and ask for the homepage

1. Left sidebar → **Sitemaps**.
2. In *Add a new sitemap*, enter **`https://prospektor.ai/sitemap.xml`** →
   **Submit**. What the field wants depends on what it shows: a URL-prefix
   property pre-fills the domain and leaves a short box, where `sitemap.xml`
   on its own is enough; a **Domain** property — which is what this is —
   covers several hosts, so the box is often full-width and empty and wants
   the whole URL. Same file either way.
3. Expect status **Success**, and a URL count that isn't zero. The number
   itself moves — `/resources/` (#144) adds one every time an article is
   published. As of 24 Aug 2026 it is **13**: the homepage, `/privacy/`,
   `/terms/`, the `/resources/` hub and nine articles. What matters is
   *Success* with no errors beside it; a *Couldn't fetch* or a count of 0 is
   a real problem.
4. Paste `https://prospektor.ai/` into the search box at the very top
   (URL Inspection) → **Request indexing**. This is a nudge, not a guarantee,
   and it only needs doing once.

### 7 · Add a second owner

**Settings → Users and permissions → Add user**, with **Owner** permission, on
an address that isn't the one you just used. One account holding the only copy
of a year of search data is an avoidable single point of failure.

---

## Then: what to read, and when

**Nothing useful exists on day one.** Search Console backfills a little
history, but the reports this is for need Google to crawl and collect. Two
appointments, and then leave it alone:

**In 2–3 days — Pages (left sidebar, *Indexing → Pages*).** You are looking
for one thing: is the homepage indexed, and are the `/resources/` articles
being picked up? Everything else on that screen is noise until they are.

**In 2–3 weeks — Performance.** Queries, impressions, average position. This
is the data board item **#137** (the full SEO audit) is waiting for, and the
keyword list **#144** (the `/resources` blog) wants before its first article.
There is no point running either before this exists — that's why they were
queued behind this one.

### What is expected, and what is a real problem

| What the report says | Verdict |
|---|---|
| `/checkout/done/` and `/404` — *Excluded by 'noindex' tag* | ✅ correct, deliberate |
| `studio.prospektor.ai/...` — *Excluded by 'noindex' tag* | ✅ correct, shipped by #135 |
| `/checkout/` — *Crawled – currently not indexed* | ✅ expected; it's a form, deliberately not in the sitemap |
| `/help/` — *Crawled – currently not indexed* | ⚠️ known: the page serves a crawler the word *Loading…*. That's board item **#136**, not a new bug |
| `/app/` — *Page with redirect* | ✅ correct, it 301s to `/` |
| Core Web Vitals — *not enough data* | ✅ expected for months at this traffic; it needs real visitors |
| **Any 5xx, or *Server error (5xx)* on a sitemap URL** | 🚨 real. That's production down, not an SEO issue |
| **A `/p/…` share URL listed anywhere** | 🚨 real. The gate keeps the pitch itself out of a crawler's reach, but it names the sender and the target company — that reached the index. Tell the STUDIO lane |
| **`Couldn't fetch` on the sitemap** | 🚨 real. Check `https://prospektor.ai/sitemap.xml` returns 200 |

### Two things not to do

- **Don't submit `/checkout/` for indexing.** It's a form, not an answer to
  anything anyone searches. It stays crawlable and reachable from the homepage
  CTA, so nothing is lost; if the Performance report ever shows it earning
  buy-intent impressions, #137 can argue it back into the sitemap with
  evidence.
- **Don't use the *Removals* tool to tidy the report.** It hides URLs from
  results for six months without changing anything, and then they come back.
  Everything that should be excluded is already excluded by a `noindex` the
  code sets.

### Worth two minutes, later

Bing Webmaster Tools (<https://www.bing.com/webmasters>) can **import** a
verified Search Console property in about two clicks, which also covers
DuckDuckGo. No new DNS record, no new work. Do it once this is verified, or
never — it costs nothing either way.

---

## What the repo already does for you

Shipped and live before this runbook; you do not need to touch any of it.

- **`/robots.txt`** — allows crawling, names the sitemap. Live since 18 Aug.
- **`/sitemap.xml`** — generated from `src/sitemap.njk`, and it lists what we
  want *ranked* rather than what exists: the homepage, `/privacy/`, `/terms/`,
  the `/resources/` hub and every published article. That file records why
  `/checkout/`, `/help/`, `/checkout/done/`, `/404` and `/app/` are each
  deliberately out.
- **A canonical URL, `og:`/`twitter:` cards and a description on every page** —
  since 18 Aug.
- **`noindex` on `/checkout/done/` and the 404 page.**
- **The studio origin declines to be indexed** — `public/robots.txt` and an
  `X-Robots-Tag: noindex, nofollow` header in `netlify.toml`, both in
  `prospektor-ai/studio` (#135).
- **Tests that keep it true.** `npm run drive` fetches every URL in the built
  sitemap and fails if one 404s, is `noindex`, or disagrees with its own
  canonical — the classic Search Console error, caught before Google reports
  it. `npm run audit` asks the same of production, plus that the studio's
  refusal is really being served.

## If you have to use the meta tag instead

Only if DNS is impossible. It gives a weaker property (`https://prospektor.ai/`
only — not `www.`, not `studio.`, not `http://`) and it needs a deploy, but it
is prepared and tested, and it is one token:

1. In Search Console choose the **URL prefix** box instead, and enter
   `https://prospektor.ai/`.
2. Pick the **HTML tag** method. Google shows
   `<meta name="google-site-verification" content="TOKEN" />`.
3. Copy **only the `TOKEN` part** — not the whole tag.
4. In `src/_data/site.json`, set `"googleSiteVerification": "TOKEN"`.
5. Commit to `main` and wait for the Netlify deploy to finish.
6. Confirm it's live: `curl -s https://prospektor.ai/ | grep google-site-verification`
7. Press **Verify**.

`npm run drive` covers both branches of that switch — the meta is absent while
the key is empty, and present the moment a token is pasted in — so the fallback
is known to work before anyone needs it in a hurry.
