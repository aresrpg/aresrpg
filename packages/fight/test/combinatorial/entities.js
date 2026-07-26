// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE FIGHT GENERATOR (sim side) — build a chain-free deterministic fight: an arena, a yajin caster, N mobs,
// an optional 2nd player, and the spell templates. Every spell is resolved by the REAL @aresrpg/sim reducer;
// the combination spells are SYNTHESIZED single-/dual-effect templates (full control over kind + AoE shape,
// the spell_effect_conformance_matrix idiom) built through the real `normalize_spell_templates` and driven
// through the real `process_spell_cast`/`reduce`. The real mainnet corpus is ALSO loaded into the map so the
// loader path is exercised and real spells are castable by id.
//
// Cells are {x,y} sim-side; the arena is a full GRID_W×GRID_H (20×19) board so sim coordinates and the chain
// stride-20 encoding (bridge.js) align with zero ambiguity. cells[y*20+x] = 0 walkable · 1 obstacle/wall.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { create_fight_state } from '@aresrpg/sim/reduce'
import { normalize_spell_templates } from '@aresrpg/sim/spell_templates'

import * as SE from '../../../sim/src/spell_effect.js'

export { SE }
export const GRID_W = 20
export const GRID_H = 19

// ── The real mainnet corpus (every class file — the loader validation gates) ────────────────────────────────
const SPELLS_DIR = fileURLToPath(new URL('../../../../seed/mainnet/spells', import.meta.url))
export const CORPUS = readdirSync(SPELLS_DIR)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(`${SPELLS_DIR}/${f}`, 'utf8')))

// ── Arena — a full 20×19 board; obstacles carve walls for push-into-wall scenarios ──────────────────────────
export const build_arena = (obstacles = []) => {
  const cells = new Uint8Array(GRID_W * GRID_H)
  for (const o of obstacles) {
    const enc = typeof o === 'number' ? o : o.y * GRID_W + o.x
    if (enc >= 0 && enc < cells.length) cells[enc] = 1
  }
  return { width: GRID_W, height: GRID_H, radius: 9, center: { x: 10, y: 9 }, cells, spawns_a: [], spawns_b: [] }
}

// ── Fighter factory (the missing_effect_helpers idiom — every FightEntity field explicit) ────────────────────
export const make_fighter = (
  id,
  cell,
  is_player,
  { health = 100, health_max = 100, ap = 12, mp = 5, hand = [], stats = {}, level = 20 } = {}
) => ({
  id,
  name: id,
  cell,
  health,
  health_max,
  ap,
  ap_max: ap,
  mp,
  mp_max: mp,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'yajin' : '0xmob_t',
  level,
  stats,
  effects: [],
  spell_levels: Object.fromEntries(hand.map((s) => [s, 1])),
  ap_reserve: 0,
})

/** A started, mid-fight FightState with a fixed turn order (bypasses placement/RNG — the state_of idiom). */
export const build_state = ({ fight_id = 'combo', seed = 1, arena, team0, team1 }) => ({
  ...create_fight_state({ fight_id, arena_seed: seed, arena_radius: arena.radius, arena, team0, team1 }),
  started: true,
  turn_order: [...team0, ...team1].map((e) => e.id),
  turn_number: 1,
  last_total_hp: [...team0, ...team1].reduce((sum, e) => sum + e.health, 0),
})

// ── Synthesized combination spells — one authored template per effect kind / AoE shape, full control ─────────
const spell = (id, effects, { ap_cost = 3, range_max = 12, free_cell = false, line = false } = {}) => ({
  id,
  levels: [
    {
      ap_cost,
      range_min: 0,
      range_max,
      modifiable_range: false,
      line_launch: line,
      line_of_sight: false,
      free_cell,
      casts_per_turn: 255,
      casts_per_target: 255,
      cooldown_turns: 0,
      crit_rate: 0,
      effects: effects.map((e) => ({ chance: 100, ...e })),
      crit_effects: [],
    },
  ],
})

const dmg = (value, extra = {}) => ({ kind: SE.K_DAMAGE, element: 0, value, target_filter: SE.TF_NOT_TEAM, ...extra })
const aoe_dmg = (value, area_shape, area_size) => dmg(value, { area_shape, area_size })

