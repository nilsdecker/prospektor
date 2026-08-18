# Runbook: moving checkout to the B.V.'s Stripe account

For the operator. Prospektor's checkout has been billing from a **Canadian**
Stripe account (`acct_1OH8bBKje8MFjLA6`, legal name *Prospektor.AI*). The
operator's decision of 18 Aug 2026 is that **ND Management Holding B.V.** is
the seller and the contracting party — which is what `prospektor.ai/privacy`
and `/terms` already say. So the money has to move to the B.V.'s account
(`acct_1PXoNrEx6vRhWp5j`).

**Do this while there are zero subscribers.** There are, as of 18 Aug 2026.
Stripe subscriptions do **not** migrate between accounts, so every subscriber
at cutover time has to re-subscribe by hand. Right now that cost is zero. It
never gets smaller.

---

## What does *not* need doing, which is most of it

Checked in the code rather than assumed:

- **No product or price to recreate.** `create-checkout-session.js` builds the
  subscription with inline `price_data` ($999.00/month USD), specifically so no
  dashboard object has to exist. Nothing to copy.
- **No price, product or account id anywhere in the code.** `grep` for
  `price_`, `prod_`, `acct_`, `pk_live` across `src/` and `netlify/` returns
  nothing. Everything account-specific is an environment variable.
- **No code change at all.** This cutover is environment variables plus Stripe
  dashboard configuration. There is nothing to deploy except the rebuild that
  picks up the new env values.
- **The studio site is untouched.** `prospektor-ai/studio` contains no Stripe
  code — only `PROVISION_SECRET`, which is shared between the two sites and
  does not change. Do not edit the studio's environment for this.

---

## 1. The Stripe dashboard, on the B.V. account

Everything below is on `acct_1PXoNrEx6vRhWp5j` ("ND Management Holding B.V.").
As of 18 Aug the business details, branding, statement descriptor
(`PROSPEKTOR.AI`), support email, privacy and terms URLs and bank accounts are
already done. What remains:

1. **Create the webhook endpoint.** Developers → Webhooks → *Add endpoint*.
   - **Endpoint URL:** `https://prospektor.ai/.netlify/functions/stripe-webhook`
   - **Events to send:** `checkout.session.completed` **and**
     `checkout.session.async_payment_succeeded`. The handler acts on both; send
     only the first and any delayed payment method provisions nothing.
   - Save, then **reveal the signing secret** (`whsec_…`). That is step 2's
     `STRIPE_WEBHOOK_SECRET`.
2. **Copy the secret API key.** Developers → API keys → *Secret key*
   (`sk_live_…`). This account must be in **live mode**, not test.
3. **Recreate any promotion codes.** Coupons and promotion codes live per
   account. The checkout passes `allow_promotion_codes: true`, so codes are
   entirely a dashboard thing — recreate whatever founding-client rates exist
   on the Canadian account. Nothing in the code names a code.

---

## 2. Netlify — the **website** site only

Site: the one serving `prospektor.ai`. Site configuration → Environment
variables. Two values change, nothing else:

| Variable | New value |
|---|---|
| `STRIPE_SECRET_KEY` | the B.V. account's `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | the `whsec_…` from the endpoint created above |

**Leave alone:** `STUDIO_PROVISION_SECRET`, `POSTMARK_SERVER_TOKEN`,
`POSTMARK_FROM`, `OPERATOR_EMAIL`. None of them are account-specific.

**Then trigger a deploy.** Netlify only hands new environment values to
functions on a fresh build — saving them is not enough. Deploys → *Trigger
deploy* → *Deploy site*.

**Do not touch the studio site's environment.** Nothing there refers to Stripe.

---

## 3. Prove it, before telling anyone it works

```bash
# the availability probe — 200 means a key is configured and usable
curl -s -o /dev/null -w '%{http_code}\n' \
  https://prospektor.ai/.netlify/functions/create-checkout-session

# the webhook rejects an unsigned body — 400 is correct and proves the
# signature check is running against the new secret
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://prospektor.ai/.netlify/functions/stripe-webhook \
  -H 'content-type: application/json' -d '{}'

npm run audit   # 25 live claims against production
```

Then the only check that actually proves the money moved: **run one real
checkout from the pricing tile.** What to look for, in order:

1. The Stripe-hosted page shows the **Prospektor** logo and, in the fine
   print, **ND Management Holding B.V.** — not Prospektor.AI, and not a
   Toronto address.
2. The charge lands in the **B.V. account's** payments list, not the
   Canadian one.
3. The card statement, days later, reads `PROSPEKTOR.AI`.
4. A workspace is provisioned — the webhook fired and provision succeeded.
5. The operator notice email arrives.

If (4) fails, the webhook secret is wrong or the endpoint is missing an event
type. Stripe's webhook log shows the delivery attempt and the response body,
and it retries for days, so a fix lands without losing the buyer's workspace.

---

## 4. Afterwards

- **Leave the Canadian account alone.** It is the record of the test purchases
  made before the cutover; those payments and their receipts stay where they
  are. Do not close it until an accountant has what they need from it.
- **Stop new charges reaching it.** Once the website's keys point at the B.V.,
  nothing can create a session there — but if any payment link or price was
  ever shared from that account by hand, deactivate it.
- The `PROSPKETOR.AI` typo on the Canadian account's statement descriptor is
  now moot; with no subscribers nothing renews against it.
