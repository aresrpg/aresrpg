// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { marked } from 'marked'

export type Article = Readonly<{
  slug: string
  title: string
  description: string
  series: string
  chapter: number
  status: 'draft' | 'published'
  published_on: string | null
  cover: string | null
  cover_alt: string
}>

export type PublishedArticle = Article & Readonly<{ body: string; minutes: number }>

export const SITE_URL = 'https://journal.aresrpg.world'
export const SITE_COVER = 'journal-og-v2.png'
export const article_path = (article: Readonly<Pick<Article, 'slug'>>) => `/articles/${article.slug}`
export const article_url = (article: Readonly<Pick<Article, 'slug'>>) => `${SITE_URL}${article_path(article)}`
export const cover_path = (article: Article) => `/assets/${article.cover}`
export const reading_minutes = (markdown: string) => Math.max(1, Math.ceil(markdown.split(/\s+/u).length / 220))

const valid_slug = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const valid_date = (value: unknown) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value

const valid_cover = (value: unknown) => typeof value === 'string' && /^[a-z0-9-]+\.(png|webp)$/u.test(value)

const validate_article = (value: unknown): Article => {
  if (!value || typeof value !== 'object') throw new Error('Journal article must be an object')
  const row = value as Record<string, unknown>
  const checks = {
    slug: valid_slug(row.slug),
    metadata: ['title', 'description', 'series'].every((key) => nonempty(row[key])),
    chapter: Number.isInteger(row.chapter) && Number(row.chapter) > 0,
    status: typeof row.status === 'string' && ['draft', 'published'].includes(row.status),
    cover: row.cover === null || valid_cover(row.cover),
    publication:
      row.status === 'draft' ||
      [valid_date(row.published_on), nonempty(row.cover), nonempty(row.cover_alt)].every(Boolean),
  }
  const invalid = Object.entries(checks).find(([, valid]) => !valid)
  if (invalid) throw new Error(`Invalid journal ${invalid[0]}: ${row.slug}`)
  return row as Article
}

export const decode_catalogue = (value: unknown): readonly Article[] => {
  if (!Array.isArray(value)) throw new Error('Journal catalogue must be an array')
  const articles = value.map(validate_article)
  if (new Set(articles.map(({ slug }) => slug)).size !== articles.length) throw new Error('Duplicate journal slug')
  if (new Set(articles.map(({ chapter }) => chapter)).size !== articles.length)
    throw new Error('Duplicate journal chapter')
  return articles
}

export const published_articles = (articles: readonly Article[]) =>
  articles.filter(({ status }) => status === 'published').toSorted((a, b) => a.chapter - b.chapter)

export const render_markdown = (markdown: string) => marked.parse(markdown, { async: false, gfm: true })

export const escape_xml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

export const render_feed = (articles: readonly Article[]) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>AresRPG Journal</title><link>${SITE_URL}</link>
<description>Building an onchain world, one understandable idea at a time.</description><language>en</language>
${published_articles(articles)
  .map(
    (article) =>
      `<item><title>${escape_xml(article.title)}</title><link>${article_url(article)}</link><guid>${article_url(article)}</guid><description>${escape_xml(article.description)}</description><pubDate>${new Date(article.published_on!).toUTCString()}</pubDate></item>`
  )
  .join('\n')}
</channel></rss>`

export const render_sitemap = (articles: readonly Article[]) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE_URL}/</loc></url>
${published_articles(articles)
  .map((article) => `<url><loc>${article_url(article)}</loc><lastmod>${article.published_on}</lastmod></url>`)
  .join('\n')}
</urlset>`
