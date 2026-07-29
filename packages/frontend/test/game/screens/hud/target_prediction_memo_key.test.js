// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1480 — a rendered +% damage buff never reached the hover damage preview: Full Draw folded, the caster's card
// painted "+110% Damage", and the number stayed at 108 where 226 was due.
//
// The derivation was never the gap: `compute_target_prediction` hands the whole fight view to `predict_cast`, and
// `statuses.sim_effects_of` promotes the K_ALTER_STAT/stat-8 row into the sim vocabulary — the first test below is
// that oracle, and it passes on both sides of the fix. The gap was the CACHE in front of it. The hook memoized on a
// hand-listed key (armed id · caster id · hovered id · its cell · its hp · dungeon · slot) that named nothing about
// the CASTER's status block, so a buff landing on me moved no key element and the held hover kept serving the
// pre-buff number the resolver had already stopped agreeing with.
//
// So the law under test is the cache's, and it is pure — no React, no DOM, no module stubs:
//   two states that derive DIFFERENT predictions must never share a memo key.
// Compared element-wise with Object.is, exactly as React compares a deps array. RED before the fix on the key
// assertion alone (108 ≠ 226 already, the keys were identical); GREEN after, because the key is now derived from
// the same args object the derivation reads.

import { afterEach, describe, expect, test } from 'bun:test'
import { board_view, engine_view } from '@aresrpg/fight/project'
import { fight_store } from '@aresrpg/fight/store'
import { K_ALTER_STAT, STAT_PERCENT_DAMAGE } from '@aresrpg/sim/spell_effect'
import { WEAPON_ATTACK_ID } from '@aresrpg/fight/weapon'

import { reset_fight_core, seed_fight_core } from '../../../../src/test_helpers/fight_core_harness.js'
import {
  compute_target_prediction,
  prediction_memo_key,
} from '../../../../src/game/screens/hud/target_prediction_core.js'
import { predicted_target_outcome } from '../../../../src/game/screens/hud/target_outcome.js'

const CASTER = '0xme'
const CASTER_CELL = 100
const MOB_CELL = 101
const MOB_HP = 900
// The live repro's own numbers: a 108-damage strike that a +110% buff must carry to 226. Weapon-armed (not a seed
// spell) so this runs unconditionally — the #117 missing-corpus class never touches the weapon path.
const WEAPON = { ap_cost: 2, damage: 108, crit_rate: 0, reach: 8 }
const FULL_DRAW = {
  fighter: 0, // seat 0 = the caster; the chain's own numeric fighter id, as the snapshot door reads it
  kind: K_ALTER_STAT,
  stat: STAT_PERCENT_DAMAGE,
  value: 110,
  remaining_turns: 2,
  element: null,
  chance: null,
}

const HOVER = { entity_id: 'mob-0', x: 0, y: 0 }

/** Seed the REAL fight core, arm the weapon, and project the two live slices the hook reads. */
const armed = (statuses) => {
  reset_fight_core() // reset-BEFORE-use: the core is one module instance for the whole run
  seed_fight_core({
    seats: [{ character: CASTER, cell: CASTER_CELL, ap: 6, mp: 3, weapon: WEAPON }],
    mobs: [{ template: '0xabc', hp: MOB_HP, max_hp: MOB_HP, cell: MOB_CELL, ap: 4, mp: 3, level: 1 }],
    statuses,
  })
  fight_store.getState().input({ type: 'arm', spell_id: WEAPON_ATTACK_ID })
  const state = fight_store.getState()
  return { fight: engine_view(state), dungeon: board_view(state) }
}

/**
 * The live moment the repro describes: ONE hover held over ONE mob while a buff folds onto ME. Only the fight view
 * moves — a status folding in the fight core re-reads no dungeon and drafts no cast, so `dungeon` and `slot` are
 * deliberately the SAME values on both sides. (Handing each side its own freshly projected `dungeon` is what makes
 * this fixture lie: the key would then differ for a reason the live bug never had.)
 */
const held_hover_pair = () => {
  const before = armed([])
  const after = armed([FULL_DRAW])
  return [
    { fight: before.fight, hover: HOVER, dungeon: before.dungeon, slot: 0 },
    { fight: after.fight, hover: HOVER, dungeon: before.dungeon, slot: 0 },
  ]
}

/** The life the hovered mob actually loses in the previewed strike. */
const previewed_damage = (args) => {
  const { prediction, target_ref } = compute_target_prediction(args)
  return -predicted_target_outcome(prediction, target_ref, MOB_HP).delta
}

/** React's own deps comparison — a memo is REUSED exactly when this is true. */
const same_key = (a, b) => a.length === b.length && a.every((value, i) => Object.is(value, b[i]))

afterEach(() => reset_fight_core())

describe('the hover preview cache (#1480)', () => {
  test('the derivation itself already prices the +110% buff — the oracle the cache must not outlive', () => {
    const [plain, buffed] = held_hover_pair()
    expect(buffed.fight.fighters.get(CASTER).effects).toHaveLength(1) // the SAME home the caster card paints from
    expect(previewed_damage(plain)).toBe(108)
    expect(previewed_damage(buffed)).toBe(226)
  })

  test('RED: a buff that changes the previewed number must change the memo key', () => {
    const [plain, buffed] = held_hover_pair()

    // FIXTURE PREMISE, pinned so this can never pass for the wrong reason: everything outside the fight view is
    // literally the same value on both sides, so a key that moves here moved because the fight view did.
    expect(buffed.dungeon).toBe(plain.dungeon)
    expect(buffed.hover).toBe(plain.hover)
    expect(buffed.slot).toBe(plain.slot)
    // And nothing about the AIM moved either: same armed weapon, same caster, same hovered mob, same cell, same hp.
    // Only the caster's status block did — precisely what the old hand-listed key had no element for.
    expect(previewed_damage(plain)).not.toBe(previewed_damage(buffed))

    expect(same_key(prediction_memo_key(plain), prediction_memo_key(buffed))).toBe(false)
  })

  test('a bare cursor move over the SAME target does not re-key (why `hover` is read by id, not by identity)', () => {
    // `fight_hover` is re-created on every pointermove — it carries the cursor's x/y — so keying on the object
    // itself would re-run the sim per mouse pixel. The id is the only field the derivation reads.
    const [args] = held_hover_pair()
    const moved = { ...args, hover: { entity_id: 'mob-0', x: 512, y: 384 } }

    expect(previewed_damage(moved)).toBe(previewed_damage(args))
    expect(same_key(prediction_memo_key(args), prediction_memo_key(moved))).toBe(true)
  })
})
