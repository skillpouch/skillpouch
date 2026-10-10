---
title: Conflicts
description: What happens when an item changes in two places at once, and how to pick the version to keep.
---

When the same item changes on two computers (or a computer and the web app)
before they sync, nothing is lost. The server keeps both versions as a
**conflict**, and every computer keeps the version that's in the pouch
until you choose.

You hear about it:

- the background sync shows a desktop notification, once;
- `skillpouch sync` prints the link to the Conflicts page;
- the pouch shows a count on the Pouches page and in its sidebar.

## Resolving

Open the pouch's **Conflicts** page, or run:

```sh
skillpouch conflicts
```

Each conflict shows the two versions side by side:

- **In the pouch**: what every computer has now;
- **From _computer_**: the version changed there at the same time.

Choose **Keep this version** on the one you want. If one side deleted the
item, its button reads **Keep it deleted**. Your computers get the result on
their next sync.

## Two items with the same name

A conflict can also be two different items given the same name, for
example when two computers that already had a skill called `review` were
merged into one pouch. Keeping the new one replaces the other.
