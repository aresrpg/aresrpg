// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/sim_chain_events.js — THE CHAIN VOCABULARY of the local mock chain: who a fighter is on the wire, and
// what each `@aresrpg/sim` event says there. Split out of `sim_chain.js` to keep each file ≤600 LoC — the same
// move `fold.js` made out of `store.js` (INC-0), and the same reason.
//
// `sim_chain.js` owns the CHAIN (board · snapshot · the reduce+recorder driver) and re-exports this surface;
// import it from there. Everything here is pure: plain data in, `fight_events.move`-shaped rows out. It NEVER
// invents an event and never re-derives a fact the sim already stated — every hp it writes is the sim's own
// post-state hp, every cell the sim's own post-state cell. An UNMAPPED sim event or effect row THROWS: a mock
// that silently drops a fact is worse than no mock.
//
// THE WIRE CODEC. Sui JSON serializes `u64` as a decimal STRING and `u8`/`bool` as native JSON scalars — the
// captured corpus proves it (`packages/fight/test/fixtures/capsules`: `{"cell":"7","idx":"0","kind":12,
// "is_mob":false}`). `decode_fight_event` coerces on the way in, so a Number would still fold — but a mock that
// does not match the captured bytes is not a mock, it is a second dialect. `sim_chain_wire.test.js` pins every
// emitted row's key set AND per-key JSON type against those captured rows.

import { GRID_W, encode } from './los.js'
import { INVISIBILITY_STATUS_KIND } from './fight_status_snapshot.js'

/** The mock package id every emitted row is namespaced under. `decode_fight_event` keys off the LAST `::`
 *  segment, so the prefix is presentation only — but it must never collide with a real deployed package. */
export const SIM_PACKAGE = '0xsim'

/** Default wall-clock turn budget stamped onto `TurnStarted.deadline_ms` — UX, never determinism: replay rides
 *  the sim capsule's command list, not the clock (spec §10, divergence 2). */
export const DEFAULT_TURN_MS = 45_000

/** u64 → the decimal string Sui rides it as (see the codec note above). */
const u64 = (value) => String(Math.trunc(Number(value) || 0))

// `Displaced.kind` — the mechanics code the chain ALWAYS carries (captured corpus: `{"kind":12}`). The sim's
// effect row states only WHERE the fighter ended up, so the code is read off the geometry, which is exactly the
// partition the client branches on: a non-cardinal relocation cannot be a slide, so it is an instant jump
// (fight_render_events DISPLACE_TELEPORT skips the walk window); anything cardinal keeps its slide. PUSH vs
// PULL (12 vs 13) is not observable from the row and no consumer reads the difference.
const DISPLACE_PUSH = 12
const DISPLACE_TELEPORT = 14

/** `Drain.point_kind` / `Granted.point_kind` — the chain's pool discriminant (`spell_effect::point_ap()` = 0,
 *  `point_mp()` = 1). Only these two sim stat keys are POOLS; every other stat is a timed block row. */
const POOL_POINT_KIND = { ap: 0, mp: 1 }

// ╔════════════════ [ Fighter identity — the sim's entity ids ↔ the chain's (side, idx) ] ═══════════════════ ]

/** `team0` = players (seat order) · `team1` = mobs (spawn order) — the §17.28 interleave's own two sides. */
export const side_of = (state, entity_id) => {
  const seat = state.team0.findIndex((e) => e.id === entity_id)
  if (seat >= 0) return { is_mob: false, idx: seat }
  const idx = state.team1.findIndex((e) => e.id === entity_id)
  if (idx >= 0) return { is_mob: true, idx }
  throw new Error(`sim_chain: no fighter '${entity_id}' on either team`)
}

/** The canonical fold key (`inputs.fighter_key`) for a sim entity id. */
export const key_of = (state, entity_id) => {
  const { is_mob, idx } = side_of(state, entity_id)
  return `${is_mob ? 'm' : 'p'}${idx}`
}

/** The sim's OWN observable projection — the left half of the twin contract (spec §4.4). Cell/hp/alive per
 *  fighter, plus the acting seat and the winner. A concluded fight has NO active seat (get_current_turn_entity
 *  gates on `winner`), so the fold's twin reads its own `active` the same way.
 *  @param {object} state a sim FightState */
