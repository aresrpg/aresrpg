// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Own-cast prediction is a thin adapter around @aresrpg/sim's spell reducer. The chain corpus is normalized
// before it reaches here; this module only selects the publicly-known branch, excludes unshipped chain kinds,
// runs the sim once, and projects the resulting state delta into the fight reducer's canonical action shapes.

import { create_fight_state } from '@aresrpg/sim/reduce'
import { crit_at, slot_crit_roll, turn_seed } from '@aresrpg/sim/turn_seed'
import { find_entity } from '@aresrpg/sim/fight_state'
import { is_invisible } from '@aresrpg/sim/fight_statuses'
import { normalize_spell_templates } from '@aresrpg/sim/spell_templates'

import { produce_predicted_render_events } from './fight_predicted_render.js'
import { DISPLACE_TELEPORT } from './fight_render_prims.js'
import { decode, encode } from './los.js'
import { WEAPON_ATTACK_ID, weapon_shape_of } from './weapon.js'

// B7 ENGINE FOSSIL — the deployed engine lineage the CHAIN_PENDING exclusion set below was ruled against. UPDATE
// RITUAL: on every engine upgrade re-stamp this to `ceremony_manifest.engine.latest` (the boundary test asserts the
// equality) and re-verify CHAIN_PENDING against the new arms. Refreshed to the v1.12.32-follow-up engine (07-19).
export const CHAIN_PENDING_ENGINE_VERSION = '0x6145a3ecffe1f32f56d1ff973904aa342248feb3d9364639dba746cb492a0070'

// BRIDGE B7 — expires when the <next-train> ships the 8 chain arms; deletion criterion: on-chain kind handling verified.
export const CHAIN_PENDING = new Set([10, 15, 16, 17, 22, 25, 26, 29])

/** The UI projection's first direct-damage base. Pricing only; prediction itself never reads this projection. */
export const damage_of = (effects) => (effects ?? []).find((effect) => effect.kind === 'DAMAGE')?.base ?? 0

const entity_ref = (entity_id) => {
  const match = /^(p|m)(\d+)$/.exec(String(entity_id)) ?? /^mob-(\d+)$/.exec(String(entity_id))
  if (!match) return null
  if (match.length === 2) return { is_mob: true, idx: Number(match[1]) }
  return { is_mob: match[1] === 'm', idx: Number(match[2]) }
}

const unique = (values) => [...new Set(values)]

// A cast's TELEPORT effect ALWAYS relocates the caster (fight_spells: TELEPORT targets [caster]) — an INSTANT jump,
// never a slide. Detected from the deterministic template kinds so the caster's Displaced is tagged effect_kind =
// K_TELEPORT (field-identical to the chain's Displaced.kind): the fold skips the walk-window and the render blinks.
const has_kind = (effects, kind) =>
  (effects ?? []).some((e) => e.kind === kind || (Array.isArray(e.payload) && has_kind(e.payload, kind)))

const deterministic_effects = (effects) =>
  (effects ?? []).reduce(
    (out, effect) => {
      if (CHAIN_PENDING.has(effect.kind))
        return { ...out, unresolved: [...out.unresolved, `chain_pending:${effect.kind}`] }
      if (effect.chance != null && Number(effect.chance) < 100)
        return { ...out, unresolved: [...out.unresolved, 'chance'] }
      const payload = Array.isArray(effect.payload)
        ? deterministic_effects(effect.payload)
        : { effects: null, unresolved: [] }
      return {
        effects: [...out.effects, payload.effects ? { ...effect, payload: payload.effects } : effect],
        unresolved: [...out.unresolved, ...payload.unresolved],
      }
    },
    { effects: [], unresolved: [] }
  )

