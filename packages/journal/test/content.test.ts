// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import {
  decode_catalogue,
  published_articles,
  render_feed,
  render_markdown,
  render_sitemap,
  reading_minutes,
  type Article,
} from '../src/content.ts'
import { public_url, init_analytics } from '../src/analytics.ts'
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

describe('editorial publication boundary', () => {
  test('drafts never enter listing, RSS or sitemap', () => {
    const catalogue = decode_catalogue([draft, published])
    const public_articles = published_articles(catalogue)
    expect(public_articles).toEqual([published])
    const index = render_index(public_articles.map((article) => ({ ...article, body: '', minutes: 3 })))
    expect(index).toContain('https://journal.aresrpg.world/assets/journal-og-v2.png')
    expect(index).toContain('href="/favicon.png"')
    for (const output of [index, render_feed(catalogue), render_sitemap(catalogue)]) {
      expect(output).not.toContain(draft.slug)
      expect(output).not.toContain(draft.title)
      expect(output).toContain(published.slug)
    }
    expect(render_feed(catalogue)).toContain('A world &amp; its rules')
    expect(render_feed(catalogue)).toContain('A &lt;small&gt; beginning')
  })

  test.each(['../escape', 'an/article', 'Mixed-Case', ''])(
    'refuses unsafe slug %s before output paths are composed',
    (slug) => {
      expect(() => decode_catalogue([{ ...published, slug }])).toThrow()
    }
  )

  test.each([
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
  ])('refuses an incomplete public record %j', (change) => {
    expect(() => decode_catalogue([{ ...published, ...change }])).toThrow()
  })

  test('refuses duplicate identities and chapters', () => {
    expect(() => decode_catalogue([published, published])).toThrow('Duplicate journal slug')
    expect(() => decode_catalogue([published, { ...draft, chapter: 1 }])).toThrow('Duplicate journal chapter')
    expect(() => decode_catalogue({})).toThrow()
    expect(() => decode_catalogue([null])).toThrow()
  })

  test('drafts may be written before artwork or publication date exists', () => {
    expect(decode_catalogue([draft])).toEqual([draft])
    expect(published_articles([draft])).toEqual([])
  })
})

test('article HTML is readable without JavaScript and has its own canonical and sharing metadata', () => {
  const body = render_markdown(
    '## A small beginning\n\nReadable prose.\n\n| Rule | Result |\n| --- | --- |\n| Key | Entry |\n\n```move\nassert!(allowed);\n```'
  )
  const article = { ...published, body, minutes: reading_minutes(body) }
  const html = render_article(article)
  expect(html).toContain('<h2>A small beginning</h2>')
  expect(html).toContain('<table>')
  expect(html).toContain('language-move')
  expect(html).toContain('https://journal.aresrpg.world/articles/first-story')
  expect(html).toContain('https://journal.aresrpg.world/assets/first-story.png')
  expect(html).not.toContain('journal-og-v2.png')
  expect(html).toContain('property="og:type" content="article"')
  expect(html).not.toContain('Unreleased material')
  expect(render_article(article, { ...article, slug: 'next-story' })).toContain('/articles/next-story')
  expect(render_not_found()).toContain('Browse the journal')
  expect(reading_minutes('')).toBe(1)
})

test('analytics removes query and fragment data and does not initialize on a preview host', () => {
  expect(public_url('https://journal.aresrpg.world/article?secret=value#token')).toBe(
    'https://journal.aresrpg.world/article'
  )
  expect(() => init_analytics('localhost')).not.toThrow()
})
