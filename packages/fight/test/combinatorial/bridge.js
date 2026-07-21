// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE RECEIPT PRODUCER (the bridge) — translate a driven @aresrpg/sim fight into the CHAIN-shaped raw events
// the fight fold consumes, plus the initial-state snapshot. No sim→chain translator existed (register #60 is a
// separate dormant PREDICTION path); this is the receipt-path bridge the brief names: sim outcomes → chain
// events (Cast/Displaced/Hit/Moved/MobMoved/Tackled/TurnStarted/TurnEnded/Victory/Defeat) → produce_receipt_
// render_turns (via the store). Faithful because it walks the sim EVENTS in order against a running position/hp
// SHADOW: the effect rows carry the NEW cell + remaining_hp; the shadow supplies the pre-event from_cell.
//
// Cells encode y*GRID_W+x at the chain boundary (fight_render_prims.encoded_cell) — the fold decodes back with
// beat_ctx.grid_width=20. Sim {x,y} round-trips exactly.

import { GRID_W, SE } from './entities.js'

const PKG = '0x0::fight_events'
const encode = (cell) => cell.y * GRID_W + cell.x
const ev = (kind, json) => ({ type: `${PKG}::${kind}`, parsedJson: json })

/** id → { is_mob, idx, character } from team membership (team0 = players/seats, team1 = mobs). */
export const entity_index = (state) => {
  const map = new Map()
  state.team0.forEach((e, idx) => map.set(e.id, { is_mob: false, idx, character: e.id }))
  state.team1.forEach((e, idx) => map.set(e.id, { is_mob: true, idx, character: null }))
  return map
}

const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

/**
 * Walk the ordered sim events into raw chain events. `initial` seeds the position/hp/mp shadow; `ref` is the
 * entity_index. Returns { events, trap_cells } — trap_cells is every cell of every trap the fight placed
 * (the fold's trigger detector is static per receipt; placement precedes triggering by construction).
 */
