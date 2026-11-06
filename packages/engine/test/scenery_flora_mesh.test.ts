// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash } from 'node:crypto'

import { expect, test } from 'bun:test'

import { build_flora_mesh } from '../src/scenery_flora_mesh.ts'

// Captured from the original synchronous scenery_flora renderer, 2026-11-05, before worker extraction.
const captured = {
  fern: 'a2819e86a31b7df364df9140e8879d1611c9922cf2396a8011c879431318c695',
  bush: '02fa3700ff4c48f7f301e0605309bc76e38ff66a912520dc3dd14d7dc08477a9',
  mushroom: '175d1905ab274fe6ab16ffee76625e9af39435ac07d757f8c64824d8cb4efcf5',
  spike: 'e50c2e03e7ce0307d58f146adcd34194ee9f00861f9ce195bc00e214ce3aca80',
  icicle: '01940356f7f06211108ff1e93d06bd41d8daa2a3553fc1304595536ba7721ada',
  grass: 'beee5cfd49c56c67b210438f6d2819a79523ef1fc0735d0e52d6516d9a5833ad',
  pine: 'fd3d15b86fde40cd9888093fe083976b55d3abf6e3780d57f0d686190057e6ee',
  mineral: '79c08db00207c19f709913bdceec5e2167815b8a476bee68475a0317be20cdfa',
  rock: 'b01ed74befde65ef0483d26b9458bd3c34defa983f38e7dd4409be26315d3a09',
} as const

test('worker flora retains every byte of the original authored plant buffers', () => {
  for (const kind of Object.keys(captured) as (keyof typeof captured)[]) {
    const data = build_flora_mesh([
      { kind, center: [4, 7, -2], scale: 1.5, color: [0.2, 0.4, 0.6], accent: [0.6, 0.5, 0.4], glow: 0.3 },
    ])!
    const hash = createHash('sha256')
    for (const values of Object.values(data)) hash.update(new Uint8Array(values.buffer))
    expect(hash.digest('hex')).toBe(captured[kind])
  }
  expect(build_flora_mesh([])).toBeNull()
})
