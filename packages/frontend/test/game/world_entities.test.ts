// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { EntityRender } from '@aresrpg/engine'
import { describe, expect, test } from 'bun:test'

import { compose_world_entities } from '../../src/game/core/world.ts'

const mob = (id: string): EntityRender =>
  Object.freeze({
    id,
    kind: 'mob',
    model_url: `/${id}.glb`,
    anchor: Object.freeze({ kind: 'world', position: Object.freeze([0, 0, 0] as const) }),
    facing: Object.freeze({ kind: 'yaw', yaw: 0 }),
  })

describe('world entity composition', () => {
  test('keeps external entities when the controlled character changes', () => {
    const controlled = mob('player')
    const external = Object.freeze([mob('group_1'), mob('group_2')])

    expect(compose_world_entities(controlled, external).map(({ id }) => id)).toEqual(['player', 'group_1', 'group_2'])
  })

  test('gives the controlled entity ownership of its identity', () => {
    const controlled = mob('same')
    const external = Object.freeze([mob('same'), mob('other')])

    expect(compose_world_entities(controlled, external)).toEqual([controlled, external[1]])
  })
})
