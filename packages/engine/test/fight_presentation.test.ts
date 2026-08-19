// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_fight_presentation } from '../src/fight_presentation.ts'

test('cast facing, movement cost, and damage numbers use the serialized presentation edge', async () => {
  const log: string[] = []
  const entities = {
    face_cell: (id: string, cell: number) => {
      log.push(`face:${id}:${cell}`)
      return true
    },
    beat: (id: string, kind: string) => {
      log.push(`beat:${id}:${kind}`)
      return Promise.resolve(true)
    },
    animate: ({ id }: Readonly<{ id: string }>) => {
      log.push(`move:${id}`)
      return Promise.resolve(true)
    },
    snap: () => true,
  }
  const vfx = {
    play_cast: () => {
      log.push('vfx:cast')
      return Promise.resolve(true)
    },
    play_float: (id: string, amount: number, kind: string) => {
      log.push(`float:${id}:${amount}:${kind}`)
      return true
    },
    play_death: () => undefined,
    play_zone: () => Promise.resolve(true),
  }
  const presentation = create_fight_presentation({ entities: entities as never, vfx: vfx as never })

  await presentation.play({
    id: 'cast',
    type: 'cast',
    caster_id: 'caster',
    spell: 'Push',
    cast_level: 1,
    target_cell: 22,
    element: 'air',
    style: 'push',
    critical: false,
    amount: 8,
    target_max_hp: 100,
    affected_cells: [22],
    killed: false,
  })
  await presentation.play({
    id: 'move',
    type: 'movement',
    entity_id: 'caster',
    source_id: 'caster',
    cells: [21, 22],
    mode: 'walk',
    gait: 'walk',
    mp_spent: 2,
  })
  await presentation.play({
    id: 'damage',
    type: 'damage',
    source_id: 'caster',
    target_id: 'target',
    amount: 8,
    hp_before: 20,
    hp_after: 12,
    element: 'air',
    cause: 'spell',
    critical: false,
  })
  await presentation.play({
    id: 'tackle',
    type: 'tackle',
    entity_id: 'caster',
    source_id: 'target',
    ap_lost: 2,
    mp_lost: 1,
  })
  // an MP steal: the target's loss and the caster's drink, both as signed pool floats
  await presentation.play({ id: 'pool-loss', type: 'pool', entity_id: 'target', ap: 0, mp: -2 })
  await presentation.play({ id: 'pool-gain', type: 'pool', entity_id: 'caster', ap: 0, mp: 2 })
  await presentation.play({
    id: 'zone',
    type: 'zone',
    action: 'trap_triggered',
    zone_id: 'trap:1',
    owner_id: 'caster',
    target_id: 'caster',
    affected_ids: ['target'],
    cell: 22,
    element: 'neutral',
  })

  expect(log).toEqual([
    'face:caster:22',
    'beat:caster:attack',
    'vfx:cast',
    'move:caster',
    'float:caster:-2:mp',
    'float:target:8:damage',
    'beat:target:hit',
    'beat:caster:hit',
    'float:caster:-1:mp',
    'float:caster:-2:ap',
    'float:target:-2:mp',
    'float:caster:2:mp',
    'beat:target:hit',
  ])
})