// The synthesized matrix: id → authored template. Damage AoE covers CIRCLE/CROSS/LINE/CONE/RING (§4 taxonomy);
// the displacement family, traps (multi-cell), glyphs, invisibility/reveal, DoT, heal.
export const SYNTH = [
  spell('c_dmg', [dmg(30)], { range_max: 12 }),
  spell('c_aoe_circle', [aoe_dmg(20, SE.SHAPE_CIRCLE, 2)]),
  spell('c_aoe_cross', [aoe_dmg(20, SE.SHAPE_CROSS, 2)]),
  spell('c_aoe_line', [aoe_dmg(20, SE.SHAPE_LINE, 3)], { line: true }),
  spell('c_aoe_cone', [aoe_dmg(20, SE.SHAPE_CONE, 3)]),
  spell('c_aoe_ring', [aoe_dmg(20, SE.SHAPE_RING, 2)]), // RING is unshipped in the corpus — synthesized here
  spell('c_push', [{ kind: SE.K_PUSH, element: 255, value: 4, target_filter: SE.TF_NOT_TEAM }]),
  spell('c_pull', [{ kind: SE.K_PULL, element: 255, value: 3, target_filter: SE.TF_NOT_TEAM }]),
  spell('c_teleport', [{ kind: SE.K_TELEPORT, element: 255, value: 0, target_filter: SE.TF_ONLY_CASTER }], {
    free_cell: true,
  }),
  spell('c_swap', [{ kind: SE.K_SWAP_POSITIONS, element: 255, value: 0, target_filter: SE.TF_NOT_TEAM }]),
  spell('c_carry', [{ kind: SE.K_CARRY, element: 255, value: 0, target_filter: SE.TF_NOT_TEAM }]),
  spell('c_throw', [{ kind: SE.K_THROW, element: 255, value: 3, target_filter: SE.TF_NOT_TEAM }], { free_cell: true }),
  spell(
    'c_trap',
    [
      {
        kind: SE.K_PLACE_TRAP,
        element: 255,
        value: 0,
        area_shape: SE.SHAPE_CIRCLE,
        area_size: 1,
        target_filter: SE.TF_NONE,
      },
      dmg(25),
    ],
    { free_cell: true }
  ),
  spell(
    'c_glyph',
    [
      {
        kind: SE.K_PLACE_GLYPH,
        element: 255,
        value: 0,
        area_shape: SE.SHAPE_CIRCLE,
        area_size: 1,
        target_filter: SE.TF_NONE,
        turns: 3,
      },
      dmg(15),
    ],
    { free_cell: true }
  ),
  spell('c_invis', [{ kind: SE.K_INVISIBILITY, element: 255, value: 0, target_filter: SE.TF_ONLY_CASTER, turns: 3 }]),
  spell('c_dot', [{ kind: SE.K_APPLY_DOT, element: 0, value: 8, target_filter: SE.TF_NOT_TEAM, turns: 3 }]),
  spell('c_heavy', [dmg(999)], { range_max: 12 }), // a guaranteed one-shot kill (last-mob-by-spell)
]

/** The spell-templates Map ctx.spell_templates: real corpus + the synthesized matrix (+ the auto-seeded
 *  mob_attack). Later entries win on id collision (none — the `c_` prefix is reserved). */
export const build_templates = () => normalize_spell_templates([...CORPUS, ...SYNTH])

/** Pick a REAL authored corpus spell id whose FIRST level declares an effect of `kind` (optional area_shape),
 *  with range_max ≥ min_range and no line-launch (so a scripted single-target cast lands). Deterministic (the
 *  corpus order is stable); throws if the kind is unshipped so a combo can never silently cast nothing. */
export const pick_by_kind = (kind, { area_shape = null, min_range_max = 1 } = {}) => {
  const hit = CORPUS.find((s) => {
    const lvl = s.levels?.[0]
    if (!lvl || Number(lvl.range_max ?? 0) < min_range_max || lvl.line_launch) return false
    return (lvl.effects ?? []).some(
      (e) => Number(e.kind) === kind && (area_shape == null || Number(e.area_shape ?? 0) === area_shape)
    )
  })
  if (!hit)
    throw new Error(
      `no corpus spell with kind ${kind}${area_shape != null ? ` shape ${area_shape}` : ''} range≥${min_range_max}`
    )
  return hit.id
}

/** Give an entity a specific spell in hand (the with_spell_in_hand idiom) — handle_cast only needs hand + level. */
export const with_hand = (entity, spell_ids) => ({
  ...entity,
  spell_levels: Object.fromEntries(spell_ids.map((s) => [s, 1])),
})
