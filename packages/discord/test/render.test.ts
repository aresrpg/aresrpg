import { expect, test } from 'bun:test'
import { loadImage } from '@napi-rs/canvas'

import { announcement } from '../src/model.ts'
import { create_renderer } from '../src/render.ts'
import { load_copy } from '../src/copy.ts'

import { examples } from './fixtures.ts'

test('the delivered PNGs retain compact dimensions with real fonts, icons and colored stat rows', async () => {
  const render = await create_renderer()
  const copy = await load_copy('en')
  for (const event of examples) {
    const model = announcement(copy, {}, event)!
    const png = await render(model.visual)
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    const image = await loadImage(png)
    expect(image.width).toBe(400)
    expect(image.height).toBeLessThan(220)
    expect(image.height).toBeGreaterThanOrEqual(84)
  }
})
test('long identities and maximum SUI amounts remain bounded', async () => {
  const render = await create_renderer()
  const copy = await load_copy('en')
  const sale = examples[0]!
  if (sale.kind !== 'sale') throw new Error('bad fixture')
  const model = announcement(
    copy,
    { [sale.seller]: 'x'.repeat(200) },
    { ...sale, name: 'M'.repeat(512), price_mist: '18446744073709551615' }
  )!
  const image = await loadImage(await render(model.visual))
  expect(image.width).toBe(400)
  expect(image.height).toBeLessThan(120)
})
