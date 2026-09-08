import { readFile } from 'node:fs/promises'

import { expect, test } from 'bun:test'

test('the shipped KARES PNG contains alpha rather than relying on CSS background clipping', async () => {
  const png = await readFile(new URL('../public/kares.png', import.meta.url))
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  expect(png.subarray(12, 16).toString()).toBe('IHDR')
  // PNG color type 6 is truecolor with an alpha channel; the old opaque logo used type 2.
  expect(png[25]).toBe(6)
})
