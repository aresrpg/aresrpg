// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { find_entity } from '../src/fight_state.js'
import { reduce } from '../src/reduce.js'
import * as SE from '../src/spell_effect.js'
import { normalize_spell_templates } from '../src/spell_templates.js'

import { arena, fighter, state_of } from './missing_effect_helpers.js'

// ╔══════════════════════════════════════════════════════════════════════════════════════════════════╗
// ║ PILLAR 2a — SIM × MOCKED SPELL EFFECTS — the design brief, verbatim (second paragraph):            ║
// ║   "test the modules independently like the sim with mocked spells effects … try all our effects on ║
// ║    layout of mobs and see if it executes properly."                                                ║
// ║                                                                                                    ║
// ║ A TABLE-DRIVEN harness that runs EVERY spell-effect kind (the 40 K_* discriminants of              ║
// ║ spell_effect.js) through the deterministic reducer (`reduce(state,{type:'cast'},ctx)`) on          ║
// ║ representative board layouts, asserting for each (kind × layout):                                  ║
// ║   (1) IT EXECUTES  — `reduce` accepts the cast and emits a `fight_cast` event (handle_cast returns ║
// ║        [] on any illegal / failed resolution, so a present cast event == the reducer processed it).║
// ║   (2) IT IS DETERMINISTIC — the same (state,command,ctx) folded twice yields byte-identical        ║
// ║        {state,events} (the reducer's purity contract, reduce.js:824, made an impossible-to-fail    ║
// ║        gate).                                                                                       ║
// ║   (3) COVERAGE — a completeness gate fails loudly the moment a new K_* discriminant ships with no  ║
// ║        matrix row, so "every effect" can never silently regress to "most effects."                 ║
// ╚══════════════════════════════════════════════════════════════════════════════════════════════════╝

// Every K_* discriminant exported by spell_effect.js (the effect vocabulary), 0..N — the coverage universe.
const ALL_KINDS = Object.fromEntries(
  Object.entries(SE).filter(
    ([name, v]) => name.startsWith('K_') && typeof v === 'number',
  ),
)
const ALL_KIND_VALUES = [...new Set(Object.values(ALL_KINDS))].sort(
  (a, b) => a - b,
)

// ── Representative layouts (the "layout of mobs" phrasing) ──────────────────────────────────────────
// Each returns { state, caster, cells } — caster is always the active team0[0] the reducer will accept.
const cell = (x, y) => ({ x, y })

const layouts = {
  // A single adjacent enemy: melee range, the common damage / debuff / displacement shape.
  point_blank() {
    const caster = fighter('p0', cell(2, 2), true, {
      health_max: 200,
      health: 200,
    })
    const enemy = fighter('m0', cell(3, 2), false)
    return {
      state: state_of([caster], [enemy]),
      caster,
      enemy,
      self: caster.cell,
      target: enemy.cell,
    }
  },
  // A wounded ally standing beside the caster: heals / point-gifts / buffs / shields land here (TF_NOT_ENEMY).
  wounded_ally() {
    const caster = fighter('p0', cell(2, 2), true)
    const ally = fighter('p1', cell(1, 2), true, {
      health: 30,
      health_max: 100,
    })
    const enemy = fighter('m0', cell(6, 2), false)
    return {
      state: state_of([caster, ally], [enemy]),
      caster,
      ally,
      enemy,
      self: caster.cell,
      target: ally.cell,
    }
  },
  // A ranged enemy with open board behind it: push / pull / teleport / geometric shapes have room to resolve.
  ranged() {
    const caster = fighter('p0', cell(2, 4), true, {
      health_max: 200,
      health: 200,
    })
    const enemy = fighter('m0', cell(5, 4), false)
    return {
      state: state_of([caster], [enemy]),
      caster,
      enemy,
      self: caster.cell,
      target: enemy.cell,
    }
  },
  // A CLUSTER of enemies around a center point: AoE shapes (circle/cross/line/tbar/ring/cone) fan across it.
  cluster() {
    const caster = fighter('p0', cell(4, 4), true, {
      health_max: 300,
      health: 300,
    })
    const mobs = [
      fighter('m0', cell(4, 3), false),
      fighter('m1', cell(5, 4), false),
      fighter('m2', cell(3, 4), false),
      fighter('m3', cell(4, 5), false),
    ]
    return {
      state: state_of([caster], mobs),
      caster,
      mobs,
      self: caster.cell,
      target: cell(4, 3),
    }
  },
}

