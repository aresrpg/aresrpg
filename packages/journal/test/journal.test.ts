// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { expect, test } from 'bun:test'

import { public_url, init_analytics } from '../src/analytics.ts'
import {
  decode_catalogue,
  published_articles,
  reading_minutes,
  render_feed,
  render_markdown,
  render_sitemap,
  type Article,
} from '../src/content.ts'
import { render_article, render_index, render_not_found } from '../src/pages.tsx'

const published: Article = {
  slug: 'first-story',
  title: 'A world & its rules',
  description: 'A <small> beginning',
  series: 'Foundations',
  chapter: 1,
  status: 'published',
  published_on: '2026-09-19',
  cover: 'first-story.png',
  cover_alt: 'An explorer',
}
const draft: Article = {
  ...published,
  slug: 'unreleased-story',
  title: 'Unreleased material',
  chapter: 2,
  status: 'draft',
  cover: null,
  published_on: null,
}

test('drafts never reach the listing, an article page, RSS or the sitemap', () => {
  const catalogue = decode_catalogue([draft, published])
  const public_articles = published_articles(catalogue).map((article) => {
    const body = render_markdown(`## ${article.title}\n\nReadable prose.`)
    return { ...article, body, minutes: reading_minutes(body) }
  })
  expect(public_articles.map(({ slug }) => slug)).toEqual([published.slug])
  const outputs = [
    render_index(public_articles),
    render_article(public_articles[0]!),
    render_feed(catalogue),
    render_sitemap(catalogue),
    render_not_found(),
  ]
  for (const output of outputs) {
    expect(output).not.toContain(draft.slug)
    expect(output).not.toContain(draft.title)
  }
  expect(outputs[1]).toContain('https://journal.aresrpg.world/articles/first-story')
  expect(render_feed(catalogue)).toContain('A world &amp; its rules')
  expect(render_feed(catalogue)).toContain('A &lt;small&gt; beginning')
  expect(decode_catalogue([draft])).toEqual([draft])
})

test('the catalogue refuses unsafe slugs, incomplete public records and duplicate identities', () => {
  for (const slug of ['../escape', 'an/article', 'Mixed-Case', ''])
    expect(() => decode_catalogue([{ ...published, slug }])).toThrow()
  for (const change of [
    { status: 'hidden' },
    { status: ['published'] },
    { cover: '../private.png' },
    { cover: null },
    { cover_alt: '' },
    { published_on: '2026-02-30' },
    { published_on: 'not-a-date' },
    { published_on: null },
    { title: '' },
    { chapter: 0 },
  ])
    expect(() => decode_catalogue([{ ...published, ...change }])).toThrow()
  expect(() => decode_catalogue([published, published])).toThrow('Duplicate journal slug')
  expect(() => decode_catalogue([published, { ...draft, chapter: 1 }])).toThrow('Duplicate journal chapter')
  expect(() => decode_catalogue({})).toThrow()
  expect(() => decode_catalogue([null])).toThrow()
})

test('analytics strips query and fragment data and stays off preview hosts', () => {
  expect(public_url('https://journal.aresrpg.world/article?secret=value#token')).toBe(
    'https://journal.aresrpg.world/article'
  )
  expect(() => init_analytics('localhost')).not.toThrow()
})

test('a rebuild publishes only published documents and their artwork', async () => {
  const package_dir = resolve(import.meta.dirname, '..')
  const output_dir = resolve(package_dir, 'dist')
  const catalogue = decode_catalogue(JSON.parse(await readFile(resolve(package_dir, 'content/articles.json'), 'utf8')))
  const live = catalogue.filter(({ status }) => status === 'published')
  const stale = resolve(output_dir, 'articles/previous-draft.html')
  await Bun.write(stale, 'PRIVATE_DRAFT_SENTINEL')
  const build = Bun.spawn(['bun', 'scripts/build.ts'], { cwd: package_dir, stdout: 'pipe', stderr: 'pipe' })
  const [exit_code, errors] = await Promise.all([build.exited, new Response(build.stderr).text()])
  expect(errors).toBe('')
  expect(exit_code).toBe(0)
  expect(await Bun.file(stale).exists()).toBe(false)
  const pages = await readdir(resolve(output_dir, 'articles'))
  const images = await readdir(resolve(output_dir, 'assets'))
  expect(pages.toSorted()).toEqual(live.map(({ slug }) => `${slug}.html`).toSorted())
  expect(images.filter((name) => /\.(png|webp)$/u.test(name)).toSorted()).toEqual(
    ['journal-og-v2.png', ...live.map(({ cover }) => cover!)].toSorted()
  )
  const public_files = await Promise.all(
    ['index.html', 'feed.xml', 'sitemap.xml'].map((name) => readFile(resolve(output_dir, name), 'utf8'))
  )
  for (const article of catalogue.filter(({ status }) => status !== 'published'))
    for (const output of public_files) expect(output).not.toContain(article.slug)
}, 30_000)