const prediction_template = (spell, spell_level, critical) => {
  const level_index = Math.max(0, Number(spell_level ?? 1) - 1)
  const selected_level = spell.levels?.[level_index]
  if (!selected_level) return null
  let selected = selected_level.base_effects ?? []
  let unresolved = []
  if (selected_level.critical_chance > 0) {
    if (critical == null) {
      unresolved = ['critical']
      selected = []
    } else if (critical && selected_level.crit_effects?.length) selected = selected_level.crit_effects
  }
  const deterministic = deterministic_effects(selected)
  return {
    template: {
      ...spell,
      levels: spell.levels.map((level, index) =>
        index === level_index
          ? { ...level, critical_chance: 0, base_effects: deterministic.effects, crit_effects: [] }
          : level
      ),
    },
    unresolved: [...unresolved, ...deterministic.unresolved],
  }
}

const with_spell_in_hand = (state, caster_id, spell_id, spell_level) => {
  const update = (entity) =>
    entity.id === caster_id
      ? {
          ...entity,
          hand: entity.hand.includes(spell_id) ? entity.hand : [...entity.hand, spell_id],
          spell_levels: { ...entity.spell_levels, [spell_id]: spell_level },
        }
      : entity
  return { ...state, team0: state.team0.map(update), team1: state.team1.map(update) }
}

const changed_actions = ({ before, after, caster_id, target_cell, ap_cost, resolve_ref, teleport_ids }) => {
  const actions = []
  let damaging = false
  for (const previous of [...before.team0, ...before.team1]) {
    const current = find_entity(after, previous.id)
    const ref = resolve_ref(previous.id)
    if (!current || !ref) continue
    if (current.cell.x !== previous.cell.x || current.cell.y !== previous.cell.y)
      actions.push({
        kind: 'Displaced',
        target_is_mob: ref.is_mob,
        target_idx: ref.idx,
        to_cell: encode(current.cell.x, current.cell.y),
        // TELEPORT is instant (the caster's own jump) — tag it so the fold skips the window and the render blinks;
        // a push/pull slide leaves effect_kind absent and keeps its walk-window (the reconcile-safe chain twin).
        ...(teleport_ids?.has(previous.id) ? { effect_kind: DISPLACE_TELEPORT } : {}),
      })
    if (current.health !== previous.health) {
      if (previous.id !== caster_id && current.health < previous.health) damaging = true
      actions.push({
        kind: 'Hit',
        victim_is_mob: ref.is_mob,
        victim_idx: ref.idx,
        remaining_hp: current.health,
      })
    }
    const expected_ap = previous.id === caster_id ? Math.max(0, previous.ap - ap_cost) : previous.ap
    if (current.ap < expected_ap)
      actions.push({
        kind: 'Drain',
        target_is_mob: ref.is_mob,
        target_idx: ref.idx,
        point_kind: 0,
        removed: expected_ap - current.ap,
      })
    if (current.mp < previous.mp)
      actions.push({
        kind: 'Drain',
        target_is_mob: ref.is_mob,
        target_idx: ref.idx,
        point_kind: 1,
        removed: previous.mp - current.mp,
      })
    // GRANT — the symmetric twin of the Drain above: an invisibility MP grant wasn't rendering on the
    // hud nor the mp blob. give_points raises a pool (Vanish +1 MP). The sim bumps entity.ap/mp, but the drain-
    // only diff dropped the increase, so the fold's me.mp never rose — both owner surfaces (engine_view.mp = the
    // HUD number, move_wash reach = the blob) read the stale value. Emit a Granted action so the fold folds it now.
    if (current.ap > expected_ap)
      actions.push({
        kind: 'Granted',
        target_is_mob: ref.is_mob,
        target_idx: ref.idx,
        point_kind: 0,
        granted: current.ap - expected_ap,
      })
    if (current.mp > previous.mp)
      actions.push({
        kind: 'Granted',
        target_is_mob: ref.is_mob,
        target_idx: ref.idx,
        point_kind: 1,
        granted: current.mp - previous.mp,
      })
    if (is_invisible(current) !== is_invisible(previous))
      actions.push({
        kind: 'StanceChanged',
        fighter_is_mob: ref.is_mob,
        fighter_idx: ref.idx,
        stance: 27,
        active: is_invisible(current),
      })
  }
  return [{ kind: 'cast', target_cell, damaging, ap_cost }, ...actions]
}

const critical_events = (events, critical) =>
  events.map((event) => (event.type === 'fight_cast' ? { ...event, is_critical: !!critical } : event))