// Cast a synthetic single-effect spell of `kind` through the REDUCER on a layout; return {events, castEvent, state}.
const cast_through_reducer = (
  layout_name,
  effect,
  target_key = 'target',
  level_effects = null,
) => {
  const built = layouts[layout_name]()
  const kind_tag = effect?.kind ?? level_effects?.[0]?.kind
  const spell_id = `matrix_${kind_tag}_${layout_name}`
  const templates = normalize_spell_templates([
    {
      id: spell_id,
      levels: [
        {
          ap_cost: 0,
          range_min: 0,
          range_max: 12,
          modifiable_range: false,
          line_launch: false,
          line_of_sight: false,
          // Fighter-targeted effects (damage/heal/buff/debuff, and self-casts) aim at an OCCUPIED cell; only
          // placement/teleport rows aim at open ground, which is what `free_cell` requires.
          free_cell: target_key === 'empty',
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          crit_rate: 0, // no crit draw → the cast is a pure function of (state, target)
          effects: level_effects ?? [effect],
          crit_effects: [],
        },
      ],
    },
  ])
  // The caster must KNOW the spell (its level feeds the resolver) and be the acting entity — the reducer's
  // `acting_entity` guard reads turn_order[current_turn_idx], and every layout seats the caster at index 0.
  const { state } = built
  state.current_turn_idx = 0
  const caster = find_entity(state, built.caster.id)
  caster.spell_levels = { [spell_id]: 1 }
  const ctx = { spell_templates: templates, arena }
  const command = {
    type: 'cast',
    entity_id: built.caster.id,
    spell_id,
    target: built[target_key],
  }
  const before = JSON.stringify(state)
  const result = reduce(state, command, ctx)
  const changed = JSON.stringify(result.state) !== before
  // Determinism probe: fold the SAME command from a freshly-built identical state and byte-compare.
  const rebuilt = layouts[layout_name]()
  rebuilt.state.current_turn_idx = 0
  const caster2 = find_entity(rebuilt.state, rebuilt.caster.id)
  caster2.spell_levels = { [spell_id]: 1 }
  const twin = reduce(
    rebuilt.state,
    { ...command, target: rebuilt[target_key] },
    { spell_templates: templates, arena },
  )
  return {
    result,
    twin,
    changed,
    castEvent: result.events.find(e => e.type === 'fight_cast'),
    built,
  }
}

// ── THE MATRIX: one row per K_* kind, with the layouts + params that make it resolve legally ─────────
// `raw` builds the flat effect (spell_effect fields); `filter`/`stat`/`element`/`turns`/`shape`/`size` per-kind.
const eff = (kind, o = {}) => ({
  kind,
  element: o.element ?? 2,
  value: o.value ?? 12,
  area_shape: o.area_shape ?? SE.SHAPE_POINT,
  area_size: o.area_size ?? 0,
  target_filter: o.target_filter ?? SE.TF_NOT_TEAM,
  chance: 100,
  turns: o.turns ?? 0,
  stat: o.stat ?? 0,
  flags: o.flags ?? 0,
  phase: o.phase ?? SE.PHASE_ON_ENTER,
})

const FRIEND = SE.TF_NOT_ENEMY
const ZONE = SE.TF_NONE
const SELF = SE.TF_ONLY_CASTER

