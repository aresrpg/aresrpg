// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SWITCH-PARITY LEG ① — proves CharactersDrawer's switch path (character_switch.js's
// switch_active_character, consumed by CharactersDrawer.jsx's switch_to) routes through the SAME seam
// CharacterSwitcher.tsx uses, mirroring character_selection.test.js's "the switch SEAM rebinds the fight
// after selection" assertion shape. Before this leg, switch_to only dispatched `action/select_character`
// and called `on_switch` — NEITHER the world-session rebind nor the fight rebind fired, so switching from
// the characters page left the world binding AND the fight board pointed at the outgoing character
// (red: char A's board + binding both survive the switch to B).
//
// Real stores throughout (not injected fakes) — this leaf hardcodes them exactly like CharacterSwitcher's
// own closure does, so the test proves the ACTUAL wiring, not a stand-in. resume_world_fight's fetch is
// stubbed at the socket boundary to reject immediately with ECONNREFUSED, the no-server condition this test
// intends to exercise; world_fight.js swallows that read failure, so it never throws into this test.
//
// `globalThis.fetch` is a PROCESS global, so the stub sees every module-global poller a sibling file in the
// same bun process left armed — music_self_heal.js's self-rearming manifest re-check is the live one, and it
// reddened this file's call count in the gate's game-suite combination while an isolated run stayed green.
// So the counted mock is the SEAM's own read (`/v1/fights?character=`, what resume_world_fight issues for the
// incoming character) and everything else is refused through a separate, uncounted stub: the number this file
// asserts is a property of the switch, never of whatever else the process happens to be polling. The rpc
// client's own reset hook runs per test for the same reason — its module-lifetime LRU/in-flight/poll-stagger
// state is shared with every sibling suite, and a warmed entry for this URL would answer the read with no
// fetch at all.

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { install_browser_globals } from '../../../test_helpers/browser_globals.js'

const restore_browser_globals = install_browser_globals({ with_document: true })

const { context } = await import('../../store.js')
const { use_dungeon } = await import('../../../world-shell/dungeon_store.js')
const { use_world_binding, reset_world_binding } = await import('../../../world-shell/session_gate.js')
const { _reset_rpc_client_for_test } = await import('../../../rpc/client')
const { switch_active_character } = await import('./character_switch.js')

const CHAR_A = `0x${'a'.repeat(64)}`
const CHAR_B = `0x${'b'.repeat(64)}`
const FIGHT_A = `0x${'f'.repeat(64)}`
const B_WORLD = `0x${'e'.repeat(64)}`

const initial_dungeon = use_dungeon.getInitialState()
const real_fetch = globalThis.fetch
const refuse = () => {
  const error = new Error('connect ECONNREFUSED 127.0.0.1:3000')
  error.code = 'ECONNREFUSED'
  return Promise.reject(error)
}
/** resume_world_fight's OWN read for the incoming character — the only fetch this file makes a claim about. */
const resume_read = mock(refuse)
/** Anything else the process fires while the stub is installed: refused identically, deliberately uncounted. */
const unrelated_fetch = mock(refuse)
const is_resume_read = (url) => String(url ?? '').includes(`/v1/fights?character=${CHAR_B}`)
const refusing_fetch = (url, init) => (is_resume_read(url) ? resume_read(url, init) : unrelated_fetch(url, init))
let prior_selected_character_id = null

async function wait_for_selected_character(expected_id, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    if (context.get_state().selected_character_id === expected_id) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`selection store did not settle on ${expected_id ?? 'null'}`)
}

async function select_in_real_store(character_id) {
  context.dispatch('action/select_character', character_id)
  await wait_for_selected_character(character_id)
}

beforeEach(() => {
  prior_selected_character_id = context.get_state().selected_character_id
  resume_read.mockClear()
  unrelated_fetch.mockClear()
  globalThis.fetch = refusing_fetch
  _reset_rpc_client_for_test()
  reset_world_binding()
  use_dungeon.setState(initial_dungeon)
})

afterEach(async () => {
  try {
    await select_in_real_store(prior_selected_character_id)
    reset_world_binding()
    use_dungeon.setState(initial_dungeon)
  } finally {
    globalThis.fetch = real_fetch
  }
})

afterAll(() => {
  globalThis.fetch = real_fetch
  restore_browser_globals()
})

describe('CharactersDrawer switch_to -> character_switch.js -> the CharacterSwitcher seam', () => {
  test('rebinds BOTH the world session and the fight target (red before LEG ①: neither fired)', async () => {
    await select_in_real_store(CHAR_A)
    // Char A mid-fight, exactly the shape rebind_fight_session's guard reads (dungeon_id + character_id).
    use_dungeon.setState({ dungeon_id: FIGHT_A, character_id: CHAR_A })

    const failures = []
    const switched = await switch_active_character({ id: CHAR_B, world_id: B_WORLD }, (error) => failures.push(error))

    expect(switched).toBe(true)
    expect(failures).toEqual([])
    await wait_for_selected_character(CHAR_B)
    expect(context.get_state().selected_character_id).toBe(CHAR_B) // selection moved

    const { character_id, world } = use_world_binding.getState()
    expect({ character_id, world }).toEqual({ character_id: CHAR_B, world: B_WORLD }) // world session rebound
    expect(resume_read).toHaveBeenCalledTimes(1)

    // FIGHT half: A's LOCAL board is torn down (reset_local ran for real) — dungeon_id clears. This is the
    // exact field rebind_fight_session's own guard reads, so a clear proves rebind_fight actually fired.
    expect(use_dungeon.getState().dungeon_id).toBe(null)
  })

  test('same-character reselect is a no-op teardown (active char never tears down its own board)', async () => {
    await select_in_real_store(CHAR_B)
    use_dungeon.setState({ dungeon_id: FIGHT_A, character_id: CHAR_B }) // B already owns the live board

    const switched = await switch_active_character({ id: CHAR_B, world_id: B_WORLD }, () => {})

    expect(switched).toBe(true)
    expect(resume_read).toHaveBeenCalledTimes(1)
    // B's own board must survive a reselect of itself — only a DIFFERENT incoming character tears one down.
    expect(use_dungeon.getState().dungeon_id).toBe(FIGHT_A)
  })

  test('a failed session rebind invokes the visible-failure boundary and keeps the prior selection', async () => {
    await select_in_real_store(CHAR_A)
    const failures = []

    // No world_id → rebind_world_character (session_gate.js) throws "has no indexed world binding".
    const switched = await switch_active_character({ id: CHAR_B }, (error) => failures.push(error))

    expect(switched).toBe(false)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toBeInstanceOf(Error)
    expect(failures[0].message).toContain('has no indexed world binding')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(context.get_state().selected_character_id).toBe(CHAR_A)
  })
})
