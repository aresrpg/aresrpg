import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

import { describe, expect, test } from 'bun:test'
import { createCanvas, loadImage } from '@napi-rs/canvas'

import { color_portrait_pixels, serve_portrait } from '../server/portrait.ts'
import { portrait_url, parse_portrait_query, character_display_image } from '../../immutable/src/portrait.ts'
import manifest from '../../../seed/portraits/manifest.json' with { type: 'json' }

import reviewed from './fixtures/portrait_material_samples.json' with { type: 'json' }
const appearance = { classe: 'senshi', sex: 'male', color_1: 0xffffff, color_2: 0xd9af57, color_3: 0x8b6539 }
const pixels = async (bytes: Uint8Array) => {
  const image = await loadImage(Buffer.from(bytes))
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  return ctx.getImageData(0, 0, image.width, image.height)
}
describe('shared portrait URLs', () => {
  test('palette and revision identify the image, including black and decimal Sui fields', () => {
    const path = portrait_url(appearance)!
    expect(parse_portrait_query(new URL(path, 'https://example.test').searchParams)).toEqual(appearance)
    expect(portrait_url({ ...appearance, color_1: 0 })).not.toBe(path)
    expect(portrait_url({ ...appearance, color_1: 0 })).not.toBeNull()
    expect(portrait_url({ ...appearance, classe: '../../secret' })).toBeNull()
    expect(portrait_url({ ...appearance, color_1: 16777216 })).toBeNull()
    const expanded = character_display_image('https://example.test').replace(
      /\{([^}]+)\}/g,
      (_, key: keyof typeof appearance) => String(appearance[key])
    )
    expect(expanded).toBe(`https://example.test${path}`)
  })
  test('rejects missing colors, invalid revision and fractional values', () => {
    const query = new URL(portrait_url(appearance)!, 'https://example.test').searchParams
    query.delete('color_2')
    expect(parse_portrait_query(query)).toBeNull()
    query.set('color_2', '1.2')
    expect(parse_portrait_query(query)).toBeNull()
    query.set('color_2', '123')
    query.set('revision', 'unknown')
    expect(parse_portrait_query(query)).toBeNull()
  })
})
test('all 24 masks match current source and model hashes, keep alpha and unmasked pixels', async () => {
  expect(Object.keys(manifest.portraits)).toHaveLength(24)
  for (const [name, entry] of Object.entries(manifest.portraits)) {
    const root = new URL('../../../seed/', import.meta.url)
    const source_bytes = await readFile(new URL(`icons/characters/${name}_hd.png`, root))
    const mask_bytes = await readFile(new URL(`portraits/${name}.png`, root))
    const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
    expect(hash(source_bytes)).toBe(entry.source_sha256)
    expect(hash(mask_bytes)).toBe(entry.mask_sha256)
    expect(hash(await readFile(new URL(`models/characters/${name}.glb`, root)))).toBe(entry.model_sha256)
    expect(hash(await readFile(new URL(`models/characters/${name}_hair.glb`, root)))).toBe(entry.hair_sha256)
    const source = await pixels(source_bytes),
      mask = await pixels(mask_bytes)
    expect([source.width, source.height, mask.width, mask.height]).toEqual([1024, 1024, 1024, 1024])
    const colored = color_portrait_pixels(source.data, mask.data, entry.centers, [0xff00ff, 0x00ffff, 0x0066ff])
    const differences = pixel_differences(source.data, colored, mask.data)
    expect({ name, ...differences }).toEqual({
      name,
      alpha_changes: 0,
      outside_changes: 0,
      overlaps: 0,
      changed: differences.changed,
    })
    expect(differences.changed).toBeGreaterThan(1000)
  }
}, 30000)

const pixel_differences = (source: Uint8ClampedArray, colored: Uint8ClampedArray, mask: Uint8ClampedArray) => {
  let changed = 0,
    alpha_changes = 0,
    outside_changes = 0,
    overlaps = 0
  for (let i = 0; i < colored.length; i += 4) {
    if (colored[i + 3] !== source[i + 3]) alpha_changes++
    const active = [mask[i]!, mask[i + 1]!, mask[i + 2]!].filter(Boolean).length
    if (active > 1) overlaps++
    const differs = [0, 1, 2].some((channel) => colored[i + channel] !== source[i + channel])
    if (differs) changed++
    if (differs && !active) outside_changes++
  }
  return { changed, alpha_changes, outside_changes, overlaps }
}
test('HTTP boundary serves transparent PNG with cache validation; rejects bad inputs and writes', async () => {
  const url = `https://example.test${portrait_url(appearance)}`
  expect((await serve_portrait(new Request(url, { method: 'POST' }))).status).toBe(405)
  expect((await serve_portrait(new Request('https://example.test/api/portrait'))).status).toBe(400)
  const response = await serve_portrait(new Request(url))
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('image/png')
  expect(response.headers.get('cache-control')).toContain('immutable')
  const image = await pixels(new Uint8Array(await response.arrayBuffer()))
  expect(image.width).toBe(1024)
  expect(image.data[3]).toBe(0)
  const cached = await serve_portrait(new Request(url, { headers: { 'if-none-match': response.headers.get('etag')! } }))
  expect(cached.status).toBe(304)
  expect((await serve_portrait(new Request(url, { method: 'HEAD' }))).body).toBeNull()
})

