// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Own-cast prediction is a thin adapter around @aresrpg/sim's spell reducer. The chain corpus is normalized
// before it reaches here; this module only selects the publicly-known branch, excludes unshipped chain kinds,
// runs the sim once, and projects the resulting state delta into the fight reducer's canonical action shapes.

import { create_fight_state } from '@aresrpg/sim/reduce'
import { crit_at, slot_crit_roll, turn_seed } from '@aresrpg/sim/turn_seed'
import { find_entity, update_entity } from '@aresrpg/sim/fight_state'
import { is_invisible } from '@aresrpg/sim/fight_statuses'
import { check_traps } from '@aresrpg/sim/fight_traps'
import { normalize_spell_templates } from '@aresrpg/sim/spell_templates'

import { produce_predicted_render_events } from './fight_predicted_render.js'
import { DISPLACE_TELEPORT } from './fight_render_prims.js'
import { bfsPath, decode, encode } from './los.js'
import { sim_effects_of, status_row_of } from './statuses.js'
import { WEAPON_ATTACK_ID } from './weapon.js'

// B7 ENGINE FOSSIL — the deployed engine lineage the CHAIN_PENDING exclusion set below was ruled against. UPDATE
// RITUAL: on every engine upgrade re-stamp this to `ceremony_manifest.engine.latest` (the boundary test asserts the
// equality) and re-verify CHAIN_PENDING against the new arms. Re-stamped to ceremony #3's fresh publish id (07-24).
export const CHAIN_PENDING_ENGINE_VERSION = '0xe8c6c46893799e85e697ef0e524626c6323ea4db5a86da6c9de4a6d53c7ac41a'

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

/** Teach the caster the spell at the level being predicted — the ONE thing `handle_cast` reads off it. */
const with_spell_known = (state, caster_id, spell_id, spell_level) => {
  const update = (entity) =>
    entity.id === caster_id ? { ...entity, spell_levels: { ...entity.spell_levels, [spell_id]: spell_level } } : entity
  return { ...state, team0: state.team0.map(update), team1: state.team1.map(update) }
}

const effect_signature = (effect) =>
  JSON.stringify([
    effect?.id,
    effect?.type,
    effect?.stat,
    effect?.value,
    effect?.turns_remaining,
    effect?.source_id,
    effect?.timing,
  ])

const added_effects = (before, after) => {
  const prior = before ?? []
  const current = after ?? []
  return current.filter((effect, index) => {
    const signature = effect_signature(effect)
    const prior_count = prior.filter((row) => effect_signature(row) === signature).length
    const current_count = current.slice(0, index + 1).filter((row) => effect_signature(row) === signature).length
    return current_count > prior_count
  })
}

const changed_actions = ({ before, after, caster_id, target_cell, ap_cost, resolve_ref, teleport_ids }) => {
  const actions = []
  let damaging = false
  const caster_ref = resolve_ref(caster_id)
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
    // EVERY status the cast just landed paints NOW (#1049). This used to be a three-row bridge (range · ap/mp
    // grant · invisibility), so a +20 Strength buff, a +110% damage buff, a reflect and every point DEBUFF cast
    // to complete silence — five distinct kinds, one missing table. `status_row_of` (statuses.js) is the ONE
    // sim→status projection the simulator's own snapshot already used, so a kind is a status at every door or
    // at none. Authoritative ActionEffect remains the durable source once the receipt lands.
    for (const effect of added_effects(previous.effects, current.effects)) {
      const status = status_row_of(effect)
      if (status)
        actions.push({
          kind: 'StatusAdded',
          target_is_mob: ref.is_mob,
          target_idx: ref.idx,
          status: {
            chance: 100,
            ...status,
            // Attribution, stated by the door that KNOWS it: this cast's caster (the chain's `fid_of`).
            source: caster_ref ? (caster_ref.is_mob ? 1000 : 0) + caster_ref.idx : null,
          },
        })
    }
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
  const prepared = with_spell_known(state, caster_id, template.id, spell_level)
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
  // `base_range` is immutable fight-start/gear truth. Every prediction caller gets it even when its stats adapter
  // only supplies another mechanic (for example hover agility); explicit adapter keys remain intentional overrides.
  stats: { range: Number(fighter.base_range ?? fighter.stats?.range ?? 0) || 0, ...(stats ?? {}) },
  effects: sim_effects_of(fighter),
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

/** Build the equipped weapon's attack line through the same sim template normalizer. */
export const weapon_spell_template = (weapon = {}) =>
  normalize_spell_templates([
    {
      id: WEAPON_ATTACK_ID,
      name: 'Weapon attack',
      levels: [
        {
          ap_cost: Number(weapon.ap_cost ?? 0),
          range_min: 1,
          range_max: Math.max(1, Number(weapon.reach ?? 1)),
          line_of_sight: true,
          free_cell: false,
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          crit_rate: Number(weapon.crit_rate ?? 0),
          effects: [
            {
              kind: 0,
              value: Number(weapon.damage ?? 0),
              element: Number(weapon.element ?? 255),
              target_filter: 1,
              chance: 100,
            },
          ],
          crit_effects: [
            {
              kind: 0,
              value: Number(weapon.crit_damage ?? weapon.damage ?? 0),
              element: Number(weapon.element ?? 255),
              target_filter: 1,
              chance: 100,
            },
          ],
        },
      ],
    },
  ]).get(WEAPON_ATTACK_ID)

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
    // Live casts use the public turn-seed branch; hover previews pass an explicit false/true branch.
    critical:
      critical === undefined ? chain_critical(critical_clock, level?.critical_chance ?? 0, critical_bonus) : critical,
    resolve_ref,
  })
}