const critical_beats = (beats, critical) =>
  beats.map((beat) => {
    const source_event = beat.payload?.source_event
    const cast_effect = source_event?.type === 'fight_cast'
    const payload = {
      ...beat.payload,
      ...(beat.kind === 'cast' ? { is_critical: !!critical } : {}),
      // Drafted damage/heal beats render independently after their Cast beat. The voxel adapter reads this
      // top-level flag to choose its orange `crit` floater; keeping the verdict only on source_event made a known
      // critical preview land for the right amount but paint as ordinary red.
      ...(cast_effect && (beat.kind === 'damage' || beat.kind === 'heal') ? { is_critical: !!critical } : {}),
      ...(cast_effect ? { source_event: { ...source_event, is_critical: !!critical } } : {}),
    }
    return { ...beat, payload }
  })

/**
 * Run one already-normalized spell through the sim and project its deterministic outcome.
 * @param {object} params
 * @param {import('@aresrpg/sim').FightState} params.state
 * @param {string} params.caster_id
 * @param {import('@aresrpg/sim').SpellTemplate} params.spell
 * @param {number} [params.spell_level]
 * @param {{x:number,y:number}} params.target
 * @param {import('@aresrpg/sim').Arena} params.arena
 * @param {boolean|null} [params.critical]
 * @param {(entity_id:string) => {is_mob:boolean,idx:number}|null} [params.resolve_ref]
 */
export const predict_sim_cast = ({
  state,
  caster_id,
  spell,
  spell_level = 1,
  target,
  arena,
  critical = null,
  resolve_ref = entity_ref,
}) => {
  const prediction = prediction_template(spell, spell_level, critical)
  if (!prediction)
    return {
      result: { success: false, error: 'SPELL_LEVEL_MISSING', state, effects: [] },
      actions: [],
      beats: [],
      sim_events: [],
      unresolved: ['spell_level'],
    }
  const { template, unresolved } = prediction
  // The caster relocates by TELEPORT (never a slide) exactly when the deterministic template carries a K_TELEPORT
  // effect — the ONE home for "this cast teleports the caster", read by both the render (instant blink) and the
  // fold action (window-skip). An enemy is never teleported by the corpus, so the set is the caster or empty.
  const teleport_ids = has_kind(template.levels[spell_level - 1]?.base_effects, DISPLACE_TELEPORT)
    ? new Set([caster_id])
    : new Set()
  const prepared = with_spell_in_hand(state, caster_id, template.id, spell_level)
  const output = produce_predicted_render_events(
    prepared,
    { type: 'cast', entity_id: caster_id, spell_id: template.id, target },
    { arena, spell_templates: new Map([[template.id, template]]), teleport_ids }
  )
  const cast_event = output.sim_events.find((event) => event.type === 'fight_cast')
  if (!cast_event)
    return {
      result: { success: false, error: 'SIM_CAST_REJECTED', state, effects: [] },
      actions: [],
      beats: [],
      sim_events: output.sim_events,
      unresolved: unique(unresolved),
    }
  const ap_cost = template.levels[spell_level - 1]?.cost ?? 0
  const result = {
    success: true,
    state: output.state,
    effects: cast_event.effects ?? [],
    caster_ap_remaining: find_entity(output.state, caster_id)?.ap ?? 0,
    is_critical: !!critical,
    fumbled: false,
  }
  // ④+⑦b+① the trap THIS cast places, as {encoded cell, payload}: the AoE cells (point today, zone-ready) PAIRED
  // with the trap's detonation payload. The caller folds these into the store's durable `my_traps` so a later push
  // both force-stops on the cell AND detonates the real payload — the earlier bug predicted zero trap damage.
  const before_ids = new Set((prepared.traps ?? []).map((trap) => trap.id))
  const placed_traps = (output.state.traps ?? [])
    .filter((trap) => !before_ids.has(trap.id))
    .flatMap((trap) =>
      (trap.cells ?? []).map((cell) => ({ cell: encode(cell.x, cell.y), payload: trap.payload ?? [] }))
    )
  // the glyph(s) THIS cast places, each as { cells:number[], turns }: the whole AoE zone (encoded) + its lifetime.
  // The caller folds these into the store's durable my_glyphs so the orange zone shows THIS frame and expires with
  // the sim's decay_glyphs turn budget. One record per glyph (the zone stays a unit — expiry + render, not per cell).
  const before_glyph_ids = new Set((prepared.glyphs ?? []).map((glyph) => glyph.id))
  const placed_glyphs = (output.state.glyphs ?? [])
    .filter((glyph) => !before_glyph_ids.has(glyph.id))
    .map((glyph) => ({
      cells: (glyph.cells ?? []).map((cell) => encode(cell.x, cell.y)),
      turns: glyph.turns_remaining,
    }))
  return {
    result,
    actions: changed_actions({
      before: prepared,
      after: output.state,
      caster_id,
      target_cell: encode(target.x, target.y),
      ap_cost,
      resolve_ref,
      teleport_ids,
    }),
    beats: critical_beats(output.events, critical),
    sim_events: critical_events(output.sim_events, critical),
    placed_traps,
    placed_glyphs,
    unresolved: unique(unresolved),
  }
}

