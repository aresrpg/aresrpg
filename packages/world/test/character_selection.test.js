// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  CHARACTER_SWITCH_IN_PROGRESS,
  CHARACTER_SWITCH_SESSION_CHANGED,
  create_character_switch_store,
  handle_character_click,
  initial_character_switch_state,
  reduce_character_switch,
  run_character_switch,
  select_character_session,
} from '../src/character_selection.js'

const CHAR_A = '0xcharacter-a'
const CHAR_B = '0xcharacter-b'
const CHAR_C = '0xcharacter-c'

describe('character switch reducer', () => {
  test('a failed switch settles back to idle and the same target creates a fresh request', () => {
    const switching = reduce_character_switch(initial_character_switch_state(), {
      type: 'clicked',
      character_id: CHAR_B,
    })
    expect(switching).toMatchObject({ phase: 'switching', target_id: CHAR_B, request_id: 1 })

    const failed = reduce_character_switch(switching, {
      type: 'failed',
      request_id: switching.request_id,
      error: 'network unavailable',
    })
    expect(failed).toMatchObject({ phase: 'failed', target_id: CHAR_B })

    const idle = reduce_character_switch(failed, { type: 'settled', request_id: switching.request_id })
    expect(idle).toMatchObject({
      phase: 'idle',
      target_id: null,
      request_id: null,
      last_result: { status: 'failed', target_id: CHAR_B },
    })

    const retry = reduce_character_switch(idle, { type: 'clicked', character_id: CHAR_B })
    expect(retry).toMatchObject({ phase: 'switching', target_id: CHAR_B, request_id: 2 })
  })
})

describe('character switch runner', () => {
  test('an overlapping click returns a visible reason and never invokes a second effect', async () => {
    const store = create_character_switch_store()
    const first_effect = Promise.withResolvers()
    let second_effect_calls = 0

    const first = run_character_switch(store, {
      character: { id: CHAR_B },
      perform_switch: () => first_effect.promise,
    })
    expect(store.getState()).toMatchObject({ phase: 'switching', target_id: CHAR_B, request_id: 1 })

    const second = await run_character_switch(store, {
      character: { id: CHAR_C },
      perform_switch: () => {
        second_effect_calls += 1
        return { status: 'done' }
      },
    })

    expect(second).toEqual({ status: 'refused', reason: CHARACTER_SWITCH_IN_PROGRESS })
    expect(second_effect_calls).toBe(0)
    first_effect.resolve({ status: 'done' })
    expect(await first).toMatchObject({ status: 'done', request_id: 1, target_id: CHAR_B })
    expect(store.getState().phase).toBe('idle')
  })

  test('failure always releases the reducer before the same target retries', async () => {
    const store = create_character_switch_store()
    let attempts = 0
    const perform_switch = async () => {
      attempts += 1
      return attempts === 1 ? { status: 'failed', error: new Error('first attempt failed') } : { status: 'done' }
    }

    const first = await run_character_switch(store, {
      character: { id: CHAR_B },
      perform_switch,
    })
    expect(first.status).toBe('failed')
    expect(store.getState()).toMatchObject({ phase: 'idle', last_result: { status: 'failed' } })

    const second = await run_character_switch(store, {
      character: { id: CHAR_B },
      perform_switch,
    })
    expect(second.status).toBe('done')
    expect(attempts).toBe(2)
    expect(store.getState()).toMatchObject({ phase: 'idle', last_result: { status: 'done' } })
  })

  test('session reset rejects a stale completion without settling its replacement request', async () => {
    const store = create_character_switch_store()
    const old_effect = Promise.withResolvers()
    const current_effect = Promise.withResolvers()
    const persisted = []
    const selected = []
    const rebound = []

    const old_switch = run_character_switch(store, {
      character: { id: CHAR_B },
      perform_switch: async (target, request) => {
        await select_character_session(target, {
          persist_character: (id) => {
            persisted.push(id)
            return old_effect.promise
          },
          stop_follow: () => {},
          rebind_session: (id) => rebound.push(id),
          select_character: (id) => selected.push(id),
          is_current: request.is_current,
        })
        return { status: 'done' }
      },
    })
    expect(store.getState()).toMatchObject({ phase: 'switching', target_id: CHAR_B, request_id: 1 })
    expect(persisted).toEqual([CHAR_B])

    store.getState().input({ type: 'reset' })
    const current_switch = run_character_switch(store, {
      character: { id: CHAR_C },
      perform_switch: () => current_effect.promise,
    })
    expect(store.getState()).toMatchObject({ phase: 'switching', target_id: CHAR_C, request_id: 2 })

    old_effect.resolve({ status: 'done' })
    expect(await old_switch).toMatchObject({ status: 'refused', reason: CHARACTER_SWITCH_SESSION_CHANGED })
    expect(rebound).toEqual([])
    expect(selected).toEqual([])
    expect(store.getState()).toMatchObject({ phase: 'switching', target_id: CHAR_C, request_id: 2 })

    current_effect.resolve({ status: 'done' })
    expect(await current_switch).toMatchObject({ status: 'done', request_id: 2 })
    expect(store.getState()).toMatchObject({ phase: 'idle', last_result: { status: 'done', request_id: 2 } })
  })

  test('an auth-session change releases its request before wallet reset loads', async () => {
    const store = create_character_switch_store()
    const effect = Promise.withResolvers()
    let session_current = true

    const stale_switch = run_character_switch(store, {
      character: { id: CHAR_A },
      is_session_current: () => session_current,
      perform_switch: () => effect.promise,
    })
    session_current = false
    effect.resolve({ status: 'done' })

    expect(await stale_switch).toMatchObject({ status: 'refused', reason: CHARACTER_SWITCH_SESSION_CHANGED })
    expect(store.getState()).toMatchObject({ phase: 'idle', last_result: { status: 'refused' } })
  })
})

describe('character switch click boundary', () => {
  test('a click abandoned mid-switch cannot poison the next isolated store', async () => {
    const abandoned_store = create_character_switch_store()
    const next_store = create_character_switch_store()
    const held_persist = Promise.withResolvers()
    const failures = []
    const deps = {
      select_character: () => {},
      persist_character: () => held_persist.promise,
      stop_follow: () => {},
      rebind_session: () => {},
    }

    const abandoned_click = handle_character_click(
      { id: CHAR_B },
      deps,
      (error) => failures.push(error),
      abandoned_store
    )
    await Promise.resolve()

    const next_click = await handle_character_click(
      { id: CHAR_C },
      { ...deps, persist_character: async () => {} },
      (error) => failures.push(error),
      next_store
    )

    expect(next_click).toBe(true)
    expect(abandoned_store.getState()).toMatchObject({ phase: 'switching', target_id: CHAR_B })
    expect(next_store.getState()).toMatchObject({ phase: 'idle', last_result: { status: 'done', target_id: CHAR_C } })
    expect(failures).toEqual([])

    held_persist.resolve()
    expect(await abandoned_click).toBe(true)
  })
})
