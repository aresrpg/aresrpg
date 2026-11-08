// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { expect, test } from 'bun:test'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { renderToStaticMarkup } from 'react-dom/server'
import { parse as parse_yaml } from 'yaml'

import { portrait_url } from '../../../immutable/src/portrait.ts'
import { render_portrait, serve_portrait } from '../../server/portrait.ts'
import { PortraitStyleControls } from '../../src/components/PortraitShare.tsx'
import {
  PORTRAIT_BACKGROUNDS,
  PORTRAIT_EXPORT_REVISION,
  TRANSPARENT_PORTRAIT,
  initial_portrait_share,
  parse_portrait_style,
  portrait_export_filename,
  portrait_export_url,
  reduce_portrait_share,
} from '../../src/components/portrait_share.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'
import art from '../../public/portrait-share/manifest.json' with { type: 'json' }
import vercel from '../../vercel.json' with { type: 'json' }

const appearance = { classe: 'senshi', sex: 'male', color_1: 0xffffff, color_2: 0xd9af57, color_3: 0x8b6539 }
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const query_for = (path: string) => new URL(path, 'https://example.test').searchParams
const pixels = async (bytes: Uint8Array) => {
  const image = await loadImage(Buffer.from(bytes))
  const ctx = createCanvas(image.width, image.height).getContext('2d')
  ctx.drawImage(image, 0, 0)
  return ctx.getImageData(0, 0, image.width, image.height)
}

test('transparent export preserves the default URL and exact PNG bytes', async () => {
  expect(portrait_export_url(appearance, TRANSPARENT_PORTRAIT)).toBe(portrait_url(appearance))
  expect(parse_portrait_style(query_for(portrait_url(appearance)!))).toEqual(TRANSPARENT_PORTRAIT)
  // Reviewed extended torso and pixel-aligned masks, art revision c17634d91733b72d (2026-11-08).
  expect(hash(await render_portrait(appearance))).toBe(
    '950ecbd60f02bc5637b482214ecd83deac9073a253e0b34bc558913dd319e82e'
  )
  expect(await render_portrait(appearance, TRANSPARENT_PORTRAIT)).toEqual(await render_portrait(appearance))
  expect(portrait_export_filename(appearance, TRANSPARENT_PORTRAIT)).toBe('senshi_male.png')
})

test('all eight reviewed assets pin immutable export identity and leave foreground framing intact', async () => {
  expect(PORTRAIT_BACKGROUNDS).toEqual(['fire', 'water', 'wind', 'marble', 'shadow', 'sand', 'cobblestone', 'milk'])
  expect(PORTRAIT_EXPORT_REVISION).toBe(
    hash(JSON.stringify({ composition: art.composition, backgrounds: art.backgrounds })).slice(0, 16)
  )
  const foreground = await pixels(await render_portrait(appearance))
  for (const background of PORTRAIT_BACKGROUNDS) {
    const bytes = await readFile(new URL(`../../public/portrait-share/backgrounds/${background}.png`, import.meta.url))
    const thumb = await readFile(new URL(`../../public/portrait-share/thumbs/${background}.png`, import.meta.url))
    expect(hash(bytes)).toBe(art.backgrounds[background].sha256)
    expect(hash(thumb)).toBe(art.backgrounds[background].thumbnail_sha256)
    const source = await pixels(bytes)
    const thumbnail = await pixels(thumb)
    expect([source.width, source.height, thumbnail.width, thumbnail.height]).toEqual([1024, 1024, 128, 128])
    const style = { background }
    const url = `https://example.test${portrait_export_url(appearance, style)}`
    expect(parse_portrait_style(new URL(url).searchParams)).toEqual(style)
    expect(portrait_export_filename(appearance, style)).toBe(`senshi_male_${background}.png`)
    const response = await serve_portrait(new Request(url))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('immutable')
    const output = await pixels(new Uint8Array(await response.arrayBuffer()))
    let changed_foreground = 0
    let transparent_pixels = 0
    for (let offset = 0; offset < output.data.length; offset += 4) {
      if (output.data[offset + 3] !== 255) transparent_pixels++
      if (
        foreground.data[offset + 3] === 255 &&
        [0, 1, 2].some((channel) => output.data[offset + channel] !== foreground.data[offset + channel])
      )
        changed_foreground++
    }
    expect({ background, changed_foreground, transparent_pixels }).toEqual({
      background,
      changed_foreground: 0,
      transparent_pixels: 0,
    })
    expect(Array.from(output.data.slice(0, 4))).toEqual(Array.from(source.data.slice(0, 4)))
    expect(
      (await serve_portrait(new Request(url, { headers: { 'if-none-match': response.headers.get('etag')! } }))).status
    ).toBe(304)
  }
}, 30000)

