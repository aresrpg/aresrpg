// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CHAIN-TRUTH PARITY FOR THE PREDICT PATH (#1144) — the fight twin's first assert whose RIGHT-HAND SIDE is not
// ours. `predict_build_internal_consistency.test.js` drives predict_cast against the SIM reducer, and its own
// header says so: both halves are our modules, which `docs/CODE_LAW.md:146-149` (L-D4) calls internal
// consistency and nothing more. It was the closest thing this repo had to a fight parity gate, and it stayed
// green through a live divergence (a cast that forecast 2 HP of damage and killed the mob outright).
//
// So this pins the prediction to A CAST THE DEPLOYED PACKAGE ACTUALLY RESOLVED, the way
// `packages/sim/test/zone_chain_parity.test.js` pins the zone domain. Every input is chain bytes, and the
// fixture's `_provenance` names where each came from:
//   · the STAT BLOCKS and the board — the live Fight object (`sui client object`, version + digest recorded);
//   · the SPELL — both the shared SpellTemplate object AND the `ActionResolved` event's own `spell_level`, the
//     exact row the chain resolved this cast with, inside the transaction;
//   · the OUTCOME — the `Hit` event: `amount 5`, `remaining_hp 7`, victim mob 0. Not a client fold of it.
// The pre-cast state is chain-derived too (see the fixture note): the seat's HP is the PREVIOUS transaction's
// Hit, and both mobs sit at max_hp because no `Hit{victim_is_mob:true}` exists anywhere earlier in this fight's
// event history.
//
// If predict_cast reproduces that Hit from those bytes, the number the client paints and the number the chain
// settles are the same math on the same inputs. When it stops reproducing it, THIS is the gate that says so.
//
// THE CRIT BRANCH IS PART OF THE PIN. A fight is seed-deterministic and the chain recorded which branch it took
// (`critical: false`, roll 9884 of bound 10000). The test asserts the recorded branch reproduces the chain's
// number AND that the other branch does not — a fixture that matched either way would prove nothing.

import { describe, test, expect } from 'bun:test'
import { normalize_spell_templates } from '@aresrpg/sim/spell_templates'

import { predict_cast } from '../src/predict_cast.js'
import { GRID_W, decode } from '../src/los.js'

import truth from './fixtures/parity/chain_cast_outcome.json'

const CASTER = truth.cast.caster_id
const num = (value) => Number(value)

/** The lineage that PRODUCED these bytes, as the fixture itself recorded it — this binding's only authority. */
const capture = truth._provenance
const CAPTURED = { engine: capture.engine_package, spells: capture.spell_package }
const is_capture_lineage = (name, package_id) => CAPTURED[name] === package_id
const ID_RE = /^0x[0-9a-f]{64}$/

/** Chain stat blocks are u64 strings; the sim reads numbers. A cast, never a computation. */
const stats_of = (block) => Object.fromEntries(Object.entries(block).map(([key, value]) => [key, num(value)]))

/**
 * The board the chain holds → the walkability mask every fight surface pathfinds and traces LoS over: a cell is
 * blocked when the chain lists it as an obstacle or a hole. Cell ids are the canonical stride-20 encoding on
 * both sides (`los.js`), which is why a 17-wide board still names cell 67 as (7,3).
 */
const arena_of = (board) => {
  const blocked = new Set([...board.obstacles, ...board.holes].map(num))
  return {
    width: num(board.width),
    height: num(board.height),
    cells: Array.from({ length: GRID_W * GRID_W }, (_, index) => (blocked.has(index) ? 1 : 0)),
  }
}

/** The `view` shape every predicting surface passes `predict_cast`, built from the captured chain rows. */
const chain_view = () => {
  const { participant, mobs, board } = truth.fight_object_chain
  const fighters = new Map()
  fighters.set(CASTER, {
    id: CASTER,
    name: 'alice',
    team: 0,
    cell: decode(truth.pre_cast.seat_cell_encoded),
    health: truth.pre_cast.seat_hp,
    health_max: num(participant.max_hp),
    ap: truth.pre_cast.seat_ap,
    ap_max: num(participant.base_ap),
    mp: truth.pre_cast.seat_mp,
    mp_max: num(participant.base_mp),
    is_player: true,
    level: num(participant.level),
    class_id: participant.class,
    base_range: 0,
    base_stats: stats_of(participant.base_stats),
    // the chain's `spell_levels` VecMap is empty for this seat — every spell rides its free rank 1, which is
    // exactly what the transaction recorded (`learned_level: 1`).
    spell_levels: {},
    effects: [],
  })
  mobs.forEach((mob, index) => {
    fighters.set(`mob-${index}`, {
      id: `mob-${index}`,
      name: `mob-${index}`,
      team: 1,
      cell: decode(truth.pre_cast.mob_cells_encoded[index]),
      health: truth.pre_cast.mob_hp[index],
      health_max: num(mob.max_hp),
      ap: num(mob.ap),
      ap_max: num(mob.ap),
      mp: num(mob.mp),
      mp_max: num(mob.mp),
      is_player: false,
      level: num(mob.level),
      base_range: 0,
      base_stats: stats_of(mob.base_stats),
      effects: [],
    })
  })
  return {
    fight_id: truth._provenance.fight,
    arena: arena_of(board),
    turn_number: truth.pre_cast.turn_number,
    turn_order: [CASTER, ...mobs.map((_, index) => `mob-${index}`)],
    my_traps: [],
    my_entity_id: CASTER,
    fighters,
  }
}