// layouts: which board(s) this kind is exercised on. target: which layout cell key to aim at.
const matrix = [
  {
    kind: SE.K_DAMAGE,
    on: ['point_blank', 'ranged', 'cluster'],
    effects: true,
  },
  { kind: SE.K_PERCENT_LIFE_DAMAGE, on: ['point_blank'], eff: { value: 20 } }, // resolves straight into HP state
  { kind: SE.K_LIFE_STEAL, on: ['point_blank'], effects: true },
  {
    kind: SE.K_CASTER_DAMAGE,
    on: ['point_blank'],
    eff: { target_filter: SELF },
    target: 'self',
    effects: true,
  },
  { kind: SE.K_PUNISHMENT_DAMAGE, on: ['point_blank'], effects: true },
  {
    kind: SE.K_HEAL,
    on: ['wounded_ally'],
    eff: { target_filter: FRIEND },
    target: 'target',
    effects: true,
  },
  {
    kind: SE.K_GIVE_POINTS,
    on: ['wounded_ally'],
    eff: { target_filter: FRIEND, stat: SE.POINT_AP, value: 2, turns: 1 },
    target: 'target',
    effects: true,
  },
  {
    kind: SE.K_REMOVE_POINTS,
    on: ['point_blank'],
    eff: { stat: SE.POINT_MP, value: 2 },
    effects: true,
  },
  {
    kind: SE.K_STEAL_POINTS,
    on: ['point_blank'],
    eff: { stat: SE.POINT_AP, value: 2 },
  }, // pool delta → state
  {
    kind: SE.K_ALTER_STAT,
    on: ['point_blank'],
    eff: { stat: SE.STAT_STRENGTH, value: 20, turns: 2 },
    effects: true,
  },
  {
    kind: SE.K_STEAL_STAT,
    on: ['point_blank'],
    eff: { stat: SE.STAT_STRENGTH, value: 20, turns: 2 },
  }, // → state
  {
    kind: SE.K_ALTER_RESIST,
    on: ['point_blank'],
    eff: { element: 2, value: 30, turns: 2 },
  },
  {
    kind: SE.K_PUSH,
    on: ['ranged', 'point_blank'],
    eff: { value: 3, element: 255 },
    effects: true,
  },
  {
    kind: SE.K_PULL,
    on: ['ranged'],
    eff: { value: 2, element: 255 },
    effects: true,
  },
  {
    kind: SE.K_TELEPORT,
    on: ['ranged'],
    eff: { element: 255 },
    target: 'empty',
  },
  { kind: SE.K_SWAP_POSITIONS, on: ['ranged'], eff: { element: 255 } }, // position swap → state (no effect row)
  { kind: SE.K_CARRY, on: ['point_blank'], eff: { element: 255 } },
  { kind: SE.K_THROW, on: ['point_blank'], eff: { element: 255 } },
  {
    kind: SE.K_RESET_POSITIONS,
    on: ['ranged'],
    eff: { target_filter: ZONE, element: 255 },
    target: 'self',
    // INERT TODAY (#1039) — the normalizer carries no arm for kind 18, so it mints UNSUPPORTED and folds
    // nothing. This row read green only because the retired card system discarded the cast card, which counted
    // as a "state change" (#1012). Implementing the kind turns this red: move the row back, do not relax it.
    // `inert_effect_kinds.test.js` pins the SET this flag belongs to, derived from the normalizer itself.
    unsupported: true,
  },
  {
    kind: SE.K_PLACE_TRAP,
    on: ['ranged'],
    eff: {
      target_filter: ZONE,
      element: 255,
      area_shape: SE.SHAPE_CIRCLE,
      area_size: 1,
    },
    target: 'empty',
  },
  {
    kind: SE.K_PLACE_GLYPH,
    on: ['ranged'],
    eff: {
      target_filter: ZONE,
      element: 255,
      area_shape: SE.SHAPE_CIRCLE,
      area_size: 1,
      turns: 3,
      phase: SE.PHASE_START,
    },
    target: 'empty',
  },
  {
    kind: SE.K_APPLY_DOT,
    on: ['point_blank'],
    eff: { value: 8, turns: 3, phase: SE.PHASE_START },
    effects: true,
  },
  { kind: SE.K_APPLY_STATE, on: ['point_blank'], eff: { value: 1, turns: 2 } },
  // INERT TODAY (#1039) — same story as K_RESET_POSITIONS above: no normalizer arm for kind 23, so it mints
  // UNSUPPORTED and folds nothing; the retired discard was the only reason this row ever looked alive.
  {
    kind: SE.K_REMOVE_STATE,
    on: ['point_blank'],
    eff: { value: 1 },
    unsupported: true,
  },
  {
    kind: SE.K_REDUCE_DAMAGE,
    on: ['wounded_ally'],
    eff: { target_filter: FRIEND, value: 40, turns: 2 },
    target: 'target',
  },
  {
    kind: SE.K_REFLECT_DAMAGE,
    on: ['wounded_ally'],
    eff: { target_filter: FRIEND, value: 30, turns: 2 },
    target: 'target',
  },
  { kind: SE.K_DISPEL, on: ['point_blank'], eff: { value: 1 } },
  {
    kind: SE.K_INVISIBILITY,
    on: ['wounded_ally'],
    eff: { target_filter: SELF, element: 255, turns: 2 },
    target: 'self',
  },
  { kind: SE.K_REVEAL, on: ['point_blank'], eff: { element: 255 } },
  {
    kind: SE.K_RETURN_SPELL,
    on: ['wounded_ally'],
    eff: { target_filter: SELF, element: 255, turns: 2 },
    target: 'self',
  },
  {
    kind: SE.K_GEOMETRIC_PUSH,
    on: ['cluster'],
    eff: {
      target_filter: ZONE,
      element: 255,
      area_shape: SE.SHAPE_CIRCLE,
      area_size: 2,
    },
    target: 'self',
  },
  {
    kind: SE.K_CRITICAL_FAILURE,
    on: ['point_blank'],
    eff: { value: 1, turns: 1 },
  },
  {
    kind: SE.K_DAMAGE_TO_HEAL,
    on: ['point_blank'],
    eff: { value: 1, turns: 2 },
  },
  {
    kind: SE.K_FORCED_DEATH,
    on: ['point_blank'],
    eff: { element: 255 },
    effects: true,
  },
  {
    kind: SE.K_TIMED_PAYLOAD,
    on: ['point_blank'],
    // A timed payload wraps FOLLOWING effects; give it a real linked damage effect so it normalizes + arms.
    levels: [
      eff(SE.K_TIMED_PAYLOAD, {
        stat: 1,
        turns: 2,
        target_filter: SELF,
        element: 255,
      }),
      eff(SE.K_DAMAGE, { value: 10 }),
    ],
    target: 'self',
  },
  {
    kind: SE.K_NAMED_DAMAGE_STACK,
    on: ['point_blank'],
    eff: { value: 10, turns: 2 },
    effects: true,
  },
  {
    kind: SE.K_STANCE,
    on: ['wounded_ally'],
    eff: { target_filter: SELF, value: 1, turns: 2 },
    target: 'self',
  },
  {
    kind: SE.K_REACTIVE_PUNISHMENT,
    on: ['wounded_ally'],
    eff: { target_filter: SELF, value: 20, turns: 2 },
    target: 'self',
  },
  {
    kind: SE.K_EROSION,
    on: ['point_blank'],
    eff: { value: 10, turns: 2 },
    effects: true,
  },
  {
    kind: SE.K_DAMAGE_REDIRECT,
    on: ['wounded_ally'],
    eff: { target_filter: FRIEND, value: 1, turns: 2 },
    target: 'target',
  },
]

