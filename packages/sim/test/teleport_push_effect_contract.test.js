// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import { find_entity } from '../src/fight_state.js'
import { reduce } from '../src/reduce.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import { K_PUSH, K_TELEPORT, TF_ONLY_CASTER } from '../src/spell_effect.js'

import {
  arena,
  cast,
  fighter,
  spell_of,
  state_of,
} from './missing_effect_helpers.js'

// MISSING-ARTIFACT (#96): seed/mainnet/spells/senshi.json is generated content authored+published by the
// content pipeline (private repo) and is absent by design in this public repo. Guarded so the two
// synthetic-payload tests below (no real corpus dependency) still run.
const SENSHI_PATH = fileURLToPath(
  new URL('../../../seed/mainnet/spells/senshi.json', import.meta.url),
)
const SENSHI_AVAILABLE = existsSync(SENSHI_PATH)
const senshi_vault_raw = SENSHI_AVAILABLE
  ? (await import('../../../seed/mainnet/spells/senshi.json')).default.find(
      s => s.id === 'senshi_vault',
    )
  : undefined

// SIM CONTRACT — the reported "senshi teleport spell fully dead" (v1.12.29 review) is NOT a sim bug.
// Senshi's teleport spell (id senshi_vault) carries a single effect { kind:14 (K_TELEPORT), value:2,
// target_filter:32 (TF_ONLY_CASTER) }. These tests prove the deterministic reducer DOES relocate the
// caster onto the targeted free cell (both via process_spell_cast and the real senshi_vault template
// through reduce()) and DOES displace on push (kind:12). The pre-existing effect_kind_matrix only
// asserts a teleport cast EXECUTES + is deterministic, never that the caster actually MOVED — this
// closes that gap so a future packages/sim refactor can't silently break the movement contract.
// The live deadness lives DOWNSTREAM of the sim (chain teleport emits no movement event + client
// prediction is mob-only) — see the lane report; the sim is innocent.

describe('sim contract: senshi teleport + push displacement', () => {
  test('senshi teleport (kind 14) moves the caster onto the target cell', () => {
    const caster = fighter('p0', { x: 2, y: 4 }, true)
    const enemy = fighter('m0', { x: 6, y: 4 }, false)
    const state = state_of([caster], [enemy])

    const teleport = spell_of('senshi_vault', [
      {
        kind: K_TELEPORT,
        value: 2,
        target_filter: TF_ONLY_CASTER,
        chance: 100,
      },
    ])

    const target = { x: 3, y: 5 } // a free cell within range
    const result = cast(state, 'p0', teleport, target)

    expect(result.success).toBe(true)
    const moved = find_entity(result.state, 'p0')
    expect(moved.cell).toEqual(target)
  })

  test('#300 — a 1-cell move AFTER a teleport charges exactly 1 MP (from the POST-teleport cell)', () => {
    // The reported prod bug: after a senshi teleport, walking ONE adjacent cell consumed 3 MP because the
    // movement path was measured from the PRE-teleport cell. This pins the SIM twin the client + Move mirror:
    // teleport writes fighter.cell, so the subsequent move's cost is measured from the LANDING cell (1 MP),
    // never the pre-teleport distance (3). Driven end-to-end through the reducer door (cast → move), the exact
    // sequence commit_turn ships as [act_cast, act_move]. RED iff teleport never adopts the landing cell: the
    // move would then reject the path as non-contiguous from the stale origin (no move, 0 MP) — the split-position
    // disease. GREEN proves the sim is innocent; the stale home is the client draft anchor (see #300 PR).
    const caster = fighter('p0', { x: 2, y: 4 }, true)
    const enemy = fighter('m0', { x: 8, y: 8 }, false)
    const state = { ...state_of([caster], [enemy]), current_turn_idx: 0 }
    const templates = new Map([
      [
        'tp',
        spell_of('tp', [
          {
            kind: K_TELEPORT,
            value: 3,
            target_filter: TF_ONLY_CASTER,
            chance: 100,
          },
        ]),
      ],
    ])
    state.team0[0].hand = ['tp']
    state.team0[0].spell_levels = { tp: 1 }

    const landing = { x: 4, y: 4 } // Manhattan distance 2 from the start — a real teleport, not a step
    const teleported = reduce(
      state,
      { type: 'cast', entity_id: 'p0', spell_id: 'tp', target: landing },
      { spell_templates: templates, arena },
    )
    expect(find_entity(teleported.state, 'p0').cell).toEqual(landing) // twin: the caster ADOPTS the landing cell

    const mp_before = find_entity(teleported.state, 'p0').mp
    const step = { x: 4, y: 5 } // ONE cell from the LANDING cell (3 cells from the pre-teleport origin)
    const walked = reduce(
      teleported.state,
      { type: 'move', entity_id: 'p0', path: [step] },
      { arena },
    )
    const after = find_entity(walked.state, 'p0')
    expect(after.cell).toEqual(step) // the move lands adjacent — the path was contiguous from the post-teleport cell
    expect(mp_before - after.mp).toBe(1) // exactly 1 MP — measured from the landing cell, never the pre-teleport 3
  })

  test.skipIf(!SENSHI_AVAILABLE)(
    'REAL senshi_vault template teleports the caster through reduce()',
    () => {
      const caster = fighter('p0', { x: 2, y: 4 }, true)
      const enemy = fighter('m0', { x: 6, y: 4 }, false)
      const state = state_of([caster], [enemy])
      state.current_turn_idx = 0
      const seated = find_entity(state, 'p0')
      seated.hand = ['senshi_vault']
      seated.spell_levels = { senshi_vault: 1 }

      const templates = normalize_spell_templates([senshi_vault_raw])
      const target = { x: 3, y: 4 } // free cell, Manhattan distance 1 (range 1-2)
      const command = {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'senshi_vault',
        target,
      }
      const result = reduce(state, command, {
        spell_templates: templates,
        arena,
      })

      const cast_event = result.events.find(e => e.type === 'fight_cast')
      expect(cast_event).toBeTruthy()
      const moved = find_entity(result.state, 'p0')
      expect(moved.cell).toEqual(target)
    },
  )

  test('push (kind 12) displaces the enemy away from the caster', () => {
    const caster = fighter('p0', { x: 2, y: 4 }, true)
    const enemy = fighter('m0', { x: 4, y: 4 }, false)
    const state = state_of([caster], [enemy])

    const push = spell_of('push_test', [
      { kind: K_PUSH, value: 2, element: 255, chance: 100 },
    ])

    const target = { x: 4, y: 4 } // aim at the enemy
    const before = find_entity(state, 'm0').cell
    const result = cast(state, 'p0', push, target)

    expect(result.success).toBe(true)
    const displaced = find_entity(result.state, 'm0').cell
    expect(displaced).not.toEqual(before)
  })
})
