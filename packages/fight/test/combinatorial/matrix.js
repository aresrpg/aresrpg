// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE COMBINATION MATRIX — breadth over depth: every effect kind / AoE shape / displacement / trap / kill
// sequence exercised at least once in a real FIGHT context (not isolation), each a deterministic seeded combo
// the driver replays. Breadth mandate: exercise many fight combinations and movements with multiple mobs —
// yajin, traps, pushes, moves — across every different effect: AoE, glyphs, multi-cell traps.
//
// A combo = { name, seed, setup(): {arena, obstacles, team0, team1}, player_turn(state, api, pturn): cmds[],
//   max_player_turns }. The caster is a yajin at the west edge; mobs cluster east. player_turn reads LIVE
// positions so a target is always a mob's current cell (deterministic — the sim is pure).

import { build_arena, make_fighter, with_hand, pick_by_kind, SE } from './entities.js'

// Real authored mainnet spells (picked by effect kind — proving the SHIPPED corpus flows the pipeline, not
// only synthesized templates). Resolved once at module load; the picker throws if a kind is unshipped.
const REAL = {
  push: pick_by_kind(SE.K_PUSH),
  trap: pick_by_kind(SE.K_PLACE_TRAP),
  invis: pick_by_kind(SE.K_INVISIBILITY),
  damage: pick_by_kind(SE.K_DAMAGE, { min_range_max: 4 }), // a RANGED real damage spell (robust to cast at distance)
}

const PC = { x: 3, y: 9 } // the caster's home cell (west), clear of every eastern cluster
const yajin = (spells, opts = {}) =>
  with_hand(
    make_fighter('p0', { ...(opts.cell ?? PC) }, true, { health: 300, health_max: 300, ap: 60, mp: 8, ...opts }),
    spells
  )
const mob = (id, cell, hp = 60) => make_fighter(id, cell, false, { health: hp, health_max: hp, ap: 6, mp: 4 })
const cast = (spell_id, target) => ({ type: 'cast', entity_id: 'p0', spell_id, target })
const at = (api, id) => api.find(id)?.cell
const alive = (api, id) => (api.find(id)?.health ?? 0) > 0

// One cast on turn 0 at a target derived from a live mob cell, then nothing (end turn). The workhorse policy.
const cast_once =
  (spell_id, target_id, offset = { x: 0, y: 0 }) =>
  (state, api, pturn) => {
    if (pturn !== 0) return []
    const c = at(api, target_id)
    if (!c) return []
    return [cast(spell_id, { x: c.x + offset.x, y: c.y + offset.y })]
  }

// A tight eastern cluster of mobs around a center, for AoE shapes.
const cluster = (center, hp = 60) => [
  mob('m0', { x: center.x, y: center.y }, hp),
  mob('m1', { x: center.x + 1, y: center.y }, hp),
  mob('m2', { x: center.x, y: center.y + 1 }, hp),
  mob('m3', { x: center.x - 1, y: center.y }, hp),
  mob('m4', { x: center.x, y: center.y - 1 }, hp),
]

const aoe_combo = (name, seed, spell_id) => ({
  name,
  seed,
  max_player_turns: 1,
  setup: () => ({ arena: build_arena([]), team0: [yajin([spell_id])], team1: cluster({ x: 12, y: 9 }) }),
  player_turn: cast_once(spell_id, 'm0'),
})

