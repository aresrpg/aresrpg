// SWITCH-PARITY LEG ① — proves CharactersDrawer's switch path (character_switch.js's
// switch_active_character, consumed by CharactersDrawer.jsx's switch_to) routes through the SAME seam
// CharacterSwitcher.tsx uses, mirroring character_selection.test.js's "the switch SEAM rebinds the fight
// after selection" assertion shape. Before this leg, switch_to only dispatched `action/select_character`
// and called `on_switch` — NEITHER the world-session rebind nor the fight rebind fired, so switching from
// the characters page left the world binding AND the fight board pointed at the outgoing character
// (red: char A's board + binding both survive the switch to B).
//
// Real stores throughout (not injected fakes) — this leaf hardcodes them exactly like CharacterSwitcher's
// own closure does, so the test proves the ACTUAL wiring, not a stand-in. resume_world_fight's real fetch
// targets localhost:3000 (no server here) — it fails fast (connection refused) and is swallowed by the
// function's own try/catch (world_fight.js), so it never throws into this test.

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../../../test_helpers/browser_globals.js'

const restore_browser_globals = install_browser_globals({ with_document: true })

const { context } = await import('../../store.js')
const { use_dungeon } = await import('../../../world-shell/dungeon_store.js')
const { use_world_binding, reset_world_binding } = await import('../../../world-shell/session_gate.js')
const { switch_active_character } = await import('./character_switch.js')

const CHAR_A = `0x${'a'.repeat(64)}`
const CHAR_B = `0x${'b'.repeat(64)}`
const FIGHT_A = `0x${'f'.repeat(64)}`
const B_WORLD = `0x${'e'.repeat(64)}`

const initial_dungeon = use_dungeon.getInitialState()
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
  reset_world_binding()
  use_dungeon.setState(initial_dungeon)
})

afterEach(async () => {
  await select_in_real_store(prior_selected_character_id)
  reset_world_binding()
  use_dungeon.setState(initial_dungeon)
})

afterAll(() => restore_browser_globals())

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

    // FIGHT half: A's LOCAL board is torn down (reset_local ran for real) — dungeon_id clears. This is the
    // exact field rebind_fight_session's own guard reads, so a clear proves rebind_fight actually fired.
    expect(use_dungeon.getState().dungeon_id).toBe(null)
  })

  test('same-character reselect is a no-op teardown (active char never tears down its own board)', async () => {
    await select_in_real_store(CHAR_B)
    use_dungeon.setState({ dungeon_id: FIGHT_A, character_id: CHAR_B }) // B already owns the live board

    const switched = await switch_active_character({ id: CHAR_B, world_id: B_WORLD }, () => {})

    expect(switched).toBe(true)
    // B's own board must survive a reselect of itself — only a DIFFERENT incoming character tears one down.
    expect(use_dungeon.getState().dungeon_id).toBe(FIGHT_A)
  })

  test('a failed session rebind invokes the visible-failure boundary once, selection still moves', async () => {
    await select_in_real_store(CHAR_A)
    const failures = []

    // No world_id → rebind_world_character (session_gate.js) throws "has no indexed world binding".
    const switched = await switch_active_character({ id: CHAR_B }, (error) => failures.push(error))

    expect(switched).toBe(false)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toBeInstanceOf(Error)
    expect(failures[0].message).toContain('has no indexed world binding')
    await wait_for_selected_character(CHAR_B) // selection still moves first, per the seam's documented order
    expect(context.get_state().selected_character_id).toBe(CHAR_B)
  })
})