const sim_entity = (fighter, stats) => ({
  id: fighter.id,
  name: fighter.name ?? fighter.id,
  cell: fighter.cell,
  health: Number(fighter.health ?? 0),
  health_max: Number(fighter.health_max ?? fighter.health ?? 0),
  ap: Number(fighter.ap ?? 0),
  ap_max: Number(fighter.ap_max ?? fighter.ap ?? 0),
  mp: Number(fighter.mp ?? 0),
  mp_max: Number(fighter.mp_max ?? fighter.mp ?? 0),
  ap_used: 0,
  mp_used: 0,
  is_player: !!fighter.is_player,
  template_id: String(fighter.variant ?? fighter.class_id ?? fighter.id),
  level: Number(fighter.level ?? 1),
  stats: stats ?? {},
  effects: fighter.invisible
    ? [{ id: 0, type: 'INVISIBILITY', timing: 'TURN_START', source_id: fighter.id, value: 0, turns_remaining: 1 }]
    : [],
  deck: [],
  hand: [],
  discard: [],
  spell_levels: {},
  ap_reserve: 0,
})

const state_from_view = (view, caster_id, stats_of) => {
  const arena = {
    ...view.arena,
    cells: Uint8Array.from(view.arena.cells ?? []),
    radius: Math.floor(Math.max(view.arena.width, view.arena.height) / 2),
    center: { x: Math.floor(view.arena.width / 2), y: Math.floor(view.arena.height / 2) },
    spawns_a: [],
    spawns_b: [],
  }
  const fighters = [...view.fighters.values()].filter((fighter) => fighter.cell)
  const team0 = fighters
    .filter((fighter) => fighter.team === 0)
    .map((fighter) => sim_entity(fighter, stats_of?.(fighter.id) ?? {}))
  const team1 = fighters
    .filter((fighter) => fighter.team !== 0)
    .map((fighter) => sim_entity(fighter, stats_of?.(fighter.id) ?? {}))
  const base = create_fight_state({
    fight_id: view.fight_id,
    arena_seed: 0,
    arena_radius: arena.radius,
    arena,
    team0,
    team1,
  })
  const turn_order = view.turn_order?.length ? [...view.turn_order] : [caster_id]
  const current_turn_idx = Math.max(0, turn_order.indexOf(caster_id))
  // ④+⑦b MY OWN TRAPS — read from THE FOLD STATE (ruled 07-19): `view.my_traps` is the engine_view projection
  // of the store's durable `my_traps` (populated by the trap-cast fold, sprung by the committed fold, gone-cells
  // and presented-occupied already excluded). The sim door reads STATE only — never trap_overlay (a convicted
  // render-only module-global). A predicted PUSH force-stops on these exactly as the chain will (killing the
  // overshoot-then-snapback); an ENEMY's invisible trap stays unknown — correct epistemics. Point traps are the
  // live corpus; a zone trap carries every cell here (check_traps matches ANY). Ids ride above base.next_id.
  const width = Number(view.arena?.width) || 20
  const traps = (view.my_traps ?? []).map((encoded, i) => {
    const cell = { x: Number(encoded) % width, y: Math.floor(Number(encoded) / width) }
    // ① thread the trap's detonation payload (project.my_trap_payloads) so a predicted step/push onto it deals its
    // real damage — payload:[] used to mean "no floater, no predicted kill/fight-end". Empty stays a no-op.
    return {
      id: base.next_id + i,
      source_id: caster_id,
      cells: [cell],
      payload: view.my_trap_payloads?.[encoded] ?? [],
      anchor: cell,
    }
  })
  return {
    state: {
      ...base,
      started: true,
      turn_order,
      current_turn_idx,
      turn_number: Number(view.turn_number ?? 0),
      traps: [...(base.traps ?? []), ...traps],
      next_id: base.next_id + traps.length,
    },
    arena,
  }
}

