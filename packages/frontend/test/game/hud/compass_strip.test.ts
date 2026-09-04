// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { city_compass_markers } from '../../../src/game/hud/CompassStrip.tsx'

test('city compass markers persist outside cities with their bearing and distance', () => {
  const markers = city_compass_markers('nauvis', { x: 2_000, z: 0 }, -Math.PI / 2)
  const thebes = markers.find(({ id }) => id === 'thebes')
  const ruins = markers.find(({ id }) => id === 'the_ruins')

  expect(thebes).toMatchObject({ label: 'Thebes', distance: 1_488, x: 0.5, dungeon: false, show_label: true })
  expect(ruins?.distance).toBeGreaterThan(13_000)
})

test('the city marker hides its redundant tag and distance while inside that city', () => {
  const [thebes] = city_compass_markers('nauvis', { x: 512, z: 0 }, 0)

  expect(thebes).toMatchObject({ id: 'thebes', distance: 0, dungeon: true, show_label: false })
})
