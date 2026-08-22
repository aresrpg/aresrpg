// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { rendered_groups, type WorldMobGroup } from '../../src/game/core/spawn_residency.ts'

const group = (id: string, x: number): WorldMobGroup =>
  Object.freeze({ id, x, z: 0, members: Object.freeze([{ mob_type: 'wooling', level_scalar: 1 }]) })

test('all tracked groups exist, while only groups under one hundred blocks render', () => {
  const tracked = Object.freeze([group('near', 99.9), group('edge', 100), group('far', 300)])

  expect(rendered_groups(tracked, { x: 0, z: 0 }).map(({ id }) => id)).toEqual(['near'])
  expect(rendered_groups(tracked, { x: 260, z: 0 }).map(({ id }) => id)).toEqual(['far'])
})
