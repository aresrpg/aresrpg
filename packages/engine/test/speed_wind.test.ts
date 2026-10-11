// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Scene } from 'three'

import { create_speed_wind } from '../src/speed_wind.ts'

test('speed wind draws only while active and leaves no scene object after disposal', () => {
  const scene = new Scene()
  const wind = create_speed_wind(scene)
  expect(scene.children[0]!.visible).toBe(false)
  wind.set_strength(0.5)
  expect(scene.children[0]!.visible).toBe(true)
  wind.set_strength(0)
  expect(scene.children[0]!.visible).toBe(false)
  wind.dispose()
  expect(scene.children).toHaveLength(0)
})