export const sim_projection = (state) => {
  const rows = {}
  const collect = (team, is_mob) =>
    team.forEach((e, idx) => {
      rows[`${is_mob ? 'm' : 'p'}${idx}`] = {
        cell: encode(e.cell.x, e.cell.y),
        hp: e.health,
        alive: e.health > 0,
      }
    })
  collect(state.team0, false)
  collect(state.team1, true)
  const order = state.turn_order ?? []
  const current = state.winner !== -1 || order.length === 0 ? null : order[state.current_turn_idx % order.length]
  return {
    fighters: rows,
    active: current == null ? null : key_of(state, current),
    winner: state.winner,
  }
}

/** The SAME observable read off a folded committed state — the right half of the twin. */
export const fold_projection = (folded) => {
  const rows = {}
  for (const key of Object.keys(folded.fighters ?? {}).sort()) {
    const f = folded.fighters[key]
    rows[key] = { cell: f.cell, hp: f.hp, alive: f.alive }
  }
  const winner = folded.winner ?? -1
  return { fighters: rows, active: winner === -1 ? (folded.active ?? null) : null, winner }
}

// ╔════════════════ [ The event encoder — sim events → fight_events rows (spec §4.4) ] ════════════════════ ]

const row = (name, payload) => ({ type: `${SIM_PACKAGE}::fight_events::${name}`, parsedJson: payload })

/** Status strings the sim emits that carry NO chain row: the chain records them inside the cast's action
 *  envelope (`record_timed`), never as a standalone fold event (cast.move:1265-1275). Listing them EXPLICITLY
 *  is the point — anything absent from this set is unmapped and throws. */
const INERT_STATUSES = new Set([
  'APPLY_STATE',
  'CRITICAL_FAILURE',
  'DAMAGE_REDIRECT',
  'DAMAGE_REFLECT',
  'DAMAGE_TO_HEAL',
  'DISPEL',
  'EROSION',
  'FORCED_DEATH',
  'FORCED_DEATH_IMMUNE',
  'GLYPH',
  'NAMED_DAMAGE_STACK',
  'POINT_DODGED',
  'POISON',
  'PUNISHMENT_TRIGGER',
  'REACTIVE_PUNISHMENT',
  'REFLECT_DAMAGE',
  'RETURN_SPELL',
  'SHIELD',
  'STANCE',
  'STANCE_END',
  'STAT_BUFF',
  'STAT_DEBUFF',
  'STUN',
  'SUMMON',
  'TIMED_PAYLOAD',
  'TRAP',
])

/**
 * Encode ONE `SpellCastEffect` row (the uniform shape every sim effect producer emits — fight_spells.js
 * `SpellCastEffect`, shared verbatim by traps, glyphs, DoT ticks and displacement).
 *
 * · `damage` / `heal` → `Hit{amount, remaining_hp}`. `remaining_hp` is the sim's own post-effect health, never
 *   re-derived. HEAL rides `Hit` because it is the ONLY chain event carrying an authoritative hp — see the
 *   spec-ambiguity note in the test file's header.
 * · `has_cell`        → `Displaced{from_cell, to_cell}` (push / pull / teleport / swap / carry / throw).
 * · `status`          → the two stance events that exist (`Revealed` · `StanceChanged`), a `CriticalFailure`
 *   for the fumble marker, and nothing at all for the inert set above.
 *
 * @param {object} state the sim state the (is_mob, idx) identity resolves against
 * @param {object} effect one SpellCastEffect
 * @param {{ fight_id: string, cells: Map<string, number> }} ctx `cells` = the running cell map (for from_cell)
 * @returns {object[]} zero or more chain rows
 */
