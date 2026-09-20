# AresRPG Journal

Static publication at https://journal.aresrpg.world. No wallet, database, or game runtime is required.

```bash
bun run dev:journal
bun run build:journal
bun run --cwd packages/journal typecheck
bun run --cwd packages/journal test
```

The local server uses http://127.0.0.1:4175. Rebuild after editing content.

## Writing and publication

Write Markdown under `seed/content/journal/`. `articles.json` owns titles, descriptions, chapter order,
publication status, dates, and cover references. Put original cover artwork in `seed/icons/journal/`.
Editorial prose is English; it is separate from the game's localized interface catalogue.
Unwritten drafts may retain an empty Markdown file; their titles remain in the catalogue.

Article titles name their subject and mechanism directly, for example “Building open worlds on Sui:
Proof of Discovery.” Keep the prose intuitive and example-led, but avoid metaphor-only headlines
that hide what the reader will learn. Teasers raise the central question rather than narrate an
incidental example. Define the concept and establish the problem before using concrete examples;
the cover must communicate that same central theme. Preserve published slugs when refining a title.

The build publishes only rows explicitly marked `published`. A published row must have a valid date,
cover, and alternative text. Draft routes, feed entries, metadata, and artwork are excluded from
the output. The source repository still contains drafts; this is a publication boundary, not a
confidential document store. Authored Markdown is trusted publisher input and can contain HTML.

Before publishing a draft, review its prose and technical sources, add its own pixel-art cover,
complete any promised examples or measurements, and change its status and date. Run the package
checks and inspect the generated page. No publication happens merely because a future date passes.

The initial article's code links are pinned to the inspected repository revision. Update them only
after checking the claims against the new implementation. Never invent benchmark data for a draft.

Premortem: this fails if an unpublished chapter leaks into an output surface. The build regression
checks routes, catalogue, RSS, sitemap, assets, and removal of stale generated pages.

## Deployment

The independent Vercel project is `journal` in the `aresrpg` team. Its root is `packages/journal`;
the build reads canonical content above that root. `vercel.json` declares the static build, clean
URLs and security headers. Git-triggered deployment is disabled. No game release or content
transaction is needed to publish this separate site. Deployment still requires owner authorization.

For a local prebuilt deployment, build with `vercel build --prod --cwd packages/journal` after linking
that package to the journal project. The deployment command must run from a monorepo-shaped root:
Vercel resolves the project's `packages/journal` root relative to its working directory. Stage the
verified `.vercel/output` and journal project link in a temporary root with an empty `packages/journal`
directory, then deploy that root with `vercel deploy --prebuilt --prod --cwd <temporary-root>`.
Keep the game's existing root project link untouched. The staged artifact contains public output only.

Vercel Web Analytics must be enabled on the project. The browser entry initializes it only on
`journal.aresrpg.world` and removes URL queries and fragments before sending. Local and preview
hosts do not send analytics. The reader receives complete HTML without client-side React.

Fonts are served locally. JetBrains Mono's license accompanies the font in `public/assets/`.
