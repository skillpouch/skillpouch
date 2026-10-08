# Polar products

Each paid plan is one Polar product. Polar handles the price and the checkout;
SkillPouch keeps each plan's limits and the product's ID in its `plans` table.
The webhook maps a subscription back to a plan through that product ID.

Sandbox and production are separate Polar environments with separate product
IDs. Create every product in both and tag it the same way in each.

## Metadata

Set these under **Products → (product) → Metadata**. Keys and values are
case-sensitive.

| Key             | Value                                   | Required | Meaning                                         |
| --------------- | --------------------------------------- | -------- | ----------------------------------------------- |
| `plan`          | plan slug, e.g. `supporter`             | yes      | Links the product to the plan with this slug.   |
| `pouch_limit`   | whole number, e.g. `3`                  | no       | Pouches allowed; used when the plan is created. |
| `storage_bytes` | whole number, e.g. `1073741824` (1 GiB) | no       | Encrypted storage allowed; used when created.   |
| `visible`       | `0` to hide                             | no       | Hidden plans are only given by an admin.        |

Limits in the database win once a plan exists, so editing metadata later
doesn't silently change what paying users get.

## What syncs from Polar

SkillPouch reads the tagged products when the API starts, every hour, and
when a checkout finds no product for its plan. For each one it:

- links the product to the plan with the same slug;
- copies the **name**, **description**, price and interval. The site always
  shows the name from Polar: rename a product there and the plan, the
  billing page and the badge follow within the hour (restart the API to
  apply it now);
- creates the plan when the slug is new, with the `pouch_limit` and
  `storage_bytes` metadata (both required for a new plan);
- shows or hides the plan from `visible`.

## Hidden plans

With `visible` set to `0`, a plan isn't listed on the billing page and can't be
bought. An admin gives it to someone with a grant
(`POST /v1/admin/users/:id/grants`).
While someone is on a hidden plan, every other plan is disabled on their
billing page and the API refuses checkouts and plan changes
(`plan_change_unavailable`, reason `granted_plan`). A hidden plan doesn't need
a Polar product at all: a plan created through the admin API with
`is_public: false` works the same way.

Editing a plan in the admin dashboard pushes the name and price to Polar, so
the two stay the same either way.

## Products

| Product    | Price         | `plan`           | `pouch_limit` | `storage_bytes` |
| ---------- | ------------- | ---------------- | ------------- | --------------- |
| Supporter  | $5.00 / month | `supporter`      | `3`           | `1073741824`    |
| Supporter+ | your price    | `supporter-plus` | your limit    | your limit      |

The Friends Pass (`friends-pass`) is a hidden plan with its own look and
thank-you line.

The Free plan (`free`) has no Polar product.

## Adding a plan later

1. Create the product in Polar (sandbox first) with a recurring price.
2. Add the metadata above with a new slug.
3. Add the same product, with the same metadata, in production when it's ready.
4. For a look of its own, add a style in
   `apps/web/src/features/billing/plan-styles.ts` and `styles/globals.css`.
   Without one, it uses the Supporter look.
