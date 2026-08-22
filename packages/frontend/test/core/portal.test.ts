// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The star gate's approach law — one distance rule decides when T means travel.

import { describe, expect, test } from 'bun:test'
import { chain_to_client_coordinate, world_center } from '@aresrpg/immutable'

import { portal_near } from '../../src/game/core/world.ts'

describe('the star gate prompt', () => {
  test('the gate stands at the client origin — chain center maps to 0;0', () => {
    expect(chain_to_client_coordinate(world_center)).toBe(0)
    expect(portal_near(0, 0)).toBe(true)
    expect(portal_near(10, 0)).toBe(true)
    expect(portal_near(0, -10)).toBe(true)
  })

  test('T means travel only within the approach radius', () => {
    expect(portal_near(10.5, 0)).toBe(false)
    expect(portal_near(8, 6)).toBe(true)
    expect(portal_near(9, -9)).toBe(false)
  })
})