export const MATRIX = [
  // ── AoE shapes over a multi-mob cluster (CIRCLE / CROSS / LINE / CONE / RING) ──────────────────────────────
  aoe_combo('aoe.circle', 101, 'c_aoe_circle'),
  aoe_combo('aoe.cross', 102, 'c_aoe_cross'),
  aoe_combo('aoe.line', 103, 'c_aoe_line'),
  aoe_combo('aoe.cone', 104, 'c_aoe_cone'),
  aoe_combo('aoe.ring', 105, 'c_aoe_ring'),

  // ── Single-target damage in a fight ───────────────────────────────────────────────────────────────────────
  {
    name: 'damage.single',
    seed: 110,
    max_player_turns: 1,
    setup: () => ({ arena: build_arena([]), team0: [yajin(['c_dmg'])], team1: [mob('m0', { x: 12, y: 9 })] }),
    player_turn: cast_once('c_dmg', 'm0'),
  },

  // ── DoT applied in a fight (ticks at the victim's next turn-start) ─────────────────────────────────────────
  {
    name: 'dot.apply',
    seed: 111,
    max_player_turns: 2,
    setup: () => ({ arena: build_arena([]), team0: [yajin(['c_dot'])], team1: [mob('m0', { x: 12, y: 9 })] }),
    player_turn: cast_once('c_dot', 'm0'),
  },

  // ── Glyph (payload triggers on STANDING): place a glyph on an empty cell, then PULL the mob onto it (the
  //    slide stops against the caster's body exactly on the glyph); it fires at the mob's next turn-start. ────
  {
    name: 'glyph.standing',
    seed: 120,
    max_player_turns: 2,
    setup: () => ({
      arena: build_arena([]),
      team0: [yajin(['c_glyph', 'c_pull'], { cell: { x: 9, y: 9 } })],
      team1: [mob('m0', { x: 11, y: 9 })],
    }),
    // glyph on {10,9}; pull m0 from {11,9} toward the caster — it lands on {10,9} (blocked by the caster at {9,9}).
    player_turn: (state, api, pturn) =>
      pturn === 0 ? [cast('c_glyph', { x: 10, y: 9 }), cast('c_pull', at(api, 'm0'))] : [],
  },

  // ── Multi-cell trap: place, then the mob walks onto it (AI closes distance and crosses) ───────────────────
  {
    name: 'trap.walk_trigger',
    seed: 130,
    max_player_turns: 3,
    setup: () => ({ arena: build_arena([]), team0: [yajin(['c_trap'])], team1: [mob('m0', { x: 8, y: 9 })] }),
    // place the trap between the mob and the caster so the AI walks over it on its way in.
    player_turn: (state, api, pturn) => (pturn === 0 ? [cast('c_trap', { x: 6, y: 9 })] : []),
  },

  // ── Push a mob ONTO a trap (displacement lands on the trap cell → trap_trigger mid-displacement) ───────────
  {
    name: 'trap.push_onto',
    seed: 131,
    max_player_turns: 2,
    setup: () => ({
      arena: build_arena([]),
      team0: [yajin(['c_trap', 'c_push'])],
      team1: [mob('m0', { x: 11, y: 9 })],
    }),
    player_turn: (state, api, pturn) => {
      if (pturn !== 0) return []
      // trap two cells east of the mob; a push (dir away from the west caster = +x) slides it onto the trap.
      return [cast('c_trap', { x: 13, y: 9 }), cast('c_push', at(api, 'm0'))]
    },
  },

  // ── Push into a WALL (obstacle behind the mob): the slide stops at the wall + collision damage ────────────
  {
    name: 'push.into_wall',
    seed: 140,
    max_player_turns: 1,
    setup: () => ({
      arena: build_arena([{ x: 13, y: 9 }]),
      team0: [yajin(['c_push'])],
      team1: [mob('m0', { x: 12, y: 9 })],
    }),
    player_turn: cast_once('c_push', 'm0'),
  },

  // ── Push into another MOB: the slide is blocked by the body + collision damage to both ────────────────────
  {
    name: 'push.into_mob',
    seed: 141,
    max_player_turns: 1,
    setup: () => ({
      arena: build_arena([]),
      team0: [yajin(['c_push'])],
      team1: [mob('m0', { x: 11, y: 9 }), mob('m1', { x: 13, y: 9 })],
    }),
    // push m0 east toward m1 — with a big enough distance the slide meets m1's body.
    player_turn: cast_once('c_push', 'm0'),
  },

  // ── Pull a mob toward the caster (opposite displacement direction) ────────────────────────────────────────
  {
    name: 'pull.toward',
    seed: 142,
    max_player_turns: 1,
    setup: () => ({ arena: build_arena([]), team0: [yajin(['c_pull'])], team1: [mob('m0', { x: 12, y: 9 })] }),
    player_turn: cast_once('c_pull', 'm0'),
  },

  // ── Teleport the caster to open ground (instant relocation — the teleport beat, not a slide) ──────────────
  {
    name: 'teleport.self',
    seed: 143,
    max_player_turns: 1,
    setup: () => ({ arena: build_arena([]), team0: [yajin(['c_teleport'])], team1: [mob('m0', { x: 12, y: 9 })] }),
    player_turn: (state, api, pturn) => (pturn === 0 ? [cast('c_teleport', { x: 6, y: 6 })] : []),
  },

  // ── Swap positions with a mob (both entities relocate) ────────────────────────────────────────────────────
  {
    name: 'swap.positions',
    seed: 144,
    max_player_turns: 1,
    setup: () => ({ arena: build_arena([]), team0: [yajin(['c_swap'])], team1: [mob('m0', { x: 12, y: 9 })] }),
    player_turn: cast_once('c_swap', 'm0'),
  },

  // ── Carry a mob to the caster's cell ──────────────────────────────────────────────────────────────────────
  {
    name: 'carry.to_caster',
    seed: 145,
    max_player_turns: 1,
    setup: () => ({ arena: build_arena([]), team0: [yajin(['c_carry'])], team1: [mob('m0', { x: 12, y: 9 })] }),
    player_turn: cast_once('c_carry', 'm0'),
  },

  // ── Throw a mob to a chosen free cell ─────────────────────────────────────────────────────────────────────
  {
    name: 'throw.to_cell',
    seed: 146,
    max_player_turns: 1,
    setup: () => ({
      arena: build_arena([]),
      team0: [yajin(['c_carry', 'c_throw'])],
      team1: [mob('m0', { x: 12, y: 9 })],
    }),
    // carry adjacent first, then throw to open ground (throw launches from the caster).
    player_turn: (state, api, pturn) =>
      pturn === 0 ? [cast('c_carry', at(api, 'm0')), cast('c_throw', { x: 8, y: 5 })] : [],
  },

  // ── Invisibility then reveal-on-attack (the caster hides, then a damaging cast reveals it) ─────────────────
  {
    name: 'invis.reveal_on_attack',
    seed: 150,
    max_player_turns: 2,
    setup: () => ({
      arena: build_arena([]),
      team0: [yajin(['c_invis', 'c_dmg'])],
      team1: [mob('m0', { x: 12, y: 9 })],
    }),
    player_turn: (state, api, pturn) => {
      if (pturn === 0) return [cast('c_invis', at(api, 'p0'))]
      if (pturn === 1 && alive(api, 'm0')) return [cast('c_dmg', at(api, 'm0'))]
      return []
    },
  },

  // ── Movement: the caster walks several cells (the walk trajectory / gait) ─────────────────────────────────
  {
    name: 'move.walk',
    seed: 160,
    max_player_turns: 1,
    setup: () => ({
      arena: build_arena([]),
      team0: [yajin(['c_dmg'], { mp: 8 })],
      team1: [mob('m0', { x: 15, y: 9 })],
    }),
    player_turn: (state, api, pturn) => {
      if (pturn !== 0) return []
      const p = at(api, 'p0')
      // a straight 4-cell eastward walk (past the run-gait threshold), then nothing.
      return [{ type: 'move', entity_id: 'p0', path: [1, 2, 3, 4].map((i) => ({ x: p.x + i, y: p.y })) }]
    },
  },

  // ── Multi-mob turns: 6 mobs each take a paced turn (3s per mob turn — alone against 6 mobs = 3×6) ─
  {
    name: 'multimob.six_turns',
    seed: 170,
    max_player_turns: 2, // player passes turn 0 → the 6 mob turns pace the wave → player turn 1 stops the capture
    setup: () => ({
      arena: build_arena([]),
      team0: [yajin(['c_dmg'])],
      team1: [
        mob('m0', { x: 8, y: 6 }),
        mob('m1', { x: 9, y: 7 }),
        mob('m2', { x: 10, y: 8 }),
        mob('m3', { x: 9, y: 11 }),
        mob('m4', { x: 10, y: 12 }),
        mob('m5', { x: 11, y: 10 }),
      ],
    }),
    player_turn: (state, api, pturn) => (pturn === 0 ? [] : []), // player passes; the 6 mob turns pace the wave
  },

  // ── Mid-turn kill: an AoE kills one mob of several; the fight continues (a death beat mid-wave) ────────────
  {
    name: 'kill.midturn_aoe',
    seed: 180,
    max_player_turns: 1,
    setup: () => ({ arena: build_arena([]), team0: [yajin(['c_aoe_circle'])], team1: cluster({ x: 12, y: 9 }, 18) }),
    player_turn: cast_once('c_aoe_circle', 'm0'),
  },

  // ── Last-mob kill by SPELL: a heavy single-target spell wipes the final mob → fight_ended Victory ──────────
  {
    name: 'kill.last_by_spell',
    seed: 181,
    max_player_turns: 1,
    setup: () => ({ arena: build_arena([]), team0: [yajin(['c_heavy'])], team1: [mob('m0', { x: 12, y: 9 })] }),
    player_turn: cast_once('c_heavy', 'm0'),
  },

  // ── Last-mob kill by a WEAPON-like strike: a cheap single-target damage as the finishing blow → Victory ────
  {
    name: 'kill.last_by_weapon',
    seed: 182,
    max_player_turns: 1,
    setup: () => ({ arena: build_arena([]), team0: [yajin(['c_dmg'])], team1: [mob('m0', { x: 12, y: 9 }, 25)] }),
    player_turn: cast_once('c_dmg', 'm0'),
  },

  // ── AoE that wipes the WHOLE cluster in one cast (multi-kill → several death beats + Victory) ──────────────
  {
    name: 'kill.multi_wipe',
    seed: 183,
    max_player_turns: 1,
    setup: () => ({ arena: build_arena([]), team0: [yajin(['c_aoe_circle'])], team1: cluster({ x: 12, y: 9 }, 15) }),
    player_turn: cast_once('c_aoe_circle', 'm0'),
  },

  // ── REAL CORPUS SPELLS — the same shipped authored spells the game casts (caster placed adjacent so the
  //    picked spell's range always covers the target). Proves the mainnet corpus folds through the pipeline. ──
  {
    name: 'real.push',
    seed: 200,
    max_player_turns: 1,
    setup: () => ({
      arena: build_arena([]),
      team0: [yajin([REAL.push], { cell: { x: 9, y: 9 } })],
      team1: [mob('m0', { x: 10, y: 9 })],
    }),
    player_turn: cast_once(REAL.push, 'm0'),
  },
  {
    name: 'real.trap',
    seed: 201,
    max_player_turns: 3,
    setup: () => ({
      arena: build_arena([]),
      team0: [yajin([REAL.trap], { cell: { x: 9, y: 9 } })],
      team1: [mob('m0', { x: 13, y: 9 })],
    }),
    player_turn: (state, api, pturn) => (pturn === 0 ? [cast(REAL.trap, { x: 11, y: 9 })] : []),
  },
  {
    // a real ALLY-buff invisibility (TF_NOT_ENEMY, range 1) on a 2nd player — the brief's "optional 2nd player".
    name: 'real.invis_ally',
    seed: 202,
    max_player_turns: 1,
    setup: () => ({
      arena: build_arena([]),
      team0: [
        yajin([REAL.invis], { cell: { x: 9, y: 9 } }),
        make_fighter('p1', { x: 10, y: 9 }, true, { health: 120, health_max: 120, ap: 10, mp: 4 }),
      ],
      team1: [mob('m0', { x: 15, y: 9 })],
    }),
    player_turn: (state, api, pturn) => (pturn === 0 ? [cast(REAL.invis, { x: 10, y: 9 })] : []),
  },
  {
    // a real RANGED damage spell cast at a mob from a distance (proves an authored ranged attack folds through).
    name: 'real.damage',
    seed: 203,
    max_player_turns: 1,
    setup: () => ({ arena: build_arena([]), team0: [yajin([REAL.damage])], team1: [mob('m0', { x: 7, y: 9 })] }), // dist 4 (within the picked spell's range)
    player_turn: cast_once(REAL.damage, 'm0'),
  },
]
