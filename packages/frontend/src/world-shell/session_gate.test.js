// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// W1 ADAPTER suite — the fold/projection semantics live in @aresrpg/world/src/session_gate.test.js (ported
// there with the core). THIS file proves the frontend edge: the one singleton atom behind the wrapper
// vocabulary, the W1 fold-completion contract visible through it (pending IN the atom, the failsafe as an
// effect-request output, time as input, the stale-poll data row), and the REAL timer edge — a failsafe
// deadline actually fires a join_timeout back through the door (coverage the module-scope runtime never had).

import { describe, expect, it, beforeEach } from 'bun:test'

import {
  use_world_binding,
  publish_world_binding,
  rebind_world_character,
  begin_join,
  end_join,
  reset_world_binding,
} from './session_gate.js'

const CHAR = `0x${'3'.repeat(64)}`
const WORLD = `0x${'7'.repeat(64)}`

beforeEach(() => reset_world_binding())

describe('the session-gate adapter — one singleton atom behind the wrapper vocabulary', () => {
  it('publish → getState reflects the binding; a stale poll is discarded (core guard through the wrapper)', () => {
    publish_world_binding(CHAR, WORLD, 'manual')
    expect(use_world_binding.getState().world).toBe(WORLD)
    publish_world_binding(CHAR, null, 'poll') // indexer-lagged doc poll
    expect(use_world_binding.getState().world).toBe(WORLD)
  })

  it('the atom carries pending_manual_target (a Map) — not a module-scope runtime', () => {
    publish_world_binding(CHAR, WORLD, 'manual')
    const { pending_manual_target } = use_world_binding.getState()
    expect(pending_manual_target instanceof Map).toBe(true)
    expect(pending_manual_target.get(CHAR)).toBe(WORLD)
  })

  it('begin_join outputs the failsafe EFFECT REQUEST in the atom; end_join clears it', () => {
    begin_join(CHAR)
    const { failsafe, joining } = use_world_binding.getState()
    expect(joining).toBe(true)
    expect(failsafe?.character_id).toBe(CHAR)
    expect(typeof failsafe?.deadline).toBe('number')
    end_join()
    expect(use_world_binding.getState()).toMatchObject({ joining: false, failsafe: null })
  })

  it('time is an input: input(msg, now) stamps deadline = now + 30_000', () => {
    const NOW = 1_000_000
    use_world_binding.getState().input({ type: 'join_started', character_id: CHAR }, NOW)
    expect(use_world_binding.getState().failsafe?.deadline).toBe(NOW + 30_000)
    end_join()
  })

  it('a discarded stale poll lands as a DATA row in the atom, not only a log side-effect', () => {
    publish_world_binding(CHAR, WORLD, 'manual')
    publish_world_binding(CHAR, null, 'poll')
    const { stale_poll } = use_world_binding.getState()
    expect(stale_poll?.character_id).toBe(CHAR)
    expect(stale_poll?.target).toBe(WORLD)
  })

  it('THE TIMER EDGE FIRES: an expired failsafe deadline dispatches join_timeout through the door', async () => {
    // Dispatch join_started with `now` in the past — the deadline is already due, so the adapter's timer
    // arms at 0ms and the release must arrive on the next tick without any manual end_join.
    use_world_binding.getState().input({ type: 'join_started', character_id: CHAR }, Date.now() - 60_000)
    expect(use_world_binding.getState().joining).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(use_world_binding.getState()).toMatchObject({ joining: false, failsafe: null })
  })

  it('rebind_world_character re-keys through the character_selected input; undefined is rejected', () => {
    begin_join(`0x${'9'.repeat(64)}`)
    rebind_world_character(CHAR, WORLD)
    expect(use_world_binding.getState()).toMatchObject({
      character_id: CHAR,
      world: WORLD,
      joining: false,
      failsafe: null,
    })
    expect(() => rebind_world_character(CHAR, undefined)).toThrow('has no indexed world binding')
    expect(() => rebind_world_character('', WORLD)).toThrow('without a character id')
  })
})
