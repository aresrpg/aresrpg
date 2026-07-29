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

import { K_INVISIBILITY, K_PUSH, K_TELEPORT, POINT_AP, POINT_MP } from '@aresrpg/sim/spell_effect'

import { decode, encode } from './los.js'
import { MOB_FIGHTER_ID_BASE, encode_status_value, is_signed_status_kind } from './fight_status_snapshot.js'
import { status_row_of } from './statuses.js'

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
/** `Drain.point_kind` / `Granted.point_kind` — the chain's pool discriminant (`spell_effect::point_ap()` = 0,
 *  `point_mp()` = 1). Only these two sim stat keys are POOLS; every other stat is a timed block row. */
const POOL_POINT_KIND = { ap: POINT_AP, mp: POINT_MP }

// ╔════════════════ [ Fighter identity — the sim's entity ids ↔ the chain's (side, idx) ] ═══════════════════ ]

/** `team0` = players (seat order) · `team1` = mobs (spawn order) — the §17.28 interleave's own two sides. */
export const side_of = (state, entity_id) => {
  const seat = state.team0.findIndex((e) => e.id === entity_id)
  if (seat >= 0) return { is_mob: false, idx: seat }
  const idx = state.team1.findIndex((e) => e.id === entity_id)
  if (idx >= 0) return { is_mob: true, idx }
  throw new Error(`sim_chain: no fighter '${entity_id}' on either team`)
}

/** The chain's board fid for a sim entity id (players = seat, mobs = `MOB_FIGHTER_ID_BASE + idx`), or null when
 *  the id names no live fighter — `spell_board::FighterStatus.source`'s own namespace (`cast.move::fid_of`). */
