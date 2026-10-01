// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFile } from 'node:fs/promises'

import { expect, test } from 'bun:test'

const jpeg_size = (image: Buffer): readonly [number, number] => {
  expect(image.readUInt16BE(0)).toBe(0xffd8)
  for (let offset = 2; offset < image.length; offset += image.readUInt16BE(offset + 2) + 2) {
    const marker = image.readUInt16BE(offset)
    if (marker === 0xffc0 || marker === 0xffc2) return [image.readUInt16BE(offset + 7), image.readUInt16BE(offset + 5)]
  }
  throw new Error('JPEG frame dimensions are missing')
}

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
  const image_url = new URL(values['og:image'])
  expect(image_url.protocol).toBe('https:')
  expect(image_url.origin).toBe(new URL(canonical).origin)
  expect(image_url.pathname).toBe('/assets/kares-launchpad.jpg')
  expect(values['og:image:alt']).toBeTruthy()
  expect(values['twitter:image:alt']).toBe(values['og:image:alt'])

  // The public asset links to the seed-owned offering artwork and bypasses the SPA rewrite.
  const image = await readFile(new URL(`../public${image_url.pathname}`, import.meta.url))
  const [width, height] = jpeg_size(image)
  expect(values['og:image:type']).toBe('image/jpeg')
  expect(Number(values['og:image:width'])).toBe(width)
  expect(Number(values['og:image:height'])).toBe(height)
})