/** The mapping every fight surface hands predict_cast (a mob rides 'mob-N', the seat rides its escrow index). */
const ref_of = (id) => {
  const mob = /^mob-(\d+)$/.exec(String(id))
  return mob ? { is_mob: true, idx: Number(mob[1]) } : { is_mob: false, idx: 0 }
}

/**
 * THE CHAIN'S OWN SPELL ROW, as the template `predict_cast` takes. `chain_action_resolved.spell_level` is the
 * SpellLevel the transaction resolved this cast with — the tightest anchor available, because it is inside the
 * receipt rather than fetched beside it. `normalize_spell_templates` is the ONE corpus door; its input field
 * names are the Move struct's, so the event's bytes ride in unchanged.
 */
const chain_spell = () =>
  normalize_spell_templates([
    {
      id: truth.cast.spell_object_id,
      name: truth.cast.spell_name,
      levels: [truth.chain_action_resolved.spell_level],
    },
  ]).get(truth.cast.spell_object_id)

const predicted = (critical) =>
  predict_cast({
    view: chain_view(),
    caster_id: CASTER,
    spell: chain_spell(),
    spell_level: truth.cast.spell_level,
    target_cell: truth.cast.target_cell_encoded,
    critical,
    resolve_ref: ref_of,
  })?.actions.find((action) => action.kind === 'Hit' && action.victim_is_mob && action.victim_idx === 0)

describe('predict_cast ↔ LIVE chain parity (a cast the deployed package resolved, testnet)', () => {
  test('the fixture is chain-sourced: its provenance names the package, the fight and the transaction', () => {
    // A fixture without provenance is one nobody can re-derive — the zone-parity precedent, verbatim.
    expect(truth._provenance.network).toBe('testnet')
    expect(truth._provenance.engine_package).toMatch(/^0x[0-9a-f]{64}$/)
    expect(truth._provenance.fight).toMatch(/^0x[0-9a-f]{64}$/)
    expect(truth._provenance.cast_digest).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/) // base58 tx digest
    expect(truth.spell_template_chain.objectId).toBe(truth.cast.spell_object_id)
    // the outcome is the CHAIN's event, not a client fold of it
    expect(truth.chain_after.hit.victim_is_mob).toBe(true)
    expect(Number(truth.chain_after.hit.remaining_hp)).toBe(truth.chain_after.target_hp_committed)
  })

  test('THE PARITY ASSERT: the predicted post-cast HP is the HP the CHAIN committed', () => {
    expect(predicted(truth.cast.chain_took_critical)?.remaining_hp).toBe(truth.chain_after.target_hp_committed)
  })

  test('and the damage itself matches the Hit event, not just the resting HP', () => {
    const [before] = truth.pre_cast.mob_hp
    expect(before - Number(predicted(truth.cast.chain_took_critical)?.remaining_hp)).toBe(
      truth.chain_after.damage_dealt
    )
  })

  test('the pin is discriminating — the branch the chain did NOT take lands somewhere else', () => {
    expect(predicted(!truth.cast.chain_took_critical)?.remaining_hp).not.toBe(truth.chain_after.target_hp_committed)
  })

  // PROVENANCE BINDING (#1189, re-cut). A chain-truth fixture is chain truth about the bytecode that PRODUCED it,
  // so the lineage the fixture recorded is what these bytes must be read against — never whatever release.json
  // points at today. This binding used to compare the recording to the CURRENT pins, which coupled a capture to an
  // unrelated event: a republish moves the pins, but it does not retroactively change which package resolved this
  // cast, so the fixture went red for a reason that was not about its own correctness. Re-capturing on a fresh
  // lineage is a POST-ENABLE CEREMONY LEG (the new packages are dark until `--enable`, and this capture needs a
  // seeded world and a real driven fight); that leg rewrites `_provenance` — `superseded` included — and this
  // binding keeps working unchanged. What still guards the damage math is the parity assert above: it is read
  // against the recorded lineage, and the re-capture leg is what re-proves it on the lineage we actually call.
  test('the fixture records the lineage that produced these bytes', () => {
    expect(capture.network).toBeTruthy()
    expect(capture.engine_package).toMatch(ID_RE)
    expect(capture.spell_package).toMatch(ID_RE)
    expect(capture.captured).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('the binding discriminates — every id outside the capture lineage is REJECTED', () => {
    // REAL dead ids, recorded beside the capture: what each package had already retired when these bytes were read.
    // A predicate that said `true` here would be a green light with nothing behind it — the failure #1189 was filed
    // about. Each set is asserted NON-EMPTY before it is walked: sourcing these from a live artifact is exactly how
    // this loop silently went vacuous the day a republish emptied that artifact's retired lists.
    for (const name of ['engine', 'spells']) {
      const superseded = capture.superseded?.[name] ?? []
      expect(superseded.length, name).toBeGreaterThan(0)
      for (const dead of superseded) expect(is_capture_lineage(name, dead), `${name} ${dead}`).toBe(false)
    }
  })

  test('the shared SpellTemplate object agrees with the row the receipt resolved with', () => {
    // Two independent chain reads of the same authored number: the object beside the transaction, and the
    // transaction's own copy. If they ever disagree, the capture is stale and this fixture must be re-taken.
    const object_row = truth.spell_template_chain.content.levels[truth.cast.spell_level - 1]
    const receipt_row = truth.chain_action_resolved.spell_level
    expect(object_row.effects).toEqual(receipt_row.effects)
    expect(object_row.ap_cost).toBe(receipt_row.ap_cost)
    expect(String(object_row.crit_rate)).toBe(String(receipt_row.crit_rate))
  })
})
