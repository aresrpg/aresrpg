// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE SPELL-EFFECT CONFORMANCE MATRIX ENGINE (pure; no bun:test — imported by the .test.js gate AND by the
// MATRIX_CONVICTIONS.md generator, so the conviction computation has ONE HOME).
//
// Owner survival mechanism, verbatim: "we have 270 spells, if not 100% of effects are fully tested and
// functional, how are we gonna survive?"
//
// effect_kind_matrix.test.js already proves every K_* discriminant EXECUTES deterministically on synthetic
// spells. This is the ORTHOGONAL axis: load the REAL mainnet corpus (seed/mainnet/spells — the on-chain class
// spell set packages/validation gates), and for EACH effect a template declares, drive an ISOLATED minimal
// fight through `process_spell_cast` and assert the effect-class POSTCONDITION actually happened in
// FightState — not merely that a cast ran.
//
// ONE-HOME VOCABULARY LAW: the postcondition classes are read from the sim's OWN effect algebra — the K_*
// enum (spell_effect.js), what `normalize_effect` maps each kind to, and how apply_spell_effect /
// apply_retro_effect / apply_stat_effect resolve it. No parallel taxonomy is invented. A kind the reducer's
// pattern-match does NOT handle is a CONVICTION (reported, never "fixed" here — reducer source is READ-ONLY).

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { process_spell_cast } from '../src/fight_spells.js'
import { find_entity } from '../src/fight_state.js'
import { create_fight_state } from '../src/reduce.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import * as SE from '../src/spell_effect.js'

// ── The corpus: every class spell file (auto-discovered, like validation/spell_kit_laws.test.ts) ─────
// MISSING-ARTIFACT (settled #96): seed/mainnet/spells is generated content authored+published by the
// content pipeline and reaches the game as chain state + CDN assets — it never enters this repo (CLAUDE.md,
// "The content boundary"), so this gate is PERMANENT by design, not pending work. #746 verified the path is
// real and still the one the corpus would occupy. Degrade to an empty corpus rather
// than throw — every OTHER export in this file (fresh_state, single_effect_spell, run_matrix, …) is pure/
// synthetic and must stay usable with zero real spells loaded; consumers that genuinely need real corpus
// rows gate themselves on SPELLS_CORPUS_AVAILABLE.
const SPELLS_DIR = fileURLToPath(
  new URL('../../../seed/mainnet/spells', import.meta.url),
)
export const SPELLS_CORPUS_AVAILABLE = existsSync(SPELLS_DIR)
export const CORPUS = SPELLS_CORPUS_AVAILABLE
  ? readdirSync(SPELLS_DIR)
      .filter(f => f.endsWith('.json'))
      .flatMap(f => JSON.parse(readFileSync(`${SPELLS_DIR}/${f}`, 'utf8')))
  : []

export const KIND_NAME = kind =>
  Object.keys(SE).find(n => n.startsWith('K_') && SE[n] === kind) ?? `K_${kind}`

// ── Effect-CLASS of each kind = its DECLARED intent, read from the sim's own vocabulary ──────────────
// (spell_effect.js K_* names + normalize_effect's target type + how apply_spell_effect resolves it).
export const CLASS_OF = {
  [SE.K_DAMAGE]: 'damage',
  [SE.K_PERCENT_LIFE_DAMAGE]: 'damage',
  [SE.K_LIFE_STEAL]: 'damage',
  [SE.K_CASTER_DAMAGE]: 'damage',
  [SE.K_PUNISHMENT_DAMAGE]: 'damage',
  [SE.K_HEAL]: 'heal',
  [SE.K_GIVE_POINTS]: 'points_gain',
  [SE.K_REMOVE_POINTS]: 'points_loss',
  [SE.K_STEAL_POINTS]: 'points_loss',
  [SE.K_ALTER_STAT]: 'stat',
  [SE.K_STEAL_STAT]: 'stat',
  [SE.K_ALTER_RESIST]: 'stat',
  [SE.K_PUSH]: 'displace',
  [SE.K_PULL]: 'displace',
  [SE.K_TELEPORT]: 'teleport',
  [SE.K_SWAP_POSITIONS]: 'displace',
  [SE.K_CARRY]: 'displace',
  [SE.K_THROW]: 'displace',
  [SE.K_PLACE_TRAP]: 'trap',
  [SE.K_PLACE_GLYPH]: 'glyph',
  [SE.K_APPLY_DOT]: 'dot',
  [SE.K_APPLY_STATE]: 'status',
  [SE.K_REDUCE_DAMAGE]: 'shield',
  [SE.K_REFLECT_DAMAGE]: 'status',
  [SE.K_DISPEL]: 'dispel',
  [SE.K_INVISIBILITY]: 'invis',
  [SE.K_REVEAL]: 'reveal',
  [SE.K_RETURN_SPELL]: 'status',
}

