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
