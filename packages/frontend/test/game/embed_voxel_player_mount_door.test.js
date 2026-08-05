// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2173 — browserless wiring proof for the mount door. create_player imports the 3D engine and this repository
// intentionally has no jsdom harness, so drive the synchronous toggle from the two shipped KeyX ownership
// sites read from source. Before the fix both the player and PromptStack owned the same keydown: one physical
// press mounted and immediately dismounted before frame2 could render the ride.

import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import { MOUNT_PROMPT, mount_prompt_kind, mount_prompt_label_key } from '../../src/game/mount_prompt.js'

const player_source = readFileSync(new URL('../../src/game/embed_voxel_player.js', import.meta.url), 'utf8')

const direct_key_door = () => player_source.includes("case 'KeyX':")
const prompt_key_door = () =>
  player_source.includes('...MOUNT_PROMPT') && player_source.includes('on_trigger: toggle_mount')

describe('#2173 — the mount key has one door', () => {
  test('one X press mounts into the state frame2 renders; the next dismounts and restores locomotion', () => {
    let riding = false
    const target = { available: true, glb_url: '/models/mobs/hy_lamb.glb', source: /** @type {const} */ ('pet') }
    const toggle_mount = () => {
      riding = !riding
    }
    const rendered = () => ({ riding, avatar_anim: riding ? 'SIT' : 'RUNNING', mount_visible: riding })
    const press_x = () => {
      if (direct_key_door()) toggle_mount()
      const kind = mount_prompt_kind({ riding, in_fight: false, target })
      if (prompt_key_door() && kind) toggle_mount()
    }

    expect(Number(direct_key_door()) + Number(prompt_key_door())).toBe(1)
    expect(MOUNT_PROMPT).toEqual({ id: 'mount', key: 'X', priority: 50 })
    expect(player_source).toContain('if (riding && mount_ctl)')
    expect(player_source).toContain("avatar.update(riding ? 'SIT' : t.anim")
    expect(mount_prompt_kind({ riding, in_fight: false, target })).toBe('mount_pet')
    expect(mount_prompt_label_key('mount_pet')).toBe('world.mount_hint')

    press_x()
    expect(rendered()).toEqual({ riding: true, avatar_anim: 'SIT', mount_visible: true })
    expect(mount_prompt_kind({ riding, in_fight: false, target })).toBe('dismount')
    expect(mount_prompt_label_key('dismount')).toBe('touch.dismount')

    press_x()
    expect(rendered()).toEqual({ riding: false, avatar_anim: 'RUNNING', mount_visible: false })
  })

  test('the action is not offered for an unresolved ride, during a fight, or during fast travel', () => {
    const target = { available: false, glb_url: null, source: null }
    const equipped = {
      available: true,
      glb_url: '/models/cosmetics/suicune.glb',
      source: /** @type {const} */ ('equip'),
    }
    expect(mount_prompt_kind({ riding: false, in_fight: false, target: equipped })).toBe('mount')
    expect(mount_prompt_label_key('mount')).toBe('touch.mount')
    expect(mount_prompt_kind({ riding: false, in_fight: false, target })).toBeNull()
    expect(mount_prompt_kind({ riding: false, in_fight: true, target })).toBeNull()
    expect(mount_prompt_kind({ riding: true, in_fight: false, blocked: true, target })).toBeNull()
  })
})
