---
title: Search and AI discoverability
description: How skillpouch.net and these docs are set up for search engines and AI tools - crawler policy, sitemaps, structured data, llms.txt, IndexNow - and the checks that keep them right.
---

The landing site (`apps/site`) and these docs (`apps/docs`) are static
HTML, so every page is readable without JavaScript. This page records the
choices behind what crawlers see, so they aren't undone by accident.

## Crawler policy

Both hosts serve the same `robots.txt` policy, in three named groups:

| Group                   | User agents                                                                               | Rule    |
| ----------------------- | ----------------------------------------------------------------------------------------- | ------- |
| Search crawlers         | Googlebot, Bingbot, DuckDuckBot, Applebot, OAI-SearchBot, Claude-SearchBot, PerplexityBot | Allowed |
| User-triggered fetchers | ChatGPT-User, Claude-User, Perplexity-User                                                | Allowed |
| Training and AI use     | GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot                              | Allowed |

Search crawlers decide whether pages appear in search results and in AI
search answers (ChatGPT search, Claude, Perplexity). User-triggered fetchers
open a page because a person asked an assistant to; their operators say
they may not follow `robots.txt`. Training crawlers are allowed on purpose:
the content is public product documentation under the AGPL, and models that
learned it describe SkillPouch correctly. Allowing them doesn't make a page
rank in AI search; that depends on the search crawlers.

A crawler that matches a named group ignores the `*` group, so every group
has its own `Allow: /`. To opt out of training later, change only the third
group to `Disallow: /`.

The web app at `app.skillpouch.net` is behind sign-in and disallows every
crawler, except `/v1/plans`, the public price list that `llms.txt` links to.
`robots.txt` is a request, not access control: private routes are protected
by authentication, never by being left out of `robots.txt`.

Cloudflare settings (Bot Fight Mode, "Block AI bots", AI Crawl Control) can
block these crawlers before `robots.txt` matters. Keep them off or set to
allow on the site and docs zones, and check the crawler logs in the
Cloudflare dashboard after any change.

## Pages, canonicals and sitemaps

- Site pages are folders, served at a URL with a trailing slash
  (`/faq/`); `trailingSlash: 'always'` keeps links and canonicals the same.
- The site's sitemap is generated from `src/lib/pages.ts`. A test fails if
  a page in `src/pages` is missing from it. `<lastmod>` is the date of the
  last commit touching the page's sources, left out in a shallow clone.
- The docs sitemap comes from `@astrojs/sitemap`, without the generated
  API endpoint pages, which are also `noindex`.
- `404.astro` makes Cloudflare Pages answer unknown site paths with a real
  404 instead of the home page.
- `apps/site/public/_redirects` sends `skillpouch.net/docs/*` to this host.

## Structured data

JSON-LD must describe what the page shows.

- Home: `Organization`, `WebSite`, `SoftwareApplication` (with one `Offer`
  per public plan, read from the API at build time) and `WebPage`.
- About, Compare, FAQ, Terms, Privacy: `WebPage` (or `AboutPage`,
  `FAQPage`) and `BreadcrumbList`. The FAQ's markup is built from the same
  list as its visible questions.
- Every docs guide: `TechArticle` and a `BreadcrumbList` built from the
  sidebar (`src/route-data.ts`). The splash home page has none.

## llms.txt

`skillpouch.net/llms.txt` is built from the landing page's own copy;
`docs.skillpouch.net/llms.txt`, `llms-full.txt` and `llms-small.txt` come
from `starlight-llms-txt`. They are a convenience for tools that look for
them. No search engine or model provider is known to require them, and
they don't replace HTML pages or sitemaps.

## IndexNow

After a deploy from `main`, the site and docs workflows send changed URLs
to IndexNow (`apps/site/scripts/indexnow.mjs`), which shares them with
Bing, Yandex and other participating engines. Google doesn't take part;
it finds changes through the sitemap. The key is public by design and is
served at `/5bea17cecf5d7e2ab4dfcfe8940eae0a.txt` on both hosts. A failed
submission is logged and never fails the deploy.

## Checks

- `pnpm --filter @skillpouch/site test` covers the sitemap list,
  `robots.txt`, redirects, the IndexNow key, structured data and the
  rendered content pages.
- `pnpm --filter @skillpouch/docs test` covers breadcrumbs and guide
  structured data.
- After each build, CI runs `apps/site/scripts/check-dist.mjs` on both
  outputs. It reads every page the way a crawler does: title, description,
  `lang`, one canonical pointing at itself, JSON-LD that parses, no
  duplicate titles, internal links that resolve, a sitemap that lists
  exactly the indexable pages, and a `robots.txt` that names the sitemap and
  doesn't block the whole site.
