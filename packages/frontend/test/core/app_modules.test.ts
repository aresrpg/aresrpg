// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Seals the arming separation behind the 2026-08-20 ruling: content edition lives on /demo with
// no session, and the player app never arms the seed editor (its dev-server save reloads would
// otherwise ride — and kill — a live wallet session).

import { describe, expect, test } from 'bun:test'

import { DEMO_APP_MODULES, PLAYER_APP_MODULES } from '../../src/app_modules.ts'
import { MODULE_NAMES } from '../../src/store.ts'

describe('app module arming sets', () => {
  test('the player app never arms the seed editor', () => {
    expect(PLAYER_APP_MODULES).not.toContain('editor')
    expect(PLAYER_APP_MODULES).toContain('session')
  })

  test('the player app arms every multiplayer effect observer (the silent-death class)', () => {
    // an unarmed observer is invisible to every unit test that wires modules directly:
    // chat (2026-08-20) and duel/fight_chain (2026-08-21) each died this way in the real app
    expect(PLAYER_APP_MODULES).toContain('chat')
    expect(PLAYER_APP_MODULES).toContain('duel')
    expect(PLAYER_APP_MODULES).toContain('fight_chain')
    expect(PLAYER_APP_MODULES).toContain('party_follow')
    expect(PLAYER_APP_MODULES).toContain('run_to')
    expect(PLAYER_APP_MODULES).toContain('job_level_up')
    // the world observer fires the zone-search transaction (2026-08-22) — it was the exempted
    // "reduce-only" module until it grew an effect, which is exactly how the exemption below
    // turns from documentation into a trap
    expect(PLAYER_APP_MODULES).toContain('world')
  })

  test('EVERY registered module is armed somewhere, or consciously exempted (3 kills in 2 days)', () => {
    // chat (08-20) · duel/fight_chain (08-21) · claims (08-21, "Collecting…" forever): a module
    // registered in MODULES but absent from both arming sets has a dead observer in every real
    // app while every unit test stays green. Adding a name here is a DECISION, not a default.
    // EMPTY ON PURPOSE. Every registered module is armed somewhere. The one entry that used to
    // live here ('world', "reduce-only") went stale the moment that module grew an effect —
    // an exemption is a claim about a file that can quietly stop being true, so re-adding one
    // means accepting that job.
    const exempt = new Set<string>()
    const armed = new Set<string>([...PLAYER_APP_MODULES, ...DEMO_APP_MODULES])
    const dead = MODULE_NAMES.filter((name) => !armed.has(name) && !exempt.has(name))
    expect(dead).toEqual([])
  })

  test('the demo lab arms the editor and never the session/link stack', () => {
    expect(DEMO_APP_MODULES).toContain('editor')
    expect(DEMO_APP_MODULES).not.toContain('session')
    expect(DEMO_APP_MODULES).not.toContain('navigation')
  })
})
