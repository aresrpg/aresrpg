// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  CITY_ARRIVAL_COOLDOWN_MS,
  city_arrival_after,
  initial_city_arrival_memory,
} from '../../src/components/CityArrivalBanner.tsx'

test('city arrival fires only on entry and rearms that city after five minutes', () => {
  const first = city_arrival_after(initial_city_arrival_memory(), 'nauvis:thebes', 1_000)
  const staying = city_arrival_after(first.memory, 'nauvis:thebes', 1_500)
  const outside = city_arrival_after(staying.memory, null, 2_000)
  const early_return = city_arrival_after(outside.memory, 'nauvis:thebes', 1_000 + CITY_ARRIVAL_COOLDOWN_MS - 1)
  const outside_again = city_arrival_after(early_return.memory, null, 1_000 + CITY_ARRIVAL_COOLDOWN_MS)
  const late_return = city_arrival_after(outside_again.memory, 'nauvis:thebes', 1_000 + CITY_ARRIVAL_COOLDOWN_MS)

  expect(first.entered).toBeTrue()
  expect(staying.entered).toBeFalse()
  expect(early_return.entered).toBeFalse()
  expect(late_return.entered).toBeTrue()
})

test('a fight suspends city observation without pretending the player left', () => {
  const first = city_arrival_after(initial_city_arrival_memory(), 'nauvis:thebes', 1_000)
  const suspended = city_arrival_after(first.memory, undefined, 2_000)
  const resumed = city_arrival_after(suspended.memory, 'nauvis:thebes', 1_000 + CITY_ARRIVAL_COOLDOWN_MS)

  expect(suspended.memory).toBe(first.memory)
  expect(resumed.entered).toBeFalse()
})
