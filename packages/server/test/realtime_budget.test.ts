// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { MAX_TRACKED_CHARACTERS, POSITION_INTERVAL_MS } from '@aresrpg/protocol'

import { create_player } from './helpers/player.ts'
import { wire, flush } from './helpers/world_wire.ts'

test('one second of six-character movement leaves room for ordinary control packets', async () => {
  const ids = Array.from(
    { length: MAX_TRACKED_CHARACTERS },
    (_, index) => `0x${(index + 1).toString(16).padStart(64, '0')}`
  )
  const fixture = wire({ character_ids: ids })
  const player = create_player({ ...fixture, address: 'owner', admin: false })
  try {
    await flush()
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
          })
        )
      )
    }
    player.on_message(JSON.stringify({ type: 'packet/ping', id: 7 }))
    expect(fixture.sent.filter(({ type }) => type === 'packet/error')).toEqual([])
    expect(fixture.dropped).toEqual([])
    expect(fixture.sent).toContainEqual({ type: 'packet/pong', id: 7 })
  } finally {
    player.on_close()
  }
})