const fighter_fid = (state, entity_id) => {
  if (entity_id == null) return null
  const seat = state.team0.findIndex((e) => e.id === entity_id)
  if (seat >= 0) return seat
  const idx = state.team1.findIndex((e) => e.id === entity_id)
  return idx >= 0 ? MOB_FIGHTER_ID_BASE + idx : null
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

// ╔════════════════ [ The status read — the sim's live effect rows → the snapshot's status rows ] ═════════ ]

/** The sim `Element` string → the chain element ordinal (`ELEMENT_MAP` in spell_templates.js, inverted). An
 *  authored row whose element the sim left undefined carries NONE, the same default the seed mint writes. */
const ELEMENT_ORDINAL = { FIRE: 0, WATER: 1, EARTH: 2, AIR: 3, NONE: 255 }

/**
 * THE SIMULATOR'S STATUS READ. `snapshot_from_sim` is the only durable channel behind the receipt, so it must
 * state the statuses the sim HOLDS — the store treats a snapshot's status array, `[]` included, as authoritative
 * "nobody has one". A hardcoded `[]` therefore wiped the invisibility the receipt had just floored and every
 * buff badge with it, which is #952's wholesale rollback.
 *
 * The sim-row → status-row projection is `statuses.status_row_of` — the ONE home (#1049), shared verbatim with
 * the prediction door so a kind can never be a status on one and invisible on the other. Rows come out in the
 * raw `spell_board` shape `status_snapshot_entities` decodes: `fighter` is the seat index for a player and
 * `MOB_FIGHTER_ID_BASE + idx` for a mob.
 * @param {object} state a sim FightState
 * @returns {object[]}
 */
export const status_rows_from_sim = (state) => {
  const rows = []
  const collect = (team, fighter_base) =>
    team.forEach((entity, idx) => {
      for (const effect of entity.effects ?? []) {
        const row = status_row_of(effect)
        if (!row) continue
        // `source` = the chain's attribution fid for the row's caster (`FighterStatus.source`), restated from
        // the sim's own entity id so the mock's snapshot carries what a real read carries. A row whose source is
        // not a live fighter (a trap/glyph author already gone) rides null rather than inventing a fid.
        rows.push({ fighter: fighter_base + idx, ...row, source: fighter_fid(state, effect.source_id) })
      }
    })
  collect(state.team0, 0)
  collect(state.team1, MOB_FIGHTER_ID_BASE)
  return rows
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
  'POISON',
  'PUNISHMENT_TRIGGER',
  'REACTIVE_PUNISHMENT',
  'REFLECT_DAMAGE',
  'REMOVE_STATE',
  'RETURN_SPELL_REDIRECT',
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
 * · `damage` / `heal` WITH a `new_health` → `Hit{amount, remaining_hp}`. `remaining_hp` is the sim's own
 *   post-effect health, never re-derived. HEAL rides `Hit` because it is the ONLY chain event carrying an
 *   authoritative hp — see the spec-ambiguity note in the test file's header.
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
  const magnitude = effect.damage ?? effect.heal
  // AN HP ROW IS A ROW THAT STATES THE RESULTING HP (#1169). `Hit` is the only chain event carrying an
  // authoritative hp, so it may only ever be written from one the sim ACTUALLY stated. Routing on `damage`
  // alone and defaulting the hp to `?? 0` invented a death: the erosion RIDER (`fight_actions.js`
  // `{ target_id, status: 'EROSION', damage: erosion }`) carries a max-HP magnitude and no hp at all, and
  // encoding it as `Hit{ remaining_hp: 0 }` buried a mob the sim still had at full health — the client killed
  // it, the next receipt restored its real hp (the REVIVE), and the sim never agreed anyone died, so
  // `check_victory` never fired and the fight ran open-ended (the WEDGE). Erosion is already in
  // INERT_STATUSES for exactly the right reason: the chain records it inside the cast's action envelope and
  // emits no event at all (`retro_effects.move` `erode` mutates max hp silently).
  if (magnitude != null && effect.new_health != null)
    return [
      row('Hit', {
        fight,
        victim_is_mob: is_mob,
        victim_idx: u64(idx),
        amount: u64(magnitude),
        remaining_hp: u64(effect.new_health),
      }),
    ]
  // A magnitude with no resulting hp is a rider on a STATUS row — fall through and let the status arm own it.
  // A magnitude that names no status either is an unmapped shape, and stays LOUD like every other one here.
  if (magnitude != null && effect.status == null)
    throw new Error(`sim_chain: effect row ${JSON.stringify(effect)} states no resulting hp`)
  if (effect.has_cell) {
    const to_cell = encode(effect.cell.x, effect.cell.y)
    const from_cell = ctx.cells.get(effect.target_id) ?? to_cell
    ctx.cells.set(effect.target_id, to_cell)
    const from_xy = decode(from_cell)
    const to_xy = decode(to_cell)
    const dx = Math.abs(to_xy.x - from_xy.x)
    const dy = Math.abs(to_xy.y - from_xy.y)
    return [
      row('Displaced', {
        fight,
        target_is_mob: is_mob,
        target_idx: u64(idx),
        kind: dx > 0 && dy > 0 ? K_TELEPORT : K_PUSH,
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
    if (effect.status === 'STAT_BUFF' && amount === 0) return [] // a zero grant still moved no pool
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
        stance: u64(K_INVISIBILITY),
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

// ╔════════════════ [ The ACTION ENVELOPE — the chain's record_timed wrapper around a cast ] ═══════════════ ]
//
// #973. A durable status is NOT a standalone chain event: `cast.move` records it INSIDE the cast's envelope
// (`record_timed`, cast.move:1119/1148-1153/1243-1274), and the client learns it from the three envelope rows
// `inputs.js` folds — `ActionStarted` (the action key + the target cell), one `ActionEffect` per AUTHORED
// top-level effect (the exact timed descriptor), and `ActionResolved` (the closing bracket that retires the
// key — and ONLY that: the effect manifest is stated once, on the `ActionEffect` rows, so `ActionResolved`
// no longer carries a second copy of it on either twin). Emitting none of them made every chip PREDICTION-only: the receipt fold carried no status row, so the
// counter went `3 → absent` and the granted MP reverted the instant the receipt landed.
//
// The chain wraps EVERY committed cast, damage-only ones included (`action_envelope::emit_started` runs before
// the effect loop for both the player and mob arms — cast.move:208-239 / 534-560; the captured corpus proves it:
// `ActionStarted, ActionEffect(kind 0), Hit, Cast, ActionResolved`), so this encoder wraps every cast too.
//
// ORDER. A real receipt emits its effect rows BEFORE the `Cast` (fight_render_events.js:45); this mock has always
// emitted them after, and `core_fold.damaging_casts` reads that adjacency — so that derivation is correct against
// the MOCK, not the chain — on captured receipts it disagrees with the envelope far more often than it agrees.
// The envelope brackets the action either way — opening before any `ActionEffect`, retiring after the last one.

/** `ActionStarted.action_kind` / `ActionResolved.action_kind` — `fight_events::action_kind_spell()`. */
const ACTION_KIND_SPELL = 0

/** `ActionResolved.crit_bound` — `action_envelope::CRIT_BOUND`, the fixed denominator every player arm carries. */
const CRIT_BOUND = 10_000

/** A cast the chain wraps no envelope around (see `cast_envelope`). */
const NO_ENVELOPE = { started: null, effects: [], resolved: null }

/** `ActionResolved`'s unused arms — the zeros `action_envelope::emit_player_spell` / `emit_mob_spell` pass for
 *  the WEAPON snapshot and the &Random ledger a spell never fills (action_envelope.move:105-139). */
const NO_WEAPON = {
  weapon_element: 0,
  weapon_damage: u64(0),
  weapon_crit_damage: u64(0),
  weapon_crit_rate: u64(0),
  weapon_ap_cost: u64(0),
  weapon_reach: u64(0),
  weapon_lines: [],
}
const NO_RANDOM = {
  crit_roll: u64(0),
  fumble_roll: u64(0),
  fumble_bound: u64(0),
  random_domains: '',
  random_effect_ordinals: [],
  random_rolls: [],
  random_bounds: [],
}

/** The authored spell level a cast resolved at — the sim's own lookup (`spell_levels[id] ?? 1`, reduce.js). */
const level_of = (state, entity_id, spell_id, templates) => {
  const template = templates?.get?.(spell_id)
  if (!template) return null
  const entity = state.team0.concat(state.team1).find((e) => e.id === entity_id)
  const level = Number(entity?.spell_levels?.[spell_id] ?? 1)
  const authored_level = template.levels?.[level - 1]
  if (!authored_level) throw new Error(`sim_chain: spell '${spell_id}' has no authored level ${level}`)
  return authored_level
}

/** The effect list the cast resolved from — `process_spell_cast`'s own selection (fight_spells.js:558-564). */
const effects_of_level = (level, is_critical) =>
  (is_critical && level.crit_effects?.length > 0 ? level.crit_effects : level.base_effects) ?? []

/** A normalized sim effect → the u64 the chain's `Effect.value` rides. The sim splits a SIGNED row into its row
 *  TYPE (`ADD`/`REMOVE`) plus a magnitude (`spell_templates.normalize_effect`); the chain re-joins them into one
 *  centered u64, so re-center through the same home the client decodes with. Every other kind is a plain
 *  magnitude on both sides. */
const chain_effect_value = (effect) => {
  const magnitude = Number(effect.value ?? 0) || 0
  if (!is_signed_status_kind(effect.kind)) return magnitude
  return encode_status_value(effect.kind, effect.type === 'REMOVE' ? -magnitude : magnitude)
}

/**
 * ONE authored sim effect → the chain `Effect` descriptor `ActionEffect.effect` carries. Every field is the
 * normalized row's OWN value re-stated in the chain's units: `raw_stat` IS the chain stat id the normalizer
 * read, `element` inverts `ELEMENT_MAP`, and `value`/`area_size` ride as u64 strings like every captured row.
 */
const chain_effect_descriptor = (effect) => ({
  area_shape: Number(effect.area_shape) || 0,
  area_size: u64(effect.area_size ?? 0),
  // The sim resolves a row with no authored chance as always-applying; the chain writes that as 100.
  chance: effect.chance == null ? 100 : Number(effect.chance),
  element: ELEMENT_ORDINAL[effect.element] ?? 255,
  flags: Number(effect.flags) || 0,
  kind: effect.kind,
  phase: Number(effect.phase) || 0,
  stat: Number(effect.raw_stat) || 0,
  target_filter: Number(effect.target_filter) || 0,
  turns: Number(effect.turns) || 0,
  // THE WIRE FORM, byte-for-byte (#983). A signed kind rides CENTERED on chain (`32768 + delta`,
  // `participant::alter_delta`), and the receipt door now decodes it exactly once like every other client door —
  // so this encoder must state the centering rather than pre-decode it, or the simulator feeds the fold a second
  // dialect. The sim normalizer carries the sign in the row TYPE and the magnitude in `value` (spell_templates
  // `normalize_effect`), which is precisely what the centering re-joins.
  value: u64(chain_effect_value(effect)),
})

/**
 * The envelope rows bracketing one `fight_cast`. `turn_ordinal` is the sim's `turn_number` — the documented
 * numeric twin of Move's per-seat `SeatTurnKey` / per-mob `action_envelope::mob_turn` (fight_state.js:154,
 * action_envelope.move:32-34). `action_ordinal` is the caster's action counter for that turn (`participant::
 * casts_this_turn` / `next_mob_action`), threaded by the driver because one encode step sees one command.
 *
 * `ActionResolved` states the identity arms the sim HOLDS and `option::none()` for the rest, exactly as
 * `action_envelope.move` passes them: a player cast names its spell, a mob cast names its group template.
 * `spell_level` and `mob_spell_ordinal` are authored chain artefacts the sim never receives — it carries the
 * spell id instead — so they ride as the chain's own none rather than an invented snapshot.
 */
const cast_envelope = (state, event, ctx) => {
  const { is_mob, idx } = side_of(state, event.entity_id)
  const level = level_of(state, event.entity_id, event.spell_id, ctx.spell_templates)
  if (!level) return NO_ENVELOPE
  const authored = effects_of_level(level, !!event.is_critical)
  // A chain `Effect` is identified by its numeric `kind`; the normalizer only carries one when the template was
  // authored in the CHAIN shape. A template with NO chain kind anywhere has no chain existence at all — the
  // sim's built-in mob strike is exactly that, and `normalize_chain_spell_corpus` excludes it from the chain
  // corpus by design — so the chain wraps no envelope around it and neither does this encoder. A template that
  // mixes the two shapes is corrupt, and stays LOUD rather than emitting a descriptor with an invented opcode.
  const chain_shaped = authored.filter((effect) => typeof effect?.kind === 'number')
  if (chain_shaped.length === 0) return NO_ENVELOPE
  if (chain_shaped.length !== authored.length)
    throw new Error(`sim_chain: spell '${event.spell_id}' mixes chain-shaped and legacy effect rows`)
  const descriptors = authored.map(chain_effect_descriptor)
  const turn_ordinal = u64(state.turn_number ?? 0)
  const action_ordinal = u64(ctx.next_action(event.entity_id, state.turn_number ?? 0))
  const target_cell = u64(encode(event.target.x, event.target.y))
  const ap_cost = u64(level.cost ?? 0)
  const key = { fight: ctx.fight_id, caster_is_mob: is_mob, caster_idx: u64(idx), turn_ordinal, action_ordinal }
  const entity = state.team0.concat(state.team1).find((e) => e.id === event.entity_id)
  return {
    started: row('ActionStarted', {
      ...key,
      action_kind: ACTION_KIND_SPELL,
      target_cell,
      ap_cost,
      effect_count: u64(descriptors.length),
    }),
    effects: descriptors.map((effect, ordinal) =>
      row('ActionEffect', { ...key, effect_ordinal: u64(ordinal), effect })
    ),
    resolved: row('ActionResolved', {
      ...key,
      target_cell,
      action_kind: ACTION_KIND_SPELL,
      ap_cost,
      critical: !!event.is_critical,
      fumbled: (event.effects ?? []).some((e) => e.status === 'CRITICAL_FAILURE_FUMBLE'),
      returned: false,
      spell: is_mob ? null : String(event.spell_id),
      learned_level: is_mob ? 0 : Number(entity?.spell_levels?.[event.spell_id] ?? 1),
      spell_level: null,
      mob_template: is_mob ? (entity?.template_id ?? null) : null,
      mob_spell_ordinal: null,
      ...NO_WEAPON,
      ...NO_RANDOM,
      crit_bound: u64(is_mob ? 0 : CRIT_BOUND),
    }),
  }
}

/**
 * Encode ONE sim event into its chain rows. Pure per event; `ctx.cells` is the running cell index the encoder
 * builds as it goes (a local accumulator, not a caller's value) so `Displaced.from_cell` is the true origin.
 * @returns {{ rows: object[] }}
 */
const encode_event = (event, ctx) => {
  const { fight_id, post_state, pre_state, now_ms, turn_ms, turn_context } = ctx
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
      return {
        rows: [
          row('TurnStarted', {
            fight,
            is_mob,
            idx: u64(idx),
            deadline_ms: u64(now_ms + turn_ms),
            turn_entropy: u64(turn_context?.turn_entropy ?? 0),
            turn_ordinal: u64(turn_context?.turn_ordinal ?? 0),
          }),
        ],
      }
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
      // The ACTION ENVELOPE brackets the cast (#973): without `ActionStarted`/`ActionEffect` the receipt states
      // no durable status at all and every timed chip stays prediction-only.
      const envelope = cast_envelope(post_state, event, ctx)
      const bracketed = [cast, ...effects_of(event.effects)]
      return {
        rows: envelope.started ? [envelope.started, ...envelope.effects, ...bracketed, envelope.resolved] : bracketed,
      }
    }
    case 'fight_trap_triggered':
    case 'fight_turn_effects':
      return { rows: effects_of(event.effects) }
    case 'fight_abandoned': {
      // A forfeit is its OWN chain event, never a doubled Hit (actions.move `mark_abandoned` →
      // `fight_events::emit_abandoned{ character, seat }`), so the sim's damage row is not encoded here — the
      // Abandoned row carries the death, exactly as `inputs.js` folds it (hp 0 + alive false).
      // `inputs.js` keys that fold `is_mob:false` because "a forfeit is always a player". That is now an
      // INVARIANT rather than an assumption: `reduce.js` `handle_abandon` refuses every non-seat abandon
      // (the ENotParticipant twin — a mob and a summon hold no seat), so this event can only ever name a
      // player. A team1 forfeit is a PvP shape this PvM encoder cannot express, so it is LOUD rather than a
      // row silently pointing at the wrong fighter.
      const { is_mob, idx } = side_of(post_state, event.entity_id)
      if (is_mob) throw new Error(`sim_chain: '${event.entity_id}' forfeited from team1 — no PvM Abandoned row`)
      return { rows: [row('Abandoned', { fight, character: event.entity_id, seat: u64(idx) })] }
    }
    case 'ap_reserve_used': {
      const { is_mob, idx } = side_of(post_state, event.entity_id)
      return {
        rows: [
          row('Granted', {
            fight,
            target_is_mob: is_mob,
            target_idx: u64(idx),
            point_kind: POINT_AP, // u8 — a native JSON number off Sui, unlike every u64 above
            granted: u64(event.ap_added ?? 0),
          }),
        ],
      }
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
 * rows the core folds. Every fighter identity resolves against `post_state`, the only state that still names
 * them all after the step (a mid-step death removes no row).
 *
 * `spell_templates` is the sim's own template map (`chain.ctx.spell_templates`): the action envelope states the
 * AUTHORED effect descriptors, which live on the template and nowhere in the event. `actions` is the caster's
 * per-turn action counter carried ACROSS steps (one command = one step, but a turn holds several casts) — it
 * rides in and out so this stays a pure function of its inputs, exactly like `Displaced`'s cell map.
 * @param {{ pre_state: object, post_state: object, events: object[], fight_id: string,
 *   now_ms?: number, turn_ms?: number, spell_templates?: Map<string, object>,
 *   actions?: Record<string, number>, turn_context?: object }} params
 * @returns {{ rows: object[], actions: Record<string, number> }}
 */
export const encode_sim_step = ({
  pre_state,
  post_state,
  events,
  fight_id,
  now_ms = 0,
  turn_ms = DEFAULT_TURN_MS,
  spell_templates = null,
  actions = {},
  turn_context = null,
}) => {
  if (post_state.team0.length !== pre_state.team0.length || post_state.team1.length !== pre_state.team1.length)
    // A SUMMON grew a team. Participant/mob indices are POSITIONAL in the snapshot and the chain has no event
    // admitting a new fighter mid-fight, so this cannot be encoded — only reported. Loud by law.
    throw new Error('sim_chain: roster changed mid-step (summon) — no chain row can express it')

  const counters = { ...actions }
  const ctx = {
    fight_id,
    pre_state,
    post_state,
    now_ms,
    turn_ms,
    spell_templates,
    turn_context,
    cells: new Map([...pre_state.team0, ...pre_state.team1].map((e) => [e.id, encode(e.cell.x, e.cell.y)])),
    next_action: (entity_id, turn) => {
      const key = `${entity_id}:${turn}`
      const ordinal = counters[key] ?? 0
      counters[key] = ordinal + 1
      return ordinal
    },
  }
  const encoded = events.map((event) => encode_event(event, ctx))
  return { rows: chain_emission_order(events, encoded), actions: counters }
}

/**
 * THE CHAIN'S EMISSION ORDER (#954). `movement::walk` fires a crossed trap INLINE, so the chain emits the
 * detonation's `Hit` rows and only THEN the walk's single `Moved`/`MobMoved` row (`actions.move:69`,
 * `turns.move:305` — both emit after `walk` returns). The sim reducer returns the move event first
 * (`reduce.js handle_move`: `[moved_event, ...walked.events]`), so the mock chain has to hoist a move's trap
 * triggers ahead of it or the simulator speaks a dialect the world never speaks.
 *
 * THE ROWS ARE REORDERED, NEVER THE EVENTS: encoding stays in reducer order so the running cell map still
 * resolves each `Displaced.from_cell` from the true origin.
 *
 * WHY THIS IS SAFE NOW, having been reverted once: alone, the alignment merely handed the simulator the world's
 * symptom — with the renderer blind to mid-path traps, a `Hit` arriving before its move row was flushed into a
 * bare `fight` turn at at:0 and read as "damage at turn start, before the mob moved". The renderer now claims a
 * walk's trap Hits in EITHER order and pins that equality
 * (`trap_midpath_crossing.test.js`, "SIM order renders byte-identically to the chain order"), so the two
 * emitter orders are indistinguishable downstream and this only removes a divergence.
 */
const chain_emission_order = (events, encoded) => {
  const rows = []
  for (let index = 0; index < events.length; index += 1) {
    if (events[index].type !== 'fight_moved') {
      rows.push(...encoded[index].rows)
      continue
    }
    let after = index + 1
    while (after < events.length && events[after].type === 'fight_trap_triggered') after += 1
    for (let trap = index + 1; trap < after; trap += 1) rows.push(...encoded[trap].rows)
    rows.push(...encoded[index].rows)
    index = after - 1
  }
  return rows
}
