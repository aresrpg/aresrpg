// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { visible_equipment, type PresenceRow } from '@aresrpg/protocol'
import { worn_appearance } from '@aresrpg/immutable'

import { create_player } from '../src/player.ts'
import { channels, mesh } from '../src/protocol.ts'

import { embody, flush, wire } from './helpers/stream_wire.ts'

const base_equipment = [
  { slot: 'hat', item_type: 'stat_hat' },
  { slot: 'cloak', item_type: 'stat_cloak' },
]
const cosmetics = [
  { slot: 'cosmetic_hat', item_type: 'coiffe_pepe' },
  { slot: 'cosmetic_cloak', item_type: 'cosmetic_cape' },
]
const event = (type: string, character: string) => ({
  ckpt: 1,
  tx: 0,
  evt: 0,
  ts_ms: 0,
  type,
  data: { character, slot: 'cosmetic_hat', item: '0xi' },
})

test('reconnected ownership publishes both cosmetic slots and keeps regular equipment', async () => {
  const harness = wire()
  const original_read = harness.graph.read
  let equipment = [...base_equipment, ...cosmetics]
  harness.graph.read = async (query, params) => {
    if (query.includes('RETURN e.slot AS slot')) return equipment as never
    const rows = await original_read(query, params)
    return query.includes(':Character {id:') ? (rows.map((row) => ({ ...row, worn: equipment })) as never) : rows
  }
  const player = create_player({ ...harness, address: '0xme', admin: false })
  try {
    await flush()
    await embody(player)
    const appeared = () =>
      harness.published.filter(({ payload }) => payload.kind === 'appear').at(-1)?.payload.player as PresenceRow
    expect(appeared()).toMatchObject(visible_equipment(equipment))
    expect(worn_appearance(appeared())).toEqual({ hat: 'coiffe_pepe', cloak: 'cosmetic_cape' })
    equipment = [...base_equipment, cosmetics[1]!]
    harness.pubsub.emitter.emit(channels.character('0xabc'), event('ItemUnequipped', '0xabc'))
    await flush()
    harness.pubsub.emitter.emit(mesh.pos('overworld', 0, 0), {
      kind: 'who',
      address: '0xother',
      world: 'overworld',
      zx: 0,
      zz: 0,
    })
    await flush()
    expect(worn_appearance(appeared())).toEqual({ hat: 'stat_hat', cloak: 'cosmetic_cape' })
  } finally {
    player.on_close()
  }
})

test('nearby player equipment stays removed when an older equip lookup completes late', async () => {
  const harness = wire()
  const original_read = harness.graph.read
  const delayed = Promise.withResolvers<Record<string, unknown>[]>()
  let delay_gear = false
  harness.graph.read = async (query, params) => {
    // The Item branch exercises the previous enrichment implementation for the red check.
    if (query.includes('RETURN e.slot AS slot') || query.includes(':Item {id:')) {
      if (delay_gear) {
        delay_gear = false
        return delayed.promise as never
      }
      return base_equipment as never
    }
    return original_read(query, params)
  }
  const player = create_player({ ...harness, address: '0xme', admin: false })
  try {
    await flush()
    await embody(player)
    const remote: PresenceRow = {
      character_id: '0xremote',
      owner: '0xother',
      world: 'overworld',
      name: 'Remote',
      classe: 'senshi',
      sex: 'male',
      level: 1,
      color_1: 1,
      color_2: 2,
      color_3: 3,
      x: 100,
      y: 0,
      z: 100,
      riding: false,
      ...visible_equipment(base_equipment),
    }
    harness.pubsub.emitter.emit(mesh.pos('overworld', 0, 0), { kind: 'appear', address: remote.owner, player: remote })
    await flush()
    delay_gear = true
    harness.pubsub.emitter.emit(channels.character(remote.character_id), event('ItemEquipped', remote.character_id))
    harness.pubsub.emitter.emit(channels.character(remote.character_id), event('ItemUnequipped', remote.character_id))
    await flush()
    delayed.resolve([
      {
        ...cosmetics[0],
        item: {
          properties: {
            id: '0xi',
            name: 'Pepe',
            category: 'cosmetic_hat',
            item_type: 'coiffe_pepe',
            level: 1,
            amount: 1,
          },
        },
      },
    ])
    await flush()
    const final_equipment = harness.sent.reduce(
      (row, packet) =>
        packet.type === 'packet/player_equipment' && packet.character_id === remote.character_id
          ? { ...row, [packet.slot]: packet.item_type }
          : row,
      remote
    )
    expect(final_equipment.cosmetic_hat).toBeNull()
    expect(worn_appearance(final_equipment)).toEqual({ hat: 'stat_hat', cloak: 'stat_cloak' })
  } finally {
    player.on_close()
  }
})

test('a repeated stale presence cannot erase newer indexed cosmetics', async () => {
  const harness = wire()
  const original_read = harness.graph.read
  harness.graph.read = async (query, params) =>
    query.includes('RETURN e.slot AS slot')
      ? ([...base_equipment, ...cosmetics] as never)
      : original_read(query, params)
  const player = create_player({ ...harness, address: '0xme', admin: false })
  try {
    await flush()
    await embody(player)
    const remote: PresenceRow = {
      character_id: '0xremote',
      owner: '0xother',
      world: 'overworld',
      name: 'Remote',
      classe: 'senshi',
      sex: 'male',
      level: 1,
      color_1: 1,
      color_2: 2,
      color_3: 3,
      x: 100,
      y: 0,
      z: 100,
      riding: false,
      ...visible_equipment(base_equipment),
    }
    const appear = () =>
      harness.pubsub.emitter.emit(mesh.pos('overworld', 0, 0), {
        kind: 'appear',
        address: remote.owner,
        player: remote,
      })
    appear()
    await flush()
    harness.pubsub.emitter.emit(channels.character(remote.character_id), event('ItemEquipped', remote.character_id))
    await flush()
    appear()
    await flush()
    const final_equipment = harness.sent.reduce((row, packet) => {
      if (packet.type === 'packet/player_appeared' && packet.player.character_id === remote.character_id)
        return packet.player
      return packet.type === 'packet/player_equipment' && packet.character_id === remote.character_id
        ? { ...row, [packet.slot]: packet.item_type }
        : row
    }, remote)
    expect(worn_appearance(final_equipment)).toEqual({ hat: 'coiffe_pepe', cloak: 'cosmetic_cape' })
  } finally {
    player.on_close()
  }
})
