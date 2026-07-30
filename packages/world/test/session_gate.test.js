// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Settled character↔world binding core. Character creation commits membership atomically, so this atom has
// no joining phase, failsafe, or transaction request.

import { describe, expect, it } from 'bun:test'

import {
  SCENE_SESSION,
  SCENE_SPECTATE,
  create_session_gate_store,
  plan_scene,
  reduce_session_gate,
  resolved_mode,
  scene_target,
  subscribe_stale_poll,
} from '../src/session_gate.js'

const WORLD = `0x${'a'.repeat(64)}`
const WORLD_B = `0x${'9'.repeat(64)}`
const CHAR = `0x${'1'.repeat(64)}`
const OTHER_CHAR = `0x${'2'.repeat(64)}`

const make_gate = () => {
  const store = create_session_gate_store()
  const input = (message) => store.getState().input(message)
  return {
    store,
    input,
    publish: (character_id, world, source = 'manual') =>
      input({ type: 'binding_published', character_id, world, source }),
    reset: () => input({ type: 'binding_reset' }),
  }
}

describe('scene decisions', () => {
  it('keeps logged-out and confirmed-unbound sessions in spectate', () => {
    expect(scene_target({ on_world_tab: true, authenticated: false, world: undefined })).toBe(SCENE_SPECTATE)
    expect(scene_target({ on_world_tab: true, authenticated: true, world: null })).toBe(SCENE_SPECTATE)
    expect(resolved_mode(null)).toBe(SCENE_SPECTATE)
  })

  it('routes bound and not-yet-resolved memberships through the session path', () => {
    expect(scene_target({ on_world_tab: true, authenticated: true, world: WORLD })).toBe(SCENE_SESSION)
    expect(scene_target({ on_world_tab: true, authenticated: true, world: undefined })).toBe(SCENE_SESSION)
    expect(resolved_mode(WORLD)).toBe(SCENE_SESSION)
  })

  it('plans resident mounts by character and world, without a joining hold', () => {
    const base = { show_world: true, authenticated: true, on_world_tab: true, character_id: CHAR }
    expect(plan_scene({ ...base, world: WORLD })).toEqual({
      action: 'resident',
      key: `lobby:${CHAR}:${WORLD}`,
    })
    expect(plan_scene({ ...base, world: undefined })).toEqual({ action: 'session', key: `lobby:${CHAR}` })
    expect(plan_scene({ ...base, world: null })).toEqual({ action: 'spectate', key: 'spectate' })
  })

  it('retains the auth-loading and hidden boot gates', () => {
    expect(
      plan_scene({
        show_world: true,
        authenticated: false,
        on_world_tab: true,
        auth_loading: true,
        world: undefined,
      })
    ).toEqual({ action: 'await-auth', key: null })
    expect(plan_scene({ show_world: false, authenticated: true, on_world_tab: true, world: WORLD })).toEqual({
      action: 'hidden',
      key: null,
    })
  })
})

describe('settled binding atom', () => {
  it('starts unknown and resets a wallet session back to unknown', () => {
    const gate = make_gate()
    expect(gate.store.getState().world).toBeUndefined()
    gate.publish(CHAR, WORLD)
    gate.reset()
    expect(gate.store.getState()).toMatchObject({ character_id: null, world: undefined })
  })

  it('accepts a trusted membership and discards lagging polls until they agree', () => {
    const gate = make_gate()
    gate.publish(CHAR, WORLD, 'manual')
    gate.publish(CHAR, WORLD_B, 'poll')
    expect(gate.store.getState().world).toBe(WORLD)
    gate.publish(CHAR, WORLD, 'poll')
    expect(gate.store.getState().pending_manual_target.has(CHAR)).toBe(false)
    gate.publish(CHAR, WORLD_B, 'poll')
    expect(gate.store.getState().world).toBe(WORLD_B)
  })

  it('never lets a stale poll for another character re-key the active session', () => {
    const gate = make_gate()
    gate.publish(CHAR, WORLD, 'manual')
    gate.publish(OTHER_CHAR, WORLD_B, 'poll')
    expect(gate.store.getState()).toMatchObject({ character_id: CHAR, world: WORLD })
  })

  it('lets the first poll bootstrap a binding and explicit selection move it forward', () => {
    const gate = make_gate()
    gate.publish(CHAR, WORLD, 'poll')
    expect(gate.store.getState()).toMatchObject({ character_id: CHAR, world: WORLD })
    gate.input({ type: 'character_selected', character_id: OTHER_CHAR, world_id: WORLD_B })
    expect(gate.store.getState()).toMatchObject({ character_id: OTHER_CHAR, world: WORLD_B })
  })

  it('does not mutate its pending map and skips an unchanged write', () => {
    const state = create_session_gate_store().getState()
    const next = reduce_session_gate(state, {
      type: 'binding_published',
      character_id: CHAR,
      world: WORLD,
      source: 'manual',
    })
    expect(next.pending_manual_target).not.toBe(state.pending_manual_target)
    const settled = reduce_session_gate(next, {
      type: 'binding_published',
      character_id: CHAR,
      world: WORLD,
      source: 'manual',
    })
    expect(settled).toBe(next)
  })

  it('emits one data row per discarded stale poll', () => {
    const gate = make_gate()
    const rows = []
    subscribe_stale_poll(gate.store, (row) => rows.push(row))
    gate.publish(CHAR, WORLD, 'manual')
    gate.publish(CHAR, null, 'poll')
    gate.publish(CHAR, null, 'poll')
    expect(rows.map((row) => row.seq)).toEqual([1, 2])
    expect(rows[0]).toMatchObject({ character_id: CHAR, target: WORLD })
  })
})
