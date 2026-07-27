// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#1206 — "upgraded spell still casts as level 1 in fights"): `fight::combatant_of` snapshots a seat's
// LEARNED level for EXACTLY the SpellTemplate ids the entry PTB names (`raised_spell_ids`); an id the client never
// names reads as the free baseline 1 forever, however many points the character invested. Every shipped fight door
// defaulted that vector to `[]`, so the chain was answering a question the client never asked — proven live on
// testnet against `fight::combat_snapshot` (the same factory create/join use) for a character whose warcleave DF
// reads level 2: `[]` → an EMPTY spell_levels map, `[warcleave]` → `{warcleave: 2}`.
//
// These drive the REAL doors (only their chain edges — the allocation read, kiosk, /v1 fights, the tx choke — are
// doubled), so what the PTB names is proven behaviorally, never read off the source.

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as sdk_fight from '@aresrpg/sdk/fight'

import { install_browser_globals } from '../test_helpers/browser_globals.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'

// The engage graph pulls in the browser wallet registration at module load, so every one of its modules is
// imported DYNAMICALLY — after the host surface exists.
const restore_browser_globals = install_browser_globals()

const rpc_client = await import('../rpc/client')
const kiosk_resolve = await import('./kiosk_resolve.js')
const dungeon_actions = await import('./dungeon_actions.js')
const read_spell_state = await import('../chain/read_spell_state.js')
const { create_world_fight } = await import('./dungeon_engage_actions.js')
const { set_spell_corpus_for_test } = await import('../game/data/spell_corpus.js')
const { context } = await import('../game/store.js')
const { use_auth } = await import('../auth')

afterAll(restore_browser_globals)

const CHARACTER = '0xchar'
const WARCLEAVE = `0x${'a'.repeat(64)}`
const VAULT = `0x${'d'.repeat(64)}`
const CHICKLET = `0x${'b'.repeat(64)}`
const HANDLE = { kiosk_id: '0xk1', personal_kiosk_cap_id: '0xp1' }
const ENGAGE = {
  world_id: '0x1',
  spawn_id: '23',
  zx: null,
  zy: null,
  mob_template_id: CHICKLET,
  character_id: CHARACTER,
}
const level_row = {
  min_char_level: 1,
  ap_cost: 3,
  range_min: 1,
  range_max: 4,
  base_effects: [],
  critical_effects: [],
}
const spell_row = (id, name, object_id) => ({
  id,
  name,
  object_id,
  classType: 'senshi',
  unlock: 1,
  levels: [level_row, level_row],
})
const CORPUS = [spell_row('senshi_warcleave', 'Warcleave', WARCLEAVE), spell_row('senshi_vault', 'Vault', VAULT)]

/** @type {any[]} */
let spies = []
/** @type {any} */
let mono
/** The args the CURRIED composer was finally called with. */
let mono_args = null
let join_args = null
/** #123 (cross-file pollution): `bun test src` shares ONE process — this file's state must never outlive it. */
let prior_address = null
let prior_characters = null

beforeEach(() => {
  mono_args = null
  join_args = null
  prior_address = use_auth.getState().address ?? null
  prior_characters = context.get_state().sui?.characters ?? null
  use_auth.setState({ address: '0xme' })
  context.dispatch('action/sui_data', { characters: [{ id: CHARACTER, classe: 'senshi' }] })
  set_spell_corpus_for_test(CORPUS)
  set_expedition_sdk_mock(async () => ({ grpc_client: {} }))
  mono = spyOn(sdk_fight, 'create_fight_ptb').mockReturnValue((args) => {
    mono_args = args
    return { mono: true }
  })
  spies = [
    mono,
    spyOn(sdk_fight, 'join_fight_ptb').mockReturnValue((args) => {
      join_args = args
      return { join: true }
    }),
    spyOn(kiosk_resolve, 'kiosk_for_character').mockResolvedValue(HANDLE),
    spyOn(rpc_client, 'get_fights').mockResolvedValue([]),
    spyOn(dungeon_actions, 'ctx_of').mockReturnValue({}),
    spyOn(dungeon_actions, 'sign').mockResolvedValue({ digest: '0xdeadbeef' }),
    spyOn(dungeon_actions, 'remember_created_fight').mockReturnValue('0xfight'),
    // The chain-true allocation read (the grimoire's own): warcleave invested to 3, vault untouched.
    spyOn(read_spell_state, 'read_spell_state').mockResolvedValue({
      spent: 3,
      levels: { [WARCLEAVE]: 3, [VAULT]: 1 },
    }),
  ]
})

afterEach(() => {
  for (const spy of spies) spy.mockRestore()
  reset_expedition_sdk_mock()
  set_spell_corpus_for_test()
  use_auth.setState({ address: prior_address })
  context.dispatch('action/sui_data', { characters: prior_characters ?? [] })
})

describe('a fight entry names the seat’s RAISED spells (#1206)', () => {
  test('creating a world fight names every spell invested past the free baseline — and only those', async () => {
    await create_world_fight(ENGAGE)
    expect(mono).toHaveBeenCalledTimes(1)
    expect(mono_args?.raised_spell_ids).toEqual([WARCLEAVE])
  })

  test('joining a world fight names them too — a joiner’s kit is snapshotted by the same factory', async () => {
    await dungeon_actions.join_world_fight({ fight_id: '0xfight', character_id: CHARACTER })
    expect(join_args?.raised_spell_ids).toEqual([WARCLEAVE])
  })

  test('a kit at the free baseline names nothing — the vector carries investment, not the book', async () => {
    spies.at(-1).mockResolvedValue({ spent: 0, levels: { [WARCLEAVE]: 1, [VAULT]: 1 } })
    await create_world_fight(ENGAGE)
    expect(mono_args?.raised_spell_ids).toEqual([])
  })

  test('the allocation read is asked for the character’s OWN class book', async () => {
    await create_world_fight(ENGAGE)
    expect(spies.at(-1)).toHaveBeenCalledWith(CHARACTER, [WARCLEAVE, VAULT])
  })

  test('a seat with no roster row still enters — at the baseline, and it SHOUTS', async () => {
    const shout = spyOn(console, 'error').mockImplementation(() => {})
    try {
      await create_world_fight({ ...ENGAGE, character_id: '0xghost' })
      expect(mono_args?.raised_spell_ids).toEqual([])
      expect(shout).toHaveBeenCalled()
    } finally {
      shout.mockRestore()
    }
  })
})
