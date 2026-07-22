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

async function wait_for_roster(expected_ids, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    const ids = context.get_state().sui.characters.map((character) => character.id)
    if (ids.length === expected_ids.length && ids.every((id, index) => id === expected_ids[index])) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`roster store did not settle on ${expected_ids.join(', ')}`)
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
  test('commits the active character only after the real session binding re-key succeeds', async () => {
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
          expect(context.get_state().selected_character_id).toBe(TOMODO)
          trace.push(`rebound:${id}`)
          rebind_world_character(id, world_id)
        },
      },
      (error) => failures.push(error)
    )

    expect(switched).toBe(true)
    await wait_for_selected_character(PLAYER)
    expect(context.get_state().selected_character_id).toBe(PLAYER)
    expect(persisted).toEqual([PLAYER])
    const { character_id, world, joining } = use_world_binding.getState()
    expect({ character_id, world, joining }).toEqual({
      character_id: PLAYER,
      world: PLAYER_WORLD,
      joining: false,
    })
    expect(trace).toEqual([`persisted:${PLAYER}`, 'follow:stopped', `rebound:${PLAYER}`, `selected:${PLAYER}`])
    expect(failures).toEqual([])
  })

  const CHAR_A = `0x${'a'.repeat(64)}`
  const CHAR_B = `0x${'b'.repeat(64)}`
  const FIGHT_A = `0x${'f'.repeat(64)}`
  const A_WORLD = `0x${'d'.repeat(64)}`
  const B_WORLD = `0x${'e'.repeat(64)}`

  test('a raw roster selection re-enters the resident world binding', async () => {
    const prior_roster = context.get_state().sui.characters
    const roster = [
      { id: CHAR_A, world_id: A_WORLD },
      { id: CHAR_B, world_id: B_WORLD },
    ]

    try {
      context.dispatch('action/sui_data', { characters: roster })
      await wait_for_roster([CHAR_A, CHAR_B])
      await select_in_real_store(CHAR_A)
      rebind_world_character(CHAR_A, A_WORLD)

      context.dispatch('action/select_character', CHAR_B)
      await wait_for_selected_character(CHAR_B)

      expect(context.get_state().selected_character_id).toBe(CHAR_B)
      expect(use_world_binding.getState()).toMatchObject({ character_id: CHAR_B, world: B_WORLD })
    } finally {
      context.dispatch('action/sui_data', { characters: prior_roster })
      await wait_for_roster(prior_roster.map((character) => character.id))
    }
  })

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

  test('the switch seam rebinds the fight before committing selection', async () => {
    await select_in_real_store(CHAR_A)
    const dungeon = { dungeon_id: FIGHT_A, character_id: CHAR_A }
    let torn_down = false
    const resumed = []
    const trace = []
    const switched = await select_character_session(
      { id: CHAR_B, world_id: B_WORLD },
      {
        select_character: (id) => {
          trace.push(`selected:${id}`)
          context.dispatch('action/select_character', id)
        },
        persist_character: async () => {},
        stop_follow: () => {},
        rebind_session: rebind_world_character,
        rebind_fight: (id) =>
          rebind_fight_session(id, {
            dungeon,
            reset_local: () => (torn_down = true),
            resume: (cid) => {
              trace.push(`resumed:${cid}`)
              resumed.push(cid)
            },
          }),
      }
    )
    expect(switched).toBe(CHAR_B)
    expect(torn_down).toBe(true) // char A's board torn down on the switch (not just the world)
    expect(resumed).toEqual([CHAR_B]) // char B's own live fight resumed — only the active char's fight mounts
    expect(trace).toEqual([`resumed:${CHAR_B}`, `selected:${CHAR_B}`])
    await wait_for_selected_character(CHAR_B) // the store commit settles async — then the active id is B
    expect(context.get_state().selected_character_id).toBe(CHAR_B)
  })

  test('a failed session rebind keeps the prior selection so the same target can retry', async () => {
    await select_in_real_store(TOMODO)
    const toast_failure = mock(() => {})
    let rebind_attempts = 0

    const deps = {
      select_character: (id) => context.dispatch('action/select_character', id),
      persist_character: async () => {},
      stop_follow: () => {},
      rebind_session: (id, world_id) => {
        rebind_attempts += 1
        if (rebind_attempts === 1) throw new Error('first rebind failed')
        rebind_world_character(id, world_id)
      },
    }

    const first = await handle_character_click({ id: PLAYER, world_id: PLAYER_WORLD }, deps, toast_failure)

    expect(first).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(context.get_state().selected_character_id).toBe(TOMODO)
    expect(toast_failure).toHaveBeenCalledTimes(1)
    const failure = toast_failure.mock.calls[0]?.[0]
    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).toContain('first rebind failed')

    const second = await handle_character_click({ id: PLAYER, world_id: PLAYER_WORLD }, deps, toast_failure)

    expect(second).toBe(true)
    expect(rebind_attempts).toBe(2)
    await wait_for_selected_character(PLAYER)
    expect(context.get_state().selected_character_id).toBe(PLAYER)
  })
})