test('reviewed face pixels stay fixed while missing hair regions use their model slots', async () => {
  const samples = [
    { name: 'yogan_male', x: 230, y: 275, expected: [0, 0, 0] },
    // The GLB leaves the pale shoulder plate fixed under every color slot.
    { name: 'yogan_male', x: 130, y: 340, expected: [0, 0, 0] },
    { name: 'yogan_male', x: 90, y: 380, expected: [0, 0, 0] },
    { name: 'yogan_male', x: 150, y: 325, expected: [0, 0, 0] },
    { name: 'yogan_female', x: 356, y: 238, expected: [0, 0, 0] },
    { name: 'yajin_female', x: 253, y: 370, expected: [0, 0, 255] },
    { name: 'tomoda_male', x: 147, y: 275, expected: [0, 0, 255] },
    { name: 'tomoda_male', x: 270, y: 350, expected: [0, 0, 0] },
    { name: 'tomoda_male', x: 245, y: 60, expected: [0, 0, 255] },
    { name: 'yajin_female', x: 350, y: 110, expected: [0, 0, 255] },
  ]
  for (const sample of samples) {
    const mask = await pixels(await readFile(new URL(`../../../seed/portraits/${sample.name}.png`, import.meta.url)))
    const offset = (sample.y * 2 * mask.width + sample.x * 2) * 4
    expect({ name: sample.name, channels: Array.from(mask.data.slice(offset, offset + 3)) }).toEqual({
      name: sample.name,
      channels: sample.expected,
    })
  }
})

test('Yogan hair slot stops above the collar and shoulder clothing', async () => {
  const mask = await pixels(await readFile(new URL('../../../seed/portraits/yogan_male.png', import.meta.url)))
  let hair_below_neck = 0
  for (let y = 600; y < mask.height; y++)
    for (let x = 0; x < mask.width; x++) if (mask.data[(y * mask.width + x) * 4 + 1]) hair_below_neck++
  expect(hair_below_neck).toBe(0)
  expect(mask.data[(300 * mask.width + 400) * 4 + 1]).toBe(255)
  for (const [x, y] of [
    [380, 630],
    [700, 630],
  ]) {
    const offset = (y! * mask.width + x!) * 4
    expect(mask.data[offset + 1]).toBe(0)
    expect(mask.data[offset + 2]).toBeGreaterThan(0)
  }
})

test('Senshi female covers hair tips without tinting ear, face or shoulder trim', async () => {
  const mask = await pixels(await readFile(new URL('../../../seed/portraits/senshi_female.png', import.meta.url)))
  for (const [x, y] of [
    [208, 80],
    [280, 215],
    [205, 310],
    [425, 430],
    [385, 255],
  ]) {
    const offset = (y! * 2 * mask.width + x! * 2) * 4
    expect({ x, y, hair: mask.data[offset + 2] }).toEqual({ x, y, hair: 255 })
  }
  for (const [x, y] of [
    [204, 215],
    [222, 235],
    [320, 200],
    [275, 260],
    [270, 305],
    [106, 314],
    [350, 310],
  ]) {
    const offset = (y! * 2 * mask.width + x! * 2) * 4
    expect({ x, y, hair: mask.data[offset + 2] }).toEqual({ x, y, hair: 0 })
  }
})

// Source-preservation and material landmarks reviewed against the 2026-11-08 portrait masters.
test('extended portraits preserve original upper art and anchor every torso at the bottom', async () => {
  for (const [name, expected_hash] of Object.entries(reviewed.original_upper_800_sha256)) {
    const source = await pixels(
      await readFile(new URL(`../../../seed/icons/characters/${name}_hd.png`, import.meta.url))
    )
    const upper_hash = createHash('sha256')
      .update(source.data.subarray(0, 800 * 1024 * 4))
      .digest('hex')
    expect({ name, upper_hash }).toEqual({ name, upper_hash: expected_hash })
    const bottom = source.data.subarray(1023 * 1024 * 4)
    expect({ name, reaches_bottom: Array.from(bottom).some((value, index) => index % 4 === 3 && value > 127) }).toEqual(
      {
        name,
        reaches_bottom: true,
      }
    )
  }
}, 30000)

test('reviewed lower-body material slots and protected skin remain pixel aligned', async () => {
  for (const sample of reviewed.samples) {
    const mask = await pixels(await readFile(new URL(`../../../seed/portraits/${sample.name}.png`, import.meta.url)))
    const offset = (sample.y * mask.width + sample.x) * 4
    const channels = Array.from(mask.data.slice(offset, offset + 3))
    if (sample.slot === 0) expect({ sample, channels }).toEqual({ sample, channels: [0, 0, 0] })
    else {
      expect({ sample, selected: channels[sample.slot - 1]! > 0 }).toEqual({ sample, selected: true })
      expect(channels.every((value, index) => index === sample.slot - 1 || value === 0)).toBeTrue()
    }
  }
}, 30000)

test('reviewed arms continue below shoulder cutoffs without tinting fixed armor or skin', async () => {
  for (const sample of reviewed.arm_landmarks) {
    const source = await pixels(
      await readFile(new URL(`../../../seed/icons/characters/${sample.name}_hd.png`, import.meta.url))
    )
    const mask = await pixels(await readFile(new URL(`../../../seed/portraits/${sample.name}.png`, import.meta.url)))
    const offset = (sample.y * source.width + sample.x) * 4
    expect({ sample, visible: source.data[offset + 3]! > 127 }).toEqual({ sample, visible: true })
    expect(Array.from(mask.data.slice(offset, offset + 3))).toEqual([0, 0, 0])
  }
}, 30000)