export const sim_to_chain = (initial, events, ref, trap_cells_seed = []) => {
  const raw = []
  const trap_cells = new Set(trap_cells_seed.map((c) => encode(c)))
  // shadow: entity id → { cell:{x,y}, hp, mp } tracked as events resolve.
  const shadow = new Map()
  for (const e of [...initial.team0, ...initial.team1])
    shadow.set(e.id, { cell: { ...e.cell }, hp: e.health, mp: e.mp })

  const idx_of = (id) => ref.get(id) ?? { is_mob: false, idx: 0, character: id }
  const push_hit = (victim_id, remaining_hp, caster_id) => {
    const before = shadow.get(victim_id)?.hp ?? remaining_hp
    const amount = Math.max(0, before - remaining_hp)
    const v = idx_of(victim_id)
    const c = caster_id ? idx_of(caster_id) : { is_mob: false, idx: 0 }
    raw.push(
      ev('Hit', {
        fight: initial.fight_id,
        victim_is_mob: v.is_mob,
        victim_idx: v.idx,
        amount,
        remaining_hp,
        caster_is_mob: c.is_mob,
        caster_idx: c.idx,
      })
    )
    if (shadow.has(victim_id)) shadow.get(victim_id).hp = remaining_hp
  }

  const emit_cast_effects = (caster_id, effects) => {
    // Order [Cast, …Displaced, …Hit] mirrors the real emitter (synthetic_cast_events). Displacement first so
    // the slide plays, then the damage floaters. A row may carry BOTH (a collision-damaging push) — emit both.
    for (const eff of effects)
      if (eff.has_cell && eff.cell) {
        const from = shadow.get(eff.target_id)?.cell ?? eff.cell
        const to = eff.cell
        if (from.x !== to.x || from.y !== to.y) {
          const t = idx_of(eff.target_id)
          const teleport = eff.target_id === caster_id
          raw.push(
            ev('Displaced', {
              fight: initial.fight_id,
              target_is_mob: t.is_mob,
              target_idx: t.idx,
              kind: teleport ? SE.K_TELEPORT : SE.K_PUSH, // 14 instant / 12 slide (pull renders as a slide too)
              from_cell: encode(from),
              to_cell: encode(to),
              requested: manhattan(from, to),
              blocked: 0,
            })
          )
          // a slide landing on a placed trap cell is detected by the fold via trap_cells (no extra event needed).
        }
        if (shadow.has(eff.target_id)) shadow.get(eff.target_id).cell = { ...to }
      }
    for (const eff of effects)
      if (eff.status === 'INVISIBILITY') {
        const f = idx_of(eff.target_id)
        raw.push(
          ev('StanceChanged', {
            fight: initial.fight_id,
            fighter_is_mob: f.is_mob,
            fighter_idx: f.idx,
            stance: 27,
            active: true,
          })
        )
      } else if (eff.status === 'REVEAL') {
        const f = idx_of(eff.target_id)
        raw.push(ev('Revealed', { fight: initial.fight_id, is_mob: f.is_mob, idx: f.idx }))
      }
    for (const eff of effects)
      if (eff.damage != null && eff.new_health != null) push_hit(eff.target_id, eff.new_health, caster_id)
  }

  for (const e of events) {
    switch (e.type) {
      case 'fight_turn_start': {
        const a = idx_of(e.entity_id)
        raw.push(ev('TurnStarted', { fight: initial.fight_id, is_mob: a.is_mob, idx: a.idx, deadline_ms: 0 }))
        break
      }
      case 'fight_turn_end': {
        const a = idx_of(e.entity_id)
        raw.push(ev('TurnEnded', { fight: initial.fight_id, is_mob: a.is_mob, idx: a.idx }))
        break
      }
      case 'fight_moved': {
        const a = idx_of(e.entity_id)
        const path = e.path ?? []
        const to = path.length ? path[path.length - 1] : shadow.get(e.entity_id)?.cell
        if (e.tackled) {
          // THE TOLL (ruling #239): a failed escape emits Tackled (the tax) AND — when the survivor walked (a
          // non-empty path) — a Moved to the prefix cell, exactly as the chain now does. mp_remaining already
          // folds the tax + the walk spend, so the fabricated mp_lost lands the terminal MP either way.
          const s = shadow.get(e.entity_id)
          raw.push(
            ev('Tackled', {
              fight: initial.fight_id,
              runner_is_mob: a.is_mob,
              runner_idx: a.idx,
              ap_lost: 0,
              mp_lost: Math.max(0, (s?.mp ?? 0) - (e.mp_remaining ?? s?.mp ?? 0)),
              num: 0,
              den: 1,
            })
          )
          if (path.length && to) {
            raw.push(
              a.is_mob
                ? ev('MobMoved', { fight: initial.fight_id, idx: a.idx, to_cell: encode(to) })
                : ev('Moved', { fight: initial.fight_id, character: a.character, to_cell: encode(to) })
            )
            if (shadow.has(e.entity_id)) shadow.get(e.entity_id).cell = { ...to }
          }
        } else if (to) {
          raw.push(
            a.is_mob
              ? ev('MobMoved', { fight: initial.fight_id, idx: a.idx, to_cell: encode(to) })
              : ev('Moved', { fight: initial.fight_id, character: a.character, to_cell: encode(to) })
          )
          if (shadow.has(e.entity_id)) shadow.get(e.entity_id).cell = { ...to }
        }
        if (shadow.has(e.entity_id)) shadow.get(e.entity_id).mp = e.mp_remaining ?? shadow.get(e.entity_id).mp
        break
      }
      case 'fight_cast': {
        const c = idx_of(e.entity_id)
        raw.push(
          ev('Cast', {
            fight: initial.fight_id,
            caster_is_mob: c.is_mob,
            caster_idx: c.idx,
            target_cell: encode(e.target),
          })
        )
        emit_cast_effects(e.entity_id, e.effects ?? [])
        break
      }
      case 'fight_trap_triggered':
        // a mover stepped onto a trap — the trap damage on the mover (the fold pairs it with active_move.trap).
        for (const eff of e.effects ?? [])
          if (eff.damage != null && eff.new_health != null) push_hit(eff.target_id ?? e.entity_id, eff.new_health, null)
        break
      case 'fight_turn_effects':
        // DoT / glyph turn-start ticks — health changes the terminal fold must reflect (parity) + floaters.
        for (const eff of e.effects ?? [])
          if (eff.damage != null && eff.new_health != null) push_hit(eff.target_id ?? e.entity_id, eff.new_health, null)
        break
      case 'fight_ended':
        if (e.winner === 0) raw.push(ev('Victory', { fight: initial.fight_id, aged_bp: 0 }))
        else if (e.winner === 1) raw.push(ev('Defeat', { fight: initial.fight_id }))
        break
      default:
        break // fight_turn_skipped / hand_update / ap_reserve_used carry no receipt beat
    }
  }
  return { events: raw, trap_cells: [...trap_cells] }
}

/** The initial-state snapshot `fight` object (board_state_from_fight input) — the pre-turn base the receipt
 *  folds on top of. Cells encode stride-20; width/height satisfy fight_geometry_complete. */
export const snapshot_of = (initial, { obstacles = [] } = {}) => ({
  id: initial.fight_id,
  status: 1, // ENGINE_ACTIVE
  width: GRID_W,
  height: 19,
  participants: initial.team0.map((p) => ({
    owner: p.id,
    character: p.id,
    class: 'yajin',
    team: 0,
    hp: p.health,
    max_hp: p.health_max,
    ap: p.ap,
    mp: p.mp,
    base_ap: p.ap_max,
    base_mp: p.mp_max,
    cell: encode(p.cell),
    ready: true,
    casts_this_turn: 0,
    weapon: null,
    stats: { agility: 0 },
  })),
  group_template: '0xmob_t',
  group_base_ap: initial.team1[0]?.ap_max ?? 6,
  group_base_mp: initial.team1[0]?.mp_max ?? 3,
  mobs: initial.team1.map((m) => ({
    template: '0xmob_t',
    level: m.level,
    hp: m.health,
    max_hp: m.health_max,
    cell: encode(m.cell),
    ap: m.ap,
    mp: m.mp,
    stats: { agility: 0 },
  })),
  obstacles: obstacles.map((o) => (typeof o === 'number' ? o : o.y * GRID_W + o.x)),
  holes: [],
  shape_mask: [],
  start_cells_a: initial.team0.map((p) => encode(p.cell)),
  start_cells_b: [],
  turn_ptr: 0,
  queue: [],
  turn_deadline_ms: 0,
  placement_deadline_ms: 0,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
})

export { encode }