/** Resolve the chain's public critical branch. null means the branch cannot be known client-side yet. */
export const chain_critical = (clock, critical_chance, critical_bonus = 0) => {
  if (!(critical_chance > 0)) return false
  if (
    clock?.world_seed == null ||
    clock?.spawn_id == null ||
    clock?.turn_deadline_ms == null ||
    clock?.seat == null ||
    clock?.slot == null
  )
    return null
  const seed = turn_seed(clock)
  return crit_at(slot_crit_roll(seed, clock.slot), critical_chance, critical_bonus)
}

/**
 * Build the equipped weapon's attack line through the same sim template normalizer. §387: the weapon's FINE
 * category drives the CELL-SET SHAPE (`weapon_shape_of` — the one-home table) onto the damage effect's `area_shape`,
 * so the hover preview and the sim resolve the SAME multi-cell set through the existing spell-AoE machinery. `linear`
 * carries the spellbook line-only aim constraint; the bow's modifiable range is the range-bonus feed at cast time.
 */
export const weapon_spell_template = (weapon = {}) => {
  const shape = weapon_shape_of(weapon.category)
  const damage_effect = value => ({
    kind: 0,
    value: Number(value),
    element: Number(weapon.element ?? 255),
    target_filter: 1,
    area_shape: shape.area_shape,
    area_size: shape.area_size,
    chance: 100,
  })
  return normalize_spell_templates([
    {
      id: WEAPON_ATTACK_ID,
      name: 'Weapon attack',
      levels: [
        {
          ap_cost: Number(weapon.ap_cost ?? 0),
          range_min: 1,
          range_max: Math.max(1, Number(weapon.reach ?? 1)),
          line_of_sight: true,
          linear: shape.line_only,
          free_cell: false,
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          crit_rate: Number(weapon.crit_rate ?? 0),
          effects: [damage_effect(weapon.damage ?? 0)],
          crit_effects: [damage_effect(weapon.crit_damage ?? weapon.damage ?? 0)],
        },
      ],
    },
  ]).get(WEAPON_ATTACK_ID)
}

/** Convert the live fight projection to a sim state, then run predict_sim_cast synchronously. */
export const predict_cast = ({
  view,
  caster_id,
  spell,
  spell_level = 1,
  target_cell,
  critical_clock = null,
  critical,
  critical_bonus = 0,
  resolve_ref = entity_ref,
  stats_of = null,
}) => {
  if (!view || !caster_id || !spell) return null
  const converted = state_from_view(view, caster_id, stats_of)
  const level = spell.levels?.[spell_level - 1]
  return predict_sim_cast({
    state: converted.state,
    caster_id,
    spell,
    spell_level,
    target: decode(target_cell),
    arena: converted.arena,
    // BRANCH SELECTION: the live cast derives its crit from the public turn-seed clock (chain parity — every
    // existing caller passes a `critical_clock` and NO `critical`, so their behaviour is byte-unchanged). The
    // hover-preview getter passes an EXPLICIT `critical` (false = the guaranteed
    // non-crit branch, true = the crit branch) to project BOTH authored outcomes without a clock — a pure
    // pass-through to predict_sim_cast (which already takes `critical`), touching no damage/crit math.
    critical:
      critical === undefined ? chain_critical(critical_clock, level?.critical_chance ?? 0, critical_bonus) : critical,
    resolve_ref,
  })
}