// THE BURN-DOWN WORKLIST — kinds the reducer's pattern-match does NOT resolve (proven empirically by this
// matrix). Each maps a `normalize_effect` gap (→ internal type 'UNSUPPORTED' → apply_spell_effect no-op).
// 2026-07-18 advance (seat ruling, DECISIONS 23:00): PERCENT_LIFE_DAMAGE, STEAL_POINTS, ALTER_RESIST and
// PLACE_GLYPH implemented by the spell-campaign lane (6768142b) — dropped from the worklist; the remaining
// eight are RULED implement-all (chain arms = next train's cargo; sim mirrors may land first, matrix-gated).
// 2026-07-18 23:4x advances: K_APPLY_STATE (record_timed mirror) and K_STEAL_STAT (alter_stat
// debit+mirror-buff) implemented by spell-campaign kind lanes — then the displacement trio (fb49acbd: SWAP/CARRY/THROW) — 39 slots closed; 3 kinds / 9 slots remain
// (REFLECT 6 · DISPEL 2 · RETURN_SPELL 1), all ruled implement-all (chain arms ride the next train).
// 2026-07-19 00:2x: REFLECT_DAMAGE + DISPEL + RETURN_SPELL landed (status-kinds lane) — THE WORKLIST
// IS EMPTY: all 121 original convictions resolved sim-side; chain arms for the 8 ruled kinds ride the
// next train (B7 guards the client boundary until then). An entry here from now on = a REGRESSION.
export const KNOWN_UNSUPPORTED = new Map([])

// ── Minimal headless board (per drive; fresh so drives never bleed) ──────────────────────────────────
// caster p0 WOUNDED (a self-heal must show HP rise), ally p1 WOUNDED (ally-heal shows rise), enemy m0 FULL
// (damage shows a drop). Zero stats/resist so a value-N effect lands its full N (normalize sets min=max=value).
export const MATRIX_ARENA = {
  width: 9,
  height: 9,
  radius: 4,
  center: { x: 4, y: 4 },
  cells: new Uint8Array(81),
  spawns_a: [],
  spawns_b: [],
}
export const CASTER_CELL = { x: 2, y: 4 }
export const ALLY_CELL = { x: 2, y: 5 }
export const ENEMY_CELL = { x: 4, y: 4 }
export const EMPTY_CELL = { x: 6, y: 6 } // open ground for teleport / trap / glyph destinations

const make_fighter = (
  id,
  cell,
  is_player,
  health,
  health_max,
  effects = [],
) => ({
  id,
  name: id,
  cell,
  health,
  health_max,
  ap: 99,
  ap_max: 99,
  mp: 20,
  mp_max: 20,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'matrix',
  level: 50,
  stats: {},
  effects,
  spell_levels: {},
  ap_reserve: 0,
})

export const fresh_state = (extra_caster_effects = []) => {
  const caster = make_fighter(
    'p0',
    CASTER_CELL,
    true,
    120,
    200,
    extra_caster_effects,
  )
  const ally = make_fighter('p1', ALLY_CELL, true, 30, 100)
  const enemy = make_fighter('m0', ENEMY_CELL, false, 200, 200)
  return {
    ...create_fight_state({
      fight_id: 'matrix',
      arena_seed: 1,
      arena_radius: 4,
      arena: MATRIX_ARENA,
      team0: [caster, ally],
      team1: [enemy],
    }),
    started: true,
    turn_order: ['p0', 'p1', 'm0'],
    turn_number: 1,
  }
}