test('invalid, stale, duplicate and unsupported export options fail without caching', async () => {
  const base = portrait_url(appearance)!
  for (const suffix of [
    '&bg=fire',
    '&bg=../secret&export_revision=' + PORTRAIT_EXPORT_REVISION,
    '&bg=fire&export_revision=stale',
    '&ornament=sigil-ring',
    '&bg=fire&bg=milk&export_revision=' + PORTRAIT_EXPORT_REVISION,
    '&export_revision=' + PORTRAIT_EXPORT_REVISION,
    '&bg=&export_revision=' + PORTRAIT_EXPORT_REVISION,
  ]) {
    const response = await serve_portrait(new Request(`https://example.test${base}${suffix}`))
    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
  }
})

test('style changes reset readiness and reject stale image and clipboard completions, including return visits', () => {
  const loaded = reduce_portrait_share(initial_portrait_share, { type: 'loaded', generation: 0 })
  const copied = reduce_portrait_share(loaded, { type: 'copied', generation: 0 })
  const fire = reduce_portrait_share(copied, { type: 'style', style: { background: 'fire' } })
  expect(fire).toEqual({ background: 'fire', generation: 1, loaded: false, status: 'ready' })
  for (const type of ['loaded', 'image_failed', 'copied', 'copy_failed'] as const)
    expect(reduce_portrait_share(fire, { type, generation: 0 })).toBe(fire)
  expect(reduce_portrait_share(fire, { type: 'style', style: { background: 'fire' } })).toBe(fire)
  const restored = reduce_portrait_share(fire, { type: 'style', style: TRANSPARENT_PORTRAIT })
  expect(restored.generation).toBe(2)
  expect(restored.loaded).toBeFalse()
  expect(reduce_portrait_share(restored, { type: 'copied', generation: 0 })).toBe(restored)
  expect(reduce_portrait_share(restored, { type: 'image_failed', generation: 2 }).status).toBe('failed')
  expect(reduce_portrait_share(restored, { type: 'copy_failed', generation: 2 }).status).toBe('failed')
})

test('every locale exposes the eight accessible swatches plus default transparency', async () => {
  for (const { code: locale } of LOCALES) {
    const localized = parse_yaml(
      await readFile(new URL(`../../src/i18n/locales/${locale}.yaml`, import.meta.url), 'utf8')
    ) as { ui: Record<string, string> }
    for (const key of [
      'portrait_backdrop',
      'portrait_transparent',
      ...PORTRAIT_BACKGROUNDS.map((background) => `portrait_background_${background}`),
    ])
      expect({
        locale,
        key,
        present:
          Object.hasOwn(localized.ui, key) && typeof localized.ui[key] === 'string' && localized.ui[key]!.length > 0,
      }).toEqual({
        locale,
        key,
        present: true,
      })
    const copy = await load_app_copy(locale)
    const markup = renderToStaticMarkup(
      <PortraitStyleControls style={TRANSPARENT_PORTRAIT} copy={copy} choose={() => undefined} />
    )
    expect(markup.match(/type="radio"/g)).toHaveLength(9)
    expect(markup).toContain('value="transparent"')
    expect(markup.match(/checked=""/g)).toHaveLength(1)
    for (const background of PORTRAIT_BACKGROUNDS) {
      expect(copy.ui[`portrait_background_${background}`]).toBeTruthy()
      expect(markup).toContain(copy.ui[`portrait_background_${background}`]!)
    }
    expect(markup).not.toContain('sigil')
  }
})

test('production serves public thumbnails and bundles backgrounds for the image function', () => {
  const fallback = vercel.rewrites.find((row) => row.destination === '/index.html')!
  expect(new RegExp(`^${fallback.source}$`).test('/portrait-share/thumbs/milk.png')).toBeFalse()
  expect(vercel.functions['api/portrait.ts'].includeFiles).toContain('public/portrait-share/backgrounds/*.png')
})
