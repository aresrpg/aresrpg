// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFile } from 'node:fs/promises'

import { expect, test } from 'bun:test'

test('sharing metadata is present without JavaScript and agrees across Open Graph and Twitter', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  const tags = [...html.matchAll(/<meta (?:name|property)="([^"]+)" content="([^"]+)"\s*\/>/g)]
  const values = Object.fromEntries(tags.map(([, key, value]) => [key, value]))
  expect(new Set(tags.map(([, key]) => key)).size).toBe(tags.length)
  const [, title] = html.match(/<title>([^<]+)<\/title>/)!
  const [, canonical] = html.match(/<link rel="canonical" href="([^"]+)"/)!
  expect(values['og:title']).toBe(title)
  expect(values['twitter:title']).toBe(title)
  expect(values['og:description']).toBe(values.description)
  expect(values['twitter:description']).toBe(values.description)
  expect(values['og:url']).toBe(canonical)
  expect(canonical).toBe('https://launchpad.aresrpg.world/')
  expect(values['og:type']).toBe('website')
  expect(values['twitter:card']).toBe('summary_large_image')
  expect(values['twitter:image']).toBe(values['og:image'])
  expect(new URL(values['og:image']).protocol).toBe('https:')
  expect(values['og:image:alt']).toBeTruthy()
  expect(values['twitter:image:alt']).toBe(values['og:image:alt'])

  // Reuse the existing canonical brand image instead of introducing another artwork copy.
  const image = await readFile(new URL('../../frontend/public/og-image.png', import.meta.url))
  expect(values['og:image:type']).toBe('image/png')
  expect(Number(values['og:image:width'])).toBe(image.readUInt32BE(16))
  expect(Number(values['og:image:height'])).toBe(image.readUInt32BE(20))
})