const encode_effect = (state, effect, ctx) => {
  const { is_mob, idx } = side_of(state, effect.target_id)
  const fight = ctx.fight_id
  if (effect.damage != null || effect.heal != null)
    return [
      row('Hit', {
        fight,
        victim_is_mob: is_mob,
        victim_idx: u64(idx),
        amount: u64(effect.damage ?? effect.heal),
        remaining_hp: u64(effect.new_health ?? 0),
      }),
    ]
  if (effect.has_cell) {
    const to_cell = encode(effect.cell.x, effect.cell.y)
    const from_cell = ctx.cells.get(effect.target_id) ?? to_cell
    ctx.cells.set(effect.target_id, to_cell)
    const dx = Math.abs((to_cell % GRID_W) - (from_cell % GRID_W))
    const dy = Math.abs(Math.floor(to_cell / GRID_W) - Math.floor(from_cell / GRID_W))
    return [
      row('Displaced', {
        fight,
        target_is_mob: is_mob,
        target_idx: u64(idx),
        kind: dx > 0 && dy > 0 ? DISPLACE_TELEPORT : DISPLACE_PUSH, // u8 — see the constants above
        from_cell: u64(from_cell),
        to_cell: u64(to_cell),
        requested: u64(dx + dy),
        blocked: u64(0),
      }),
    ]
  }
  if (effect.status == null) throw new Error(`sim_chain: unmapped effect row ${JSON.stringify(effect)}`)
  // AP/MP POOL moves. On chain a give lands SILENTLY (cast.move:1098-1101 → participant::give_points) and the
  // DURABLE number reaches the client through the object read; a drain does emit (cast.move:1796 emit_drain).
  // The simulator has NO object read behind the receipt — `snapshot_from_sim` is the read — so a silent grant
  // would be a fact the client can only ever roll back (#952: the owner lost the bonus MP the instant the
  // receipt landed). `Granted` is the fold's own grant kind and THE one home both grant doors ride (inputs.js),
  // so the pool move is stated there. A non-pool stat row carries no chain event and stays inert below.
  const pool_kind = POOL_POINT_KIND[effect.stat]
  if (pool_kind !== undefined && (effect.status === 'STAT_BUFF' || effect.status === 'STAT_DEBUFF')) {
    const amount = Math.max(0, Math.trunc(Number(effect.value) || 0))
    if (amount === 0) return [] // a fully-dodged drain moved no pool — POINT_DODGED already carries the miss
    const target = { fight, target_is_mob: is_mob, target_idx: u64(idx), point_kind: pool_kind }
    return [
      effect.status === 'STAT_BUFF'
        ? row('Granted', { ...target, granted: u64(amount) })
        : row('Drain', { ...target, removed: u64(amount), requested: u64(effect.requested ?? amount) }),
    ]
  }
  if (effect.status === 'CRITICAL_FAILURE_FUMBLE')
    return [row('CriticalFailure', { fight, caster_is_mob: is_mob, caster_idx: u64(idx) })]
  if (effect.status === 'REVEAL') return [row('Revealed', { fight, is_mob, idx: u64(idx) })]
  if (effect.status === 'INVISIBILITY')
    return [
      row('StanceChanged', {
        fight,
        fighter_is_mob: is_mob,
        fighter_idx: u64(idx),
        stance: u64(INVISIBILITY_STATUS_KIND),
        active: true,
      }),
    ]
  if (INERT_STATUSES.has(effect.status)) return []
  throw new Error(`sim_chain: unmapped effect status '${effect.status}'`)
}

/** Pool deltas a tackle bit out of the runner — the chain emits what it STRIPPED, so read it pre→post. */
const tackle_losses = (pre_state, post_state, entity_id) => {
  const before = pre_state.team0.concat(pre_state.team1).find((e) => e.id === entity_id)
  const after = post_state.team0.concat(post_state.team1).find((e) => e.id === entity_id)
  return {
    ap_lost: Math.max(0, (before?.ap ?? 0) - (after?.ap ?? 0)),
    mp_lost: Math.max(0, (before?.mp ?? 0) - (after?.mp ?? 0)),
  }
}

/**
 * Encode ONE sim event into its chain rows. Pure per event; `ctx.cells` is the running cell index the encoder
 * builds as it goes (a local accumulator, not a caller's value) so `Displaced.from_cell` is the true origin.
 * `hand_update` is the one sim event with NO chain row — it rides the store's own `hand_update` door.
 * @returns {{ rows: object[], hand_updates?: object[] }}
 */
