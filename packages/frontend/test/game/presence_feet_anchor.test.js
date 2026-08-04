// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

const player_source = readFileSync(new URL('../../src/game/embed_voxel_player.js', import.meta.url), 'utf8')

describe('presence feet anchor wiring', () => {
  test('the local avatar and presence height consume the same engine-derived feet_y', () => {
    expect(player_source).toContain('const feet_y = avatar_feet_y(t)')
    expect(player_source).toContain('avatar.object3d.position.set(t.position[0], feet_y + seat, t.position[2])')
    expect(player_source).toContain('publish_room_position(character.id, bx, bz, feet_y, heading)')
    expect(player_source).not.toContain('publish_room_position(character.id, bx, bz, by, heading)')
  })
})
