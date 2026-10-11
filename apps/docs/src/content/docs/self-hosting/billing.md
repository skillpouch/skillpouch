---
title: Billing with Polar
description: Optional paid plans through Polar, how products map to plans, and hidden plans.
---

Billing is optional. Without Polar credentials every billing route answers
[`billing_unavailable`](/errors/billing_unavailable/) and everyone stays on
the Free plan.

## Set up Polar

Start in Polar's sandbox (`POLAR_SERVER=sandbox` in `api.env`). Sandbox and
production are separate environments with their own tokens, webhooks and
products; switch to `POLAR_SERVER=production` for real payments.

1. **Settings → Developers → Access tokens:** create an organization access
   token and save it as `secrets/polar_access_token`.
2. **Settings → Webhooks → Add endpoint:**
   - URL `https://app.skillpouch.net/v1/billing/webhooks/polar`
   - format **Raw**
   - events `subscription.created`, `subscription.updated`,
     `subscription.active`, `subscription.canceled`,
     `subscription.uncanceled`, `subscription.revoked`, `product.created`,
     `product.updated`, `order.paid`, `order.updated`, `order.refunded`

   Save its secret as `secrets/polar_webhook_secret`.

Checkout returns to `WEB_ORIGIN/app/account/billing?ok=1`. That URL is sent
with each checkout; there is nothing to set in Polar.

For local development, use the same webhook path on a tunnel to your
machine (`<tunnel>/v1/billing/webhooks/polar`, see `apps/api/.env.example`).

## How it works

1. `POST /v1/billing/checkout` returns a hosted Polar checkout URL tied to
   the account.
2. Polar calls the webhook. The API verifies the signature and stores each
   event once: duplicates are ignored and older updates never overwrite
   newer ones. Then it recomputes the account's plan limits.
3. A daily job re-reads open subscriptions in case a webhook was missed.

Downgrades never delete data: pouches over the new limit become read-only.

## Products and plans

Each paid plan is one Polar product. Polar handles the price and the
checkout; SkillPouch keeps each plan's limits and the product's ID. The
webhook maps a subscription back to its plan through that ID.

Create every product in both sandbox and production, and tag it the same
way in each.

### Metadata

Set these under **Products → (product) → Metadata**. Keys and values are
case-sensitive.

| Key             | Value                                   | Required       | Meaning                                      |
| --------------- | --------------------------------------- | -------------- | -------------------------------------------- |
| `plan`          | plan slug, e.g. `supporter`             | yes            | Links the product to the plan with this slug |
| `pouch_limit`   | whole number, e.g. `3`                  | for a new plan | Pouches allowed                              |
| `storage_bytes` | whole number, e.g. `1073741824` (1 GiB) | for a new plan | Encrypted storage allowed                    |
| `visible`       | `0` to hide                             | no             | Hidden plans can only be given by an admin   |

Limits in the database win once a plan exists, so editing the metadata
later doesn't quietly change what paying users get.

### What syncs from Polar

SkillPouch reads the tagged products when Polar sends `product.created` or
`product.updated`, when the API starts, every hour, and when a checkout
finds no product for its plan. For each product it:

- links it to the plan with the same slug
- copies the name, description, price and interval; rename a product in
  Polar and the billing page follows within seconds
- creates the plan when the slug is new, using `pouch_limit` and
  `storage_bytes`
- shows or hides the plan according to `visible`

Editing a plan in the admin dashboard pushes its name and price to Polar,
so the two stay the same either way.

### Hidden plans

A plan with `visible` set to `0` isn't listed on the billing page and can't
be bought. An admin gives it to someone with a grant
(`POST /v1/admin/users/:id/grants`). While someone is on a hidden plan,
every other plan is disabled on their billing page and the API refuses
checkouts and plan changes
([`plan_change_unavailable`](/errors/plan_change_unavailable/)).

A hidden plan doesn't need a Polar product: a plan created through the
admin API with `is_public: false` works the same way. The Free plan
(`free`) has no Polar product.

### Adding a plan

1. Create the product in the Polar sandbox with a recurring price.
2. Add the metadata above with a new slug.
3. Create the same product, with the same metadata, in production when
   it's ready.
4. For a look of its own on the billing page, add a style in
   `apps/web/src/features/billing/plan-styles.ts` and
   `apps/web/src/styles/globals.css`. Without one it uses the Supporter
   look.
