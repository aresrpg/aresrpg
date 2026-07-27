// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #925 file-size fence: the split action fragments must still compose the complete historic store surface.

import { afterAll, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'

const restore_browser_globals = install_browser_globals({ with_document: true })
const { use_dungeon } = await import('../../src/world-shell/dungeon_run_store.js')
const { use_dungeon: facade_store } = await import('../../src/world-shell/dungeon_store.js')

const action_names = [
  'create_dungeon_as_leader',
  'claim_settling',
  'start_when_ready',
  'start_next_room',
  'join_shared_dungeon',
  'resume_dungeon',
  '_recover_stale_membership',
  '_recover_dead_fight_reference',
  '_collapse_terminal_ghost',
  '_resolve_mob_identities',
  'note_group_identity',
  'refresh',
  '_start_polling',
  '_stop_polling',
  'dismiss_recap',
  'place_at_cell',
  'commit_turn',
  'abandon_fight',
  'abandon',
  'abandon_escrowed',
  'consume_potion',
  'claim',
  'mint_loot',
  'burn',
  'recover_pending',
  'reset_local',
]

afterAll(() => {
  use_dungeon.getState()._stop_polling()
  restore_browser_globals()
})

describe('dungeon run store composition', () => {
  test('the entry, sync, and fight fragments preserve every action on the one store', () => {
    const state = use_dungeon.getState()
    expect(action_names.filter((name) => typeof state[name] !== 'function')).toEqual([])
    expect(facade_store).toBe(use_dungeon)
  })
})