const encode_event = (event, ctx) => {
  const { fight_id, post_state, pre_state, now_ms, turn_ms } = ctx
  const fight = fight_id
  const effects_of = (list) => (list ?? []).flatMap((effect) => encode_effect(post_state, effect, ctx))
  switch (event.type) {
    case 'fight_started':
      return { rows: [] } // the start is visible as the first TurnStarted
    case 'fight_placed':
      return {
        rows: [row('Placed', { fight, character: event.entity_id, cell: u64(encode(event.cell.x, event.cell.y)) })],
      }
    case 'fight_ready':
      return { rows: [row('Ready', { fight, character: event.entity_id })] }
    case 'fight_turn_start': {
      const { is_mob, idx } = side_of(post_state, event.entity_id)
      return { rows: [row('TurnStarted', { fight, is_mob, idx: u64(idx), deadline_ms: u64(now_ms + turn_ms) })] }
    }
    case 'fight_turn_end':
    case 'fight_turn_skipped': {
      const { is_mob, idx } = side_of(post_state, event.entity_id)
      return { rows: [row('TurnEnded', { fight, is_mob, idx: u64(idx) })] }
    }
    case 'fight_moved': {
      const { is_mob, idx } = side_of(post_state, event.entity_id)
      if (event.tackled) {
        // `num`/`den` is the escape fraction the contest rolled against — `contest_tackle` keeps it internal
        // and never reports it, so the odds ride as 0/0 (the client renders them, nothing folds them).
        const { ap_lost, mp_lost } = tackle_losses(pre_state, post_state, event.entity_id)
        const json = {
          fight,
          runner_is_mob: is_mob,
          runner_idx: u64(idx),
          ap_lost: u64(ap_lost),
          mp_lost: u64(mp_lost),
        }
        return { rows: [row('Tackled', { ...json, num: u64(0), den: u64(0) })] }
      }
      // The path's END cell — the renderer re-walks the route itself (production behavior).
      const destination = event.path.at(-1)
      if (!destination) return { rows: [] }
      const to_cell = encode(destination.x, destination.y)
      ctx.cells.set(event.entity_id, to_cell)
      return {
        rows: [
          is_mob
            ? row('MobMoved', { fight, idx: u64(idx), to_cell: u64(to_cell) })
            : row('Moved', { fight, character: event.entity_id, to_cell: u64(to_cell) }),
        ],
      }
    }
    case 'fight_cast': {
      const { is_mob, idx } = side_of(post_state, event.entity_id)
      const cast = row('Cast', {
        fight,
        caster_is_mob: is_mob,
        caster_idx: u64(idx),
        target_cell: u64(encode(event.target.x, event.target.y)),
      })
      return { rows: [cast, ...effects_of(event.effects)] }
    }
    case 'fight_trap_triggered':
    case 'fight_turn_effects':
      return { rows: effects_of(event.effects) }
    case 'ap_reserve_used': {
      const { is_mob, idx } = side_of(post_state, event.entity_id)
      return {
        rows: [
          row('Granted', {
            fight,
            target_is_mob: is_mob,
            target_idx: u64(idx),
            point_kind: 0, // u8 — a native JSON number off Sui, unlike every u64 above
            granted: u64(event.ap_added ?? 0),
          }),
        ],
      }
    }
    case 'hand_update':
      return {
        rows: [],
        hand_updates: [
          {
            entity_id: event.entity_id,
            hand: event.hand,
            deck_size: event.deck_size,
            discard_size: event.discard_size,
          },
        ],
      }
    case 'fight_ended':
      // winner 0 = the mobs are wiped; 1 = the roster is wiped; 2 = the stalemate DRAW, which has NO winning
      // team (reduce.js DRAW) and so folds as a loss with the page-level banner on top (spec §4.4).
      return {
        rows: [Number(event.winner) === 0 ? row('Victory', { fight, aged_bp: u64(0) }) : row('Defeat', { fight })],
      }
    default:
      throw new Error(`sim_chain: unmapped sim event '${event.type}'`)
  }
}

/**
 * THE ENCODER (spec §4.4). One reducer step — `(pre_state, sim_events, post_state)` — becomes the ordered chain
 * rows the core folds, plus the hand updates that are not chain rows. Every fighter identity resolves against
 * `post_state`, the only state that still names them all after the step (a mid-step death removes no row).
 * @param {{ pre_state: object, post_state: object, events: object[], fight_id: string,
 *   now_ms?: number, turn_ms?: number }} params
 * @returns {{ rows: object[], hand_updates: object[] }}
 */
export const encode_sim_step = ({ pre_state, post_state, events, fight_id, now_ms = 0, turn_ms = DEFAULT_TURN_MS }) => {
  if (post_state.team0.length !== pre_state.team0.length || post_state.team1.length !== pre_state.team1.length)
    // A SUMMON grew a team. Participant/mob indices are POSITIONAL in the snapshot and the chain has no event
    // admitting a new fighter mid-fight, so this cannot be encoded — only reported. Loud by law.
    throw new Error('sim_chain: roster changed mid-step (summon) — no chain row can express it')

  const ctx = {
    fight_id,
    pre_state,
    post_state,
    now_ms,
    turn_ms,
    cells: new Map([...pre_state.team0, ...pre_state.team1].map((e) => [e.id, encode(e.cell.x, e.cell.y)])),
  }
  const encoded = events.map((event) => encode_event(event, ctx))
  return { rows: encoded.flatMap((e) => e.rows), hand_updates: encoded.flatMap((e) => e.hand_updates ?? []) }
}
