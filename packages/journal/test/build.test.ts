// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { expect, test } from 'bun:test'

import { decode_catalogue } from '../src/content.ts'

test('production output contains only published documents and artwork, including after a rebuild', async () => {
  const package_dir = resolve(import.meta.dirname, '..')
  const output_dir = resolve(package_dir, 'dist')
  const catalogue = decode_catalogue(
    JSON.parse(await readFile(resolve(package_dir, '../../seed/content/journal/articles.json'), 'utf8'))
  )
  const stale = resolve(output_dir, 'articles/previous-draft.html')
  await Bun.write(stale, 'PRIVATE_DRAFT_SENTINEL')
  const process = Bun.spawn(['bun', 'scripts/build.ts'], { cwd: package_dir, stdout: 'pipe', stderr: 'pipe' })
  const [exit_code, errors] = await Promise.all([process.exited, new Response(process.stderr).text()])
  expect(errors).toBe('')
  expect(exit_code).toBe(0)
  expect(await Bun.file(stale).exists()).toBe(false)
  const pages = await readdir(resolve(output_dir, 'articles'))
  const images = await readdir(resolve(output_dir, 'assets'))
  expect(images.filter((name) => /\.(png|webp)$/u.test(name)).sort()).toEqual(
    ['journal-og-v2.png', ...catalogue.filter(({ status }) => status === 'published').map(({ cover }) => cover!)].sort()
  )
  const public_files = await Promise.all(
    ['index.html', 'feed.xml', 'sitemap.xml'].map((name) => readFile(resolve(output_dir, name), 'utf8'))
  )
  for (const article of catalogue) {
    const markdown = await readFile(resolve(package_dir, '../../seed/content/journal', `${article.slug}.md`), 'utf8')
    if (article.status === 'published') {
      expect(markdown.trim().length).toBeGreaterThan(0)
      expect(pages).toContain(`${article.slug}.html`)
      expect(images).toContain(article.cover!)
    } else {
      expect(pages).not.toContain(`${article.slug}.html`)
      for (const output of public_files) expect(output).not.toContain(article.slug)
    }
  }
  expect(pages.length).toBe(catalogue.filter(({ status }) => status === 'published').length)
}, 30_000)
