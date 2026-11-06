// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'
import { POSITION_INTERVAL_MS } from '@aresrpg/protocol'

import { create_player } from './helpers/player.ts'
import { wire, flush } from './helpers/world_wire.ts'

for (const count of [6, 21, 100]) {
  test(count + ' authenticated characters track independently and receive bounded movement headroom', async () => {
    const clock = spyOn(Date, 'now').mockReturnValue(1_000_000)
    const ids = Array.from({ length: count }, (_, index) => '0x' + (index + 1).toString(16).padStart(64, '0'))
    const fixture = wire({ character_ids: ids })
    const player = create_player({ ...fixture, address: 'owner', admin: false })
    try {
      await flush()
      await flush()
      expect([...player.online_characters()].sort()).toEqual(ids)
      expect(fixture.sent.filter((packet) => packet.type === 'packet/characters').at(-1)).toMatchObject({
        characters: ids.map((id) => ({ id })),
      })
      for (let sample = 0; sample < 1000 / POSITION_INTERVAL_MS; sample++) {
        ids.forEach((character_id, index) =>
          player.on_message(
            JSON.stringify({
              type: 'packet/position',
              character_id,
              checkpoint: fixture.checkpoint(character_id),
              x: index === 1 ? 700 : 100,
              y: 0,
              z: 100,
              riding: false,
              gliding: false,
            })
          )
        )
      }
      for (let id = 0; id < 30; id++) player.on_message(JSON.stringify({ type: 'packet/ping', id }))
      expect(fixture.dropped).toEqual([])
      expect(fixture.sent).toContainEqual({ type: 'packet/pong', id: 29 })
      player.on_message(JSON.stringify({ type: 'packet/ping', id: 30 }))
      expect(fixture.dropped).toEqual(['RATE_LIMIT'])
    } finally {
      player.on_close()
      clock.mockRestore()
    }
  })
}

test('client tracking claims cannot admit a foreign identity or increase the traffic floor', async () => {
  const clock = spyOn(Date, 'now').mockReturnValue(1_000_000)
  const fixture = wire({ character_ids: ['0xowned'] })
  const player = create_player({ ...fixture, address: 'owner', admin: false })
  try {
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xforeign', tracked: true }))
    await flush()
    expect(player.online_characters()).toEqual(['0xowned'])
    expect(
      fixture.sent.some((packet) => packet.type === 'packet/tracked_zones' && packet.character_id === '0xforeign')
    ).toBeFalse()
    for (let id = 0; id < 149; id++) player.on_message(JSON.stringify({ type: 'packet/ping', id }))
    expect(fixture.dropped).toEqual([])
    player.on_message(JSON.stringify({ type: 'packet/ping', id: 149 }))
    expect(fixture.dropped).toEqual(['RATE_LIMIT'])
  } finally {
    player.on_close()
    clock.mockRestore()
  }
})