/** Committed sim base for both ordered evolvers; `caster_seed_cell` is a compatibility override. */
const committed_sim_base = ({ view, committed, caster_id, resolve_ref, caster_seed_cell = null }) => {
  const base_fighters = new Map()
  for (const [id, fighter] of view.fighters ?? new Map()) {
    if (id === caster_id && caster_seed_cell != null) {
      base_fighters.set(id, { ...fighter, cell: decode(caster_seed_cell) })
      continue
    }
    const ref = resolve_ref(id)
    const row = ref ? committed?.fighters?.[`${ref.is_mob ? 'm' : 'p'}${ref.idx}`] : null
    const chain_fighter = row
      ? { ...fighter, cell: decode(row.cell), health: row.hp, ap: row.ap ?? fighter.ap, mp: row.mp ?? fighter.mp }
      : fighter
    base_fighters.set(id, chain_fighter)
  }
  return state_from_view({ ...view, fighters: base_fighters }, caster_id, null)
}

const is_move_action = (action) => action?.kind === 0 || action?.kind === 'move'

const evolve_move = (state, caster_id, action, arena) => {
  if (action?.landed === false) return state
  const target = action?.target ?? action?.cell ?? action?.to_cell
  if (target == null) return state
  const caster = find_entity(state, caster_id)
  if (!caster?.cell || caster.health <= 0) return state
  const blocked = new Set()
  for (let i = 0; i < (arena.cells?.length ?? 0); i++) if (arena.cells[i]) blocked.add(i)
  for (const fighter of [...(state.team0 ?? []), ...(state.team1 ?? [])])
    if (fighter.id !== caster_id && fighter.health > 0 && fighter.cell)
      blocked.add(encode(fighter.cell.x, fighter.cell.y))
  const terrain_walkable = (cell) =>
    cell.x >= 0 &&
    cell.y >= 0 &&
    cell.x < arena.width &&
    cell.y < arena.height &&
    arena.cells[cell.y * arena.width + cell.x] === 0
  let sim = state
  const path = bfsPath(encode(caster.cell.x, caster.cell.y), Number(target), blocked, caster.mp)
  for (const encoded of path) {
    const entered = decode(encoded)
    sim = update_entity(sim, caster_id, (entity) => ({
      ...entity,
      cell: entered,
      mp: Math.max(0, entity.mp - 1),
      mp_used: entity.mp_used + 1,
    }))
    sim = check_traps(sim, entered, caster_id, terrain_walkable).state
    const after = find_entity(sim, caster_id)
    if (!after || after.health <= 0 || encode(after.cell.x, after.cell.y) !== encoded) break
  }
  return sim
}

/** Caster's encoded cell after exact draft-order evolution; `casts` is the compatibility input. */
export const evolve_caster_cell = ({
  view,
  committed,
  caster_id,
  actions = null,
  casts = null,
  resolve_ref = entity_ref,
}) => {
  if (!view || !caster_id) return null
  const { state, arena } = committed_sim_base({ view, committed, caster_id, resolve_ref })
  let sim = state
  for (const action of actions ?? casts ?? []) {
    if (is_move_action(action)) {
      sim = evolve_move(sim, caster_id, action, arena)
      continue
    }
    if (!action?.spell) continue
    const pred = predict_sim_cast({
      state: sim,
      caster_id,
      spell: action.spell,
      spell_level: action.spell_level ?? 1,
      target: decode(action.target),
      arena,
      resolve_ref,
    })
    if (pred?.result?.success) sim = pred.result.state
  }
  const caster = find_entity(sim, caster_id)
  return caster?.cell ? encode(caster.cell.x, caster.cell.y) : null
}

/** Exact draft-order evolution, returning one pre-fire occupancy/caster snapshot per cast. */
export const evolve_flush_casts = ({
  view,
  committed,
  caster_id,
  actions = null,
  casts = null,
  resolve_ref = entity_ref,
  caster_seed_cell = null,
}) => {
  const sequence = actions ?? casts ?? []
  if (!view || !caster_id || !sequence.length) return []
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
  for (const action of sequence) {
    if (is_move_action(action)) {
      sim = evolve_move(sim, caster_id, action, arena)
      continue
    }
    // the board AND the caster's own footprint origin the chain sees BEFORE this cast — snapshot, THEN evolve both.
    out.push({ occupied: occupancy(), caster_cell: caster_cell_of() })
    if (!action?.spell) continue
    const pred = predict_sim_cast({
      state: sim,
      caster_id,
      spell: action.spell,
      spell_level: action.spell_level ?? 1,
      target: decode(action.target),
      arena,
      resolve_ref,
    })
    if (pred?.result?.success) sim = pred.result.state
  }
  return out
}