// A single-effect spell carrying the REAL declared effect (level 1). free_cell only for placement/teleport.
export const single_effect_spell = (
  id,
  raw_effect,
  ap_cost,
  free_cell,
  normalize_templates = normalize_spell_templates,
) =>
  normalize_templates([
    {
      id,
      levels: [
        {
          ap_cost,
          range_min: 0,
          range_max: 9,
          modifiable_range: false,
          line_launch: false,
          line_of_sight: false,
          free_cell: !!free_cell,
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          crit_rate: 0,
          effects: [{ ...raw_effect, chance: 100 }],
          crit_effects: [],
        },
      ],
    },
  ]).get(id)

export const CAST_CTX = { blocks_los: () => false, is_occupied: () => false }

// Who does this effect hit, from its target_filter (spell_targeting.effect_hits semantics)?
export const victim_of = target_filter => {
  const tf = target_filter ?? 0
  if ((tf & SE.TF_ONLY_CASTER) === SE.TF_ONLY_CASTER) return 'caster'
  if (tf === SE.TF_NONE) return 'zone'
  if (
    (tf & SE.TF_NOT_ENEMY) === SE.TF_NOT_ENEMY &&
    (tf & SE.TF_NOT_TEAM) !== SE.TF_NOT_TEAM
  )
    return 'ally'
  return 'enemy'
}

const row_tags = result =>
  (result.effects ?? []).map(
    e =>
      e.status ??
      (e.damage != null
        ? 'dmg'
        : e.heal != null
          ? 'heal'
          : e.has_cell
            ? 'moved'
            : '?'),
  )

