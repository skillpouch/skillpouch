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

Limits in the database win once a plan exists, so editing metadata later
doesn't silently change what paying users get.

## Products

| Product   | Price         | `plan`      | `pouch_limit` | `storage_bytes` |
| --------- | ------------- | ----------- | ------------- | --------------- |
| Supporter | $5.00 / month | `supporter` | `3`           | `1073741824`    |

Keep the Polar price equal to `price_cents` in the plan: checkout charges
Polar's price, the site shows the database price.

The Free plan (`free`) has no Polar product.

## Adding a plan later

1. Create the product in Polar (sandbox first) with a recurring price.
2. Add the metadata above with a new slug.
3. Add the same product, with the same metadata, in production when it's ready.

## Linking today

Automatic linking by the `plan` key isn't built yet. Until it is, copy the
product's ID from Polar and set it on the plan by hand, once per environment:

```sh
# local dev
docker exec skillpouch-dev-postgres-1 psql -U postgres -d skillpouch -c \
  "update plans set polar_product_id = '<product id>' where slug = 'supporter'"

# server (from deploy/)
docker compose -f compose.yaml -f tunnel/compose.tunnel.yaml --env-file env/stack.env \
  exec postgres psql -U postgres -d skillpouch -c \
  "update plans set polar_product_id = '<product id>' where slug = 'supporter'"
```

Without a product ID, "Become a supporter" answers `404 not_found`.
