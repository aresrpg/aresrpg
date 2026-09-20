// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  decode_catalogue,
  published_articles,
  reading_minutes,
  render_feed,
  render_markdown,
  render_sitemap,
  SITE_URL,
  SITE_COVER,
} from '../src/content.ts'
import { render_article, render_index, render_not_found } from '../src/pages.tsx'

const package_dir = resolve(import.meta.dirname, '..')
const content_dir = resolve(package_dir, '../../seed/content/journal')
const image_dir = resolve(package_dir, '../../seed/icons/journal')
const output_dir = resolve(package_dir, 'dist')
const catalogue = decode_catalogue(JSON.parse(await readFile(resolve(content_dir, 'articles.json'), 'utf8')))
const published = published_articles(catalogue)
const articles = await Promise.all(
  published.map(async (article) => {
    const markdown = await readFile(resolve(content_dir, `${article.slug}.md`), 'utf8')
    return { ...article, body: render_markdown(markdown), minutes: reading_minutes(markdown) }
  })
)

await rm(output_dir, { recursive: true, force: true })
await mkdir(resolve(output_dir, 'articles'), { recursive: true })
await cp(resolve(package_dir, 'public'), output_dir, { recursive: true })
await mkdir(resolve(output_dir, 'assets'), { recursive: true })
await cp(resolve(image_dir, SITE_COVER), resolve(output_dir, 'assets', SITE_COVER))
await cp(resolve(image_dir, 'helmet-favicon.png'), resolve(output_dir, 'favicon.png'))
await cp(resolve(package_dir, 'src/journal.css'), resolve(output_dir, 'assets/journal.css'))
await Promise.all(
  articles.map(async (article, index) => {
    await writeFile(resolve(output_dir, `articles/${article.slug}.html`), render_article(article, articles[index + 1]))
    await cp(resolve(image_dir, article.cover!), resolve(output_dir, 'assets', article.cover!))
  })
)
await Promise.all([
  writeFile(resolve(output_dir, 'index.html'), render_index(articles)),
  writeFile(resolve(output_dir, '404.html'), render_not_found()),
  writeFile(resolve(output_dir, 'feed.xml'), render_feed(catalogue)),
  writeFile(resolve(output_dir, 'sitemap.xml'), render_sitemap(catalogue)),
  writeFile(resolve(output_dir, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`),
])
const result = await Bun.build({
  entrypoints: [resolve(package_dir, 'src/main.ts')],
  outdir: resolve(output_dir, 'assets'),
  naming: 'analytics.js',
  target: 'browser',
  minify: true,
})
if (!result.success) throw new AggregateError(result.logs, 'Journal analytics build failed')
console.log(`Journal: ${articles.length} published; ${catalogue.length - articles.length} drafts excluded.`)