/**
 * The COMMITTED sim base a turn's drafted casts/moves evolve from: the live view's fighters with their CELLS/HP
 * swapped to chain truth (my optimistic drafts EXCLUDED) — the exact state the chain evolves from. A fighter
 * absent from `committed` keeps its view row. Shared by evolve_flush_casts (per-cast occupancy) and
 * evolve_caster_cell (the post-cast move anchor) so both read the SAME chain base — one home for the evolution.
 * `caster_seed_cell` (#321) overrides the CASTER's own seeded cell — the committed-fighters row alone can only
 * express chain-confirmed truth, never "already moved by a drafted-but-uncommitted action" (a moves-first turn's
 * post-move cell — the cell the chain's evolved cast sequence must actually start from).
 * @param {{ view:object, committed:{fighters?:Record<string,{cell:number,hp:number,alive:boolean}>}, caster_id:string, resolve_ref:(id:string)=>{is_mob:boolean,idx:number}|null, caster_seed_cell?:number|null }} params
 */
const committed_sim_base = ({ view, committed, caster_id, resolve_ref, caster_seed_cell = null }) => {
  const base_fighters = new Map()
  for (const [id, fighter] of view.fighters ?? new Map()) {
    if (id === caster_id && caster_seed_cell != null) {
      base_fighters.set(id, { ...fighter, cell: decode(caster_seed_cell) })
      continue
    }
    const ref = resolve_ref(id)
    const row = ref ? committed?.fighters?.[`${ref.is_mob ? 'm' : 'p'}${ref.idx}`] : null
    base_fighters.set(id, row ? { ...fighter, cell: decode(row.cell), health: row.hp } : fighter)
  }
  return state_from_view({ ...view, fighters: base_fighters }, caster_id, null)
}

/**
 * The caster's ENCODED cell after the drafted casts (D99 order) evolve the committed base — the cell the chain's
 * apply_move charges the FIRST move segment from when the casts commit BEFORE the moves (cast_first). A
 * caster-relocating cast among them (a TELEPORT self-jump, a SWAP) moves the caster, so the movement draft's cost
 * anchor MUST be this evolved cell, never the raw committed cell (#300: walking one cell after a teleport charged
 * MP measured from the PRE-teleport cell — the reach shrank and the MP read wrong). No relocating cast — or none
 * drafted — returns the committed caster cell unchanged. Reuses the SAME sim door + committed base as
 * evolve_flush_casts (the deterministic twin), so the anchor never drifts from what the chain evolves.
 *
 * @param {object} params
 * @param {object} params.view                    live engine_view (arena/metadata; fighter cells swapped to committed truth)
 * @param {{ fighters?: Record<string, { cell:number, hp:number, alive:boolean }> }} params.committed  chain base, thin p{seat}/m{idx} keys
 * @param {string} params.caster_id
 * @param {Array<{ spell: object|null, target: number, spell_level?: number }>} params.casts  drafted casts, D99 order
 * @param {(id:string)=>{is_mob:boolean,idx:number}|null} [params.resolve_ref]  entity id → seat/mob ref (dungeon escrow home)
 * @returns {number|null} the caster's ENCODED post-cast cell, or null when the caster can't be resolved
 */
export const evolve_caster_cell = ({ view, committed, caster_id, casts, resolve_ref = entity_ref }) => {
  if (!view || !caster_id) return null
  const { state, arena } = committed_sim_base({ view, committed, caster_id, resolve_ref })
  let sim = state
  for (const cast of casts ?? []) {
    if (!cast?.spell) continue
    const pred = predict_sim_cast({
      state: sim,
      caster_id,
      spell: cast.spell,
      spell_level: cast.spell_level ?? 1,
      target: decode(cast.target),
      arena,
      resolve_ref,
    })
    if (pred?.result?.success) sim = pred.result.state
  }
  const caster = find_entity(sim, caster_id)
  return caster?.cell ? encode(caster.cell.x, caster.cell.y) : null
}

