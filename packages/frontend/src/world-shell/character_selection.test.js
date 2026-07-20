// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { handle_character_click, select_character_session } from '@aresrpg/world/character_selection'

import { context } from '../game/core/game.js'

import { rebind_world_character, reset_world_binding, use_world_binding } from './session_gate.js'
import { rebind_fight_session } from './character_fight_rebind.js'

const TOMODO = '0xtomodo'
const PLAYER = '0xplayer'
const PLAYER_WORLD = '0xfirst-shore'

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
})

afterEach(async () => {
  await select_in_real_store(prior_selected_character_id)
  reset_world_binding()
})

describe('CharacterSwitcher click -> selection store -> resident session', () => {
  test('changes the active character id before invoking the real session binding re-key', async () => {
    await select_in_real_store(TOMODO)
    const persisted = []
    const trace = []
    const failures = []

    const switched = await handle_character_click(
      { id: PLAYER, world_id: PLAYER_WORLD },
      {
        select_character: (id) => {
          context.dispatch('action/select_character', id)
          trace.push(`selected:${id}`)
        },
        persist_character: async (id) => {
          persisted.push(id)
          trace.push(`persisted:${id}`)
        },
        stop_follow: () => trace.push('follow:stopped'),
        rebind_session: async (id, world_id) => {
          await wait_for_selected_character(id)
          expect(context.get_state().selected_character_id).toBe(id)
          trace.push(`rebound:${id}`)
          rebind_world_character(id, world_id)
        },
      },
      (error) => failures.push(error)
    )

    expect(switched).toBe(true)
    expect(context.get_state().selected_character_id).toBe(PLAYER)
    expect(persisted).toEqual([PLAYER])
    const { character_id, world, joining } = use_world_binding.getState()
    expect({ character_id, world, joining }).toEqual({
      character_id: PLAYER,
      world: PLAYER_WORLD,
      joining: false,
    })
    expect(trace).toEqual([`selected:${PLAYER}`, `persisted:${PLAYER}`, 'follow:stopped', `rebound:${PLAYER}`])
    expect(failures).toEqual([])
  })

  const CHAR_A = `0x${'a'.repeat(64)}`
  const CHAR_B = `0x${'b'.repeat(64)}`
  const FIGHT_A = `0x${'f'.repeat(64)}`
  const B_WORLD = `0x${'e'.repeat(64)}`

  test('rebind_fight_session tears down the OUTGOING char board and resumes the INCOMING char', () => {
    const dungeon = { dungeon_id: FIGHT_A, character_id: CHAR_A } // char A mid-fight
    let torn_down = false
    const resumed = []
    rebind_fight_session(CHAR_B, { dungeon, reset_local: () => (torn_down = true), resume: (id) => resumed.push(id) })
    expect(torn_down).toBe(true) // A's LOCAL board dropped (reset_local — no chain tx, A's fight persists)
    expect(resumed).toEqual([CHAR_B]) // B's own live-fight resume requested
  })

  test('same-character (or no board) rebind is a NO-OP teardown — only the incoming char resumes', () => {
    const dungeon = { dungeon_id: FIGHT_A, character_id: CHAR_B } // B already owns the board (or none live)
    let reset = 0
    const resumed = []
    rebind_fight_session(CHAR_B, { dungeon, reset_local: () => reset++, resume: (id) => resumed.push(id) })
    expect(reset).toBe(0) // never tear down the incoming char's own live board
    expect(resumed).toEqual([CHAR_B])
  })

  test('the switch SEAM rebinds the fight after selection (red today: char A fight persists over B)', async () => {
    await select_in_real_store(CHAR_A)
    const dungeon = { dungeon_id: FIGHT_A, character_id: CHAR_A }
    let torn_down = false
    const resumed = []
    const switched = await select_character_session(
      { id: CHAR_B, world_id: B_WORLD },
      {
        select_character: (id) => context.dispatch('action/select_character', id),
        persist_character: async () => {},
        stop_follow: () => {},
        rebind_session: rebind_world_character,
        rebind_fight: (id) =>
          rebind_fight_session(id, {
            dungeon,
            reset_local: () => (torn_down = true),
            resume: (cid) => resumed.push(cid),
          }),
      }
    )
    expect(switched).toBe(CHAR_B)
    expect(torn_down).toBe(true) // char A's board torn down on the switch (not just the world)
    expect(resumed).toEqual([CHAR_B]) // char B's own live fight resumed — only the active char's fight mounts
    await wait_for_selected_character(CHAR_B) // the store commit settles async — then the active id is B
    expect(context.get_state().selected_character_id).toBe(CHAR_B)
  })

  test('a failed session rebind invokes the visible-failure boundary once', async () => {
    await select_in_real_store(TOMODO)
    const toast_failure = mock(() => {})

    const switched = await handle_character_click(
      { id: PLAYER },
      {
        select_character: (id) => context.dispatch('action/select_character', id),
        persist_character: async () => {},
        stop_follow: () => {},
        rebind_session: rebind_world_character,
      },
      toast_failure
    )

    expect(switched).toBe(false)
    await wait_for_selected_character(PLAYER)
    expect(context.get_state().selected_character_id).toBe(PLAYER)
    expect(toast_failure).toHaveBeenCalledTimes(1)
    const failure = toast_failure.mock.calls[0]?.[0]
    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).toContain('has no indexed world binding')
  })
})