// A layout may expose an `empty` cell (open ground) for placement/teleport targets.
const with_empty = built => {
  built.empty = built.empty ?? { x: 7, y: 7 }
  return built
}

describe('PILLAR 2a — every spell-effect kind executes deterministically through the reducer', () => {
  for (const row of matrix) {
    const kind_name =
      Object.keys(ALL_KINDS).find(name => ALL_KINDS[name] === row.kind) ??
      `K_${row.kind}`
    for (const layout_name of row.on) {
      test(`${kind_name} · ${layout_name} · executes + deterministic`, () => {
        const effect = row.levels ? null : eff(row.kind, row.eff ?? {})
        // Layouts that expose an `empty` target cell need it injected before cast.
        const orig = layouts[layout_name]
        layouts[layout_name] = () => with_empty(orig())
        let probe
        try {
          probe = cast_through_reducer(
            layout_name,
            effect,
            row.target ?? 'target',
            row.levels ?? null,
          )
        } finally {
          layouts[layout_name] = orig
        }
        const { result, twin, castEvent, changed } = probe

        // (1) EXECUTES — the reducer accepted and processed the cast (handle_cast returns [] on any rejection).
        expect(
          castEvent,
          `${kind_name} cast was rejected by the reducer on ${layout_name}`,
        ).toBeTruthy()
        expect(castEvent.spell_id).toContain(`matrix_${row.kind}_`)
        expect(Array.isArray(castEvent.effects)).toBe(true)

        // (2) DID SOMETHING — a legal cast must leave a trace: an effect row OR a fight-state delta. Steal/percent/
        //     swap resolve straight into state and record no effect row; both count as "executes properly."
        //     A row flagged `unsupported` is pinned the other way: the normalizer has no arm for that kind, so
        //     the cast MUST fold nothing. Wiring the kind flips this red — that is the point (#1012).
        expect(
          castEvent.effects.length > 0 || changed,
          row.unsupported
            ? `${kind_name} now folds something on ${layout_name} — drop its \`unsupported\` flag`
            : `${kind_name} cast produced neither an effect row nor any state change on ${layout_name}`,
        ).toBe(!row.unsupported)

        // (3) DETERMINISTIC — same (state,command,ctx) folded twice → byte-identical {state,events}.
        expect(JSON.stringify(twin.events)).toBe(JSON.stringify(result.events))
        expect(JSON.stringify(twin.state)).toBe(JSON.stringify(result.state))

        // (4) OBSERVABLE — kinds with a guaranteed effect ROW (damage/heal/dot/…) must record at least one.
        if (row.effects) expect(castEvent.effects.length).toBeGreaterThan(0)
      })
    }
  }

  // ── AoE SHAPE SWEEP: one damage effect fanned through every zone shape on the mob cluster ───────────
  const shapes = {
    SHAPE_POINT: SE.SHAPE_POINT,
    SHAPE_CIRCLE: SE.SHAPE_CIRCLE,
    SHAPE_CROSS: SE.SHAPE_CROSS,
    SHAPE_LINE: SE.SHAPE_LINE,
    SHAPE_TBAR: SE.SHAPE_TBAR,
    SHAPE_RING: SE.SHAPE_RING,
    SHAPE_CONE: SE.SHAPE_CONE,
    SHAPE_ALLMAP: SE.SHAPE_ALLMAP,
  }
  for (const [shape_name, shape] of Object.entries(shapes)) {
    test(`AoE ${shape_name} · damage fans across the mob cluster deterministically`, () => {
      const orig = layouts.cluster
      layouts.cluster = () => with_empty(orig())
      let probe
      try {
        probe = cast_through_reducer(
          'cluster',
          eff(SE.K_DAMAGE, {
            value: 15,
            area_shape: shape,
            area_size: shape === SE.SHAPE_ALLMAP ? 0 : 3,
          }),
          'target',
        )
      } finally {
        layouts.cluster = orig
      }
      expect(
        probe.castEvent,
        `${shape_name} damage cast was rejected`,
      ).toBeTruthy()
      expect(JSON.stringify(probe.twin.events)).toBe(
        JSON.stringify(probe.result.events),
      )
      // Every shape but RING covers its own anchor cell (a mob), so ≥1 victim proves the fan resolved. RING is a
      // HOLLOW radius — at a size that clears the clustered mobs it correctly hits 0, so it asserts execute+determinism only.
      const hits = probe.castEvent.effects.filter(
        e => (e.damage ?? 0) > 0,
      ).length
      if (shape !== SE.SHAPE_RING)
        expect(
          hits,
          `${shape_name} hit no mob in the cluster`,
        ).toBeGreaterThanOrEqual(1)
    })
  }

  // ── THE COVERAGE GATE (impossible-to-fail-silently): every K_* discriminant has a matrix row ────────
  test('COVERAGE — every K_* effect discriminant is exercised by the matrix', () => {
    const covered = new Set(matrix.map(row => row.kind))
    const missing = ALL_KIND_VALUES.filter(k => !covered.has(k)).map(
      k =>
        Object.keys(ALL_KINDS).find(name => ALL_KINDS[name] === k) ?? `K_${k}`,
    )
    expect(
      missing,
      `effect kinds shipped with NO sim-matrix row: ${missing.join(', ')}`,
    ).toEqual([])
    expect(covered.size).toBe(ALL_KIND_VALUES.length)
  })
})