/**
 * ⑭ FLUSH VALIDATES THE EVOLVED SEQUENCE. The chain commits ONE PTB in D99 order, each action reading LIVE
 * evolved state (dungeon-turn / actions.move). At flush a drafted cast MUST be validated against the board the
 * CHAIN sees when it fires — the COMMITTED base evolved through the PRIOR casts' displacements/kills — NEVER the
 * optimistic end-state, where this cast's own push has already moved its target — the exact failure class where a
 * trap sits behind the mob, gets pushed onto it, and the turn commits without the spell. Moves never displace a mob, so the cast-occupancy
 * fold is move-independent; the caster's own anchor stays the flush's existing cast_first/last-move choice.
 *
 * Returns, per cast IN DRAFT ORDER, the occupancy the chain sees JUST BEFORE that cast fires — the SAME
 * `Map<encoded_cell, { kind:'player'|'mob', idx, alive }>` shape the board's own `occupied` uses, so the flush
 * gate swaps it in and reuses its OWN geometry (cast_range_set_dungeon) against THAT: client legality never
 * drifts from the chain. ALSO returns the CASTER's own encoded cell just before that cast fires (#321) — a
 * caster-relocating cast earlier in the SAME draft (teleport, dash) moves the caster, so the footprint ORIGIN for
 * every later cast must be this evolved cell too, never one static pre-loop anchor. That was the drop-valid-
 * targets class: the caster's own geometry origin went stale, not the target's, and a plainly in-range stationary
 * target fell out of a footprint drawn from the wrong corner of the board.
 *
 * @param {object} params
 * @param {object} params.view                    live engine_view (arena/metadata; its fighter CELLS are replaced by committed truth)
 * @param {{ fighters?: Record<string, { cell:number, hp:number, alive:boolean }> }} params.committed  chain base, thin p{seat}/m{idx} keys
 * @param {string} params.caster_id
 * @param {Array<{ spell: object|null, target: number, spell_level?: number }>} params.casts  drafted casts, D99 order
 * @param {(id:string)=>{is_mob:boolean,idx:number}|null} [params.resolve_ref]  entity id → seat/mob ref (dungeon escrow home)
 * @param {number|null} [params.caster_seed_cell]  the caster's cell at the START of the sequence — the committed
 *   cell (cast_first) or the post-move cell (moves-first); see committed_sim_base.
 * @returns {Array<{ occupied: Map<number, { kind:'player'|'mob', idx:number, alive:boolean }>, caster_cell: number|null }>}
 */
export const evolve_flush_casts = ({
  view,
  committed,
  caster_id,
  casts,
  resolve_ref = entity_ref,
  caster_seed_cell = null,
}) => {
  if (!view || !caster_id || !casts?.length) return []
  const { state, arena } = committed_sim_base({ view, committed, caster_id, resolve_ref, caster_seed_cell })
  let sim = state
  const occupancy = () => {
    const occ = new Map()
    for (const fighter of [...(sim.team0 ?? []), ...(sim.team1 ?? [])]) {
      const ref = resolve_ref(fighter.id)
      if (!ref || !fighter.cell) continue
      occ.set(encode(fighter.cell.x, fighter.cell.y), {
        kind: ref.is_mob ? 'mob' : 'player',
        idx: ref.idx,
        alive: fighter.health > 0,
      })
    }
    return occ
  }
  const caster_cell_of = () => {
    const caster = find_entity(sim, caster_id)
    return caster?.cell ? encode(caster.cell.x, caster.cell.y) : null
  }
  const out = []
  for (const cast of casts) {
    // the board AND the caster's own footprint origin the chain sees BEFORE this cast — snapshot, THEN evolve both.
    out.push({ occupied: occupancy(), caster_cell: caster_cell_of() })
    if (!cast?.spell) continue
    const pred = predict_sim_cast({
      state: sim,
      caster_id,
      spell: cast.spell,
      spell_level: cast.spell_level ?? 1,
      target: decode(cast.target),
      arena,
      resolve_ref,
    })
    if (pred?.result?.success) sim = pred.result.state
  }
  return out
}