// ── The driver: cast ONE declared effect in isolation, return a conviction or null ───────────────────
// A conviction = the effect's class POSTCONDITION did not hold in the resulting FightState.
export const drive_effect = (
  spell_id,
  slot,
  raw,
  cast_spell = process_spell_cast,
  normalize_templates = normalize_spell_templates,
) => {
  const { kind } = raw
  const cls = CLASS_OF[kind]
  const conviction = detail => ({
    spell_id,
    slot,
    kind,
    name: KIND_NAME(kind),
    cls,
    detail,
  })
  if (cls === undefined)
    return conviction(`unclassified kind ${kind} — matrix has no class row`)

  const vk = victim_of(raw.target_filter)
  const placing = cls === 'trap' || cls === 'glyph' || cls === 'teleport'
  const state = fresh_state([])
  // dispel needs a live dispellable buff on its victim to observe a strip.
  if (cls === 'dispel') {
    const enemy = find_entity(state, 'm0')
    enemy.effects = [
      {
        id: 987654,
        type: 'STAT_BUFF',
        timing: 'TURN_START',
        source_id: 'seed',
        stat: 'strength',
        value: 5,
        turns_remaining: 3,
        flags: SE.FLAG_DISPELLABLE,
      },
    ]
  }

  const victim_id =
    cls === 'teleport' || vk === 'caster'
      ? 'p0'
      : vk === 'ally'
        ? 'p1'
        : vk === 'zone'
          ? null
          : 'm0'
  const target =
    cls === 'teleport'
      ? EMPTY_CELL
      : placing
        ? EMPTY_CELL
        : vk === 'caster'
          ? CASTER_CELL
          : vk === 'ally'
            ? ALLY_CELL
            : vk === 'zone'
              ? EMPTY_CELL
              : ENEMY_CELL

  const before_victim = victim_id ? find_entity(state, victim_id) : null
  const spell = single_effect_spell(
    `matrix_${kind}`,
    raw,
    3,
    placing,
    normalize_templates,
  )
  let res
  try {
    res = cast_spell(state, 'p0', spell, 1, target, CAST_CTX)
  } catch (err) {
    return conviction(
      `process_spell_cast THREW: ${String(err?.message ?? err).slice(0, 80)}`,
    )
  }
  if (!res.success) return conviction(`cast rejected: ${res.error}`)

  const after = res.state
  const v = victim_id ? find_entity(after, victim_id) : null
  const b = before_victim
  const caster_after = find_entity(after, 'p0')
  const tags = row_tags(res)
  const value = raw.value ?? 0

  const gained_effect = type_pred =>
    v.effects.some(type_pred) && v.effects.length > b.effects.length

  switch (cls) {
    case 'damage':
      // Postcondition: target HP decreased (no corpus victim carries a shield, so a working damage effect
      // MUST drop HP; every corpus damage effect declares value>0 — verified). A shield-absorb board would
      // instead assert the shield row shrank; not exercised here on purpose (keeps the checker un-foolable).
      if (v.health < b.health) return null
      return conviction(
        `hp unchanged ${b.health}->${v.health} (expected a decrease; value=${value})`,
      )
    case 'heal':
      if (v.health > b.health && v.health <= v.health_max) return null
      return conviction(
        `hp not healed ${b.health}->${v.health} (max ${v.health_max})`,
      )
    case 'points_gain':
      if (
        v.ap + v.mp > b.ap + b.mp ||
        v.effects.some(
          e => e.type === 'STAT_BUFF' && (e.stat === 'ap' || e.stat === 'mp'),
        )
      )
        return null
      return conviction(`ap/mp not gained ${b.ap}/${b.mp}->${v.ap}/${v.mp}`)
    case 'points_loss':
      if (
        v.ap + v.mp < b.ap + b.mp ||
        tags.includes('POINT_DODGED') ||
        v.effects.some(e => e.type === 'STAT_DEBUFF')
      )
        return null
      return conviction(
        `ap/mp not removed ${b.ap}/${b.mp}->${v.ap}/${v.mp} (rows=${tags.join(',') || 'none'})`,
      )
    case 'stat':
      if (
        v.effects.some(e => e.type === 'STAT_BUFF' || e.type === 'STAT_DEBUFF')
      )
        return null
      return conviction(
        `no stat modifier row applied (effects ${b.effects.length}->${v.effects.length})`,
      )
    case 'displace':
      if (v.cell.x !== b.cell.x || v.cell.y !== b.cell.y) return null
      return conviction(`victim did not move (stayed ${b.cell.x},${b.cell.y})`)
    case 'teleport':
      if (caster_after.cell.x === target.x && caster_after.cell.y === target.y)
        return null
      return conviction(
        `caster not teleported (at ${caster_after.cell.x},${caster_after.cell.y}, target ${target.x},${target.y})`,
      )
    case 'trap':
      if (after.traps.length > state.traps.length) return null
      return conviction(
        `no trap placed (traps ${state.traps.length}->${after.traps.length})`,
      )
    case 'glyph':
      if (after.glyphs.length > state.glyphs.length) return null
      return conviction(
        `no glyph placed (glyphs ${state.glyphs.length}->${after.glyphs.length})`,
      )
    case 'dot':
      if (gained_effect(e => e.timing === 'TURN_START' && e.type === 'DAMAGE'))
        return null
      return conviction(`no DoT row applied (rows=${tags.join(',') || 'none'})`)
    case 'shield':
      if (gained_effect(e => e.type === 'SHIELD')) return null
      return conviction(
        `no shield row applied (rows=${tags.join(',') || 'none'})`,
      )
    case 'invis':
      if (gained_effect(e => e.type === 'INVISIBILITY')) return null
      return conviction(
        `no invisibility row applied (rows=${tags.join(',') || 'none'})`,
      )
    case 'reveal':
      if (tags.includes('REVEAL')) return null
      return conviction(
        `reveal did not resolve (rows=${tags.join(',') || 'none'})`,
      )
    case 'status':
      if (v.effects.length > b.effects.length) return null
      return conviction(
        `no status row applied (effects ${b.effects.length}->${v.effects.length})`,
      )
    case 'dispel':
      if (!v.effects.some(e => e.id === 987654)) return null
      return conviction(
        'dispellable buff still present (dispel did not strip it)',
      )
    default:
      return conviction(`unhandled class '${cls}'`)
  }
}

// ── Run the whole corpus once (pure, deterministic) ──────────────────────────────────────────────────
export const run_matrix = (
  cast_spell = process_spell_cast,
  normalize_templates = normalize_spell_templates,
) => {
  const convictions = []
  const kinds_seen = new Set()
  let drives = 0
  for (const spell of CORPUS) {
    const level = spell.levels?.[0]
    if (!level) continue
    for (const [tag, list] of [
      ['base', level.effects ?? []],
      ['crit', level.crit_effects ?? []],
    ]) {
      list.forEach((raw, i) => {
        drives += 1
        kinds_seen.add(raw.kind)
        const conviction = drive_effect(
          spell.id,
          `${tag}${i}`,
          raw,
          cast_spell,
          normalize_templates,
        )
        if (conviction) convictions.push(conviction)
      })
    }
  }
  return { convictions, kinds_seen, drives, spells: CORPUS.length }
}
