// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/board_state.js — the PURE chain→client decoder for a fight board: a decoded `aresrpg_fight::fight::Fight`
// (+ run context) → the rich board view every consumer reads (escrow rows, mobs, board geometry, turn machine).
// MOVED VERBATIM from the deleted fight_bridge.js `fight_view` half (S2 flip) — the renderer contract is
// UNCHANGED; only the home moved into the core (one home: the core owns every fight-state shape).
//
// CELLS: the engine board IS canonical stride-20 (combat_grid GRID_W=20 is the SSOT stride; the playable
// `width` 7-17 is NOT the stride) — inbound cells are identity-mapped, bounds-guarded.
// TURN QUEUE: the chain stores its interleaved queue at activation; pre-activation it is REPLICATED here with
// the exact even-interleave rule (interleave.move) — same inputs, same queue the chain will materialize.

import { chain_to_world, DEFAULT_WORLD_OFFSET } from '@aresrpg/sdk/coords'

import { GRID_CELLS, encode } from './los.js'
import { status_snapshot_entities } from './fight_status_snapshot.js'
import { participant_entity_id } from './fight_control.js'

// Legacy status codes — the ONE lifecycle scalar every consumer branches on (preserved verbatim).
export const STATUS_OPEN = 0 // a live RunPass with NO room fight yet (pre-engage roam on the plane)
export const STATUS_ACTIVE = 1
export const STATUS_ROOM_CLEARED = 2 // fight VICTORY on a non-last room (settle_run advances the pass)
export const STATUS_WON = 3 // fight VICTORY on the LAST room (settle_run consumes the pass)
export const STATUS_FAILED = 4 // fight DEFEAT (settle_run kills the run)
export const STATUS_PLACEMENT = 5

// Engine `Fight.status` scalars (fight.move — decoded as numbers by @aresrpg/sdk/fight).
const ENGINE_PLACEMENT = 0
const ENGINE_ACTIVE = 1
const ENGINE_DEFEAT = 3

// THE ROSTER WINDOW (#1274) — the ONE law for "can the chain still add a fighter to this fight?": `join` is legal
// ONLY while the fight is in PLACEMENT (engine fight.move `join_inner`, `ENotPlacement`), and a fight leaves
// placement exactly once. A base adopted inside that window is therefore PROVISIONAL — it must re-derive from a
// later placement read, or a joiner who lands after the creator's first read is invisible to her for the entire
// fight (her turn order, her placement occupancy, and every event keyed to his character, which orphans off-seat).
// The two accessors below read the SAME law in the two vocabularies this module already translates between.

/** The window, read off a decoded board view (client `status`). @param {{status?:number}|null} view */
export const roster_open = (view) => view?.status === STATUS_PLACEMENT

/** The window, read off a RAW decoded chain record (engine `status`) — for doors that decide whether to adopt a
 *  read BEFORE deriving its view. @param {{status?:number}|null} fight */
export const fight_roster_open = (fight) => Number(fight?.status ?? 0) === ENGINE_PLACEMENT

/** A chain BoardGeom cell → the client's canonical cell — IDENTITY (bounds-guarded; the engine board is
 *  canonical stride-20). An out-of-range cell (decode fault) collapses to 0 rather than mis-strided. */
function to_canonical(/** @type {number} */ cell) {
  const c = Number(cell) || 0
  return c >= 0 && c < GRID_CELLS ? c : 0
}

/** Client canonical cell → the chain tx target — IDENTITY (see to_canonical). The legacy `_width` arg is kept
 *  for unchanged call sites and ignored. */
export function to_fight_cell(/** @type {number} */ canonical, /** @type {number} */ _width) {
  return Number(canonical) || 0
}

/**
 * Replicate the engine's even interleave (interleave.move `order`): players (seat order) = side A, mobs (spawn
 * order) = side B; emit A iff (2·ia+1)·|b| ≤ (2·ib+1)·|a| (tie → A). Same inputs → same queue as the chain.
 * @param {number} players @param {number} mobs @returns {{is_mob: boolean, idx: number}[]}
 */
export function interleave_order(players, mobs) {
  const out = []
  let ia = 0
  let ib = 0
  while (ia < players || ib < mobs) {
    const take_a = ia >= players ? false : ib >= mobs ? true : (2 * ia + 1) * mobs <= (2 * ib + 1) * players
    if (take_a) out.push({ is_mob: false, idx: ia++ })
    else out.push({ is_mob: true, idx: ib++ })
  }
  return out
}

// The §17.27 unarmed line (participant.move unarmed_line — bare hands: earth, dmg 4, ap 3, reach 1).
const UNARMED_WEAPON = { element: 2, damage: 4, crit_damage: 6, crit_rate: 30, ap_cost: 3, reach: 1 }

/** Decode the chain-stored `shape_mask` (combat_grid.move u64 BITSET words, BigInt-lossless off the SDK) into
 *  the canonical stride-20 on-cell Set. Empty/absent ⇒ empty Set → callers use the rect fallback.
 *  @param {any} words @returns {Set<number>} */
export function decode_shape_mask(words) {
  const mask = new Set()
  if (!Array.isArray(words)) return mask
  for (let w = 0; w < words.length; w++) {
    let bits = BigInt(words[w] ?? 0)
    for (let b = 0; bits > 0n && b < 64; b++, bits >>= 1n) {
      if (bits & 1n) {
        const cell = w * 64 + b
        if (cell < GRID_CELLS) mask.add(cell)
      }
    }
  }
  return mask
}

/**
 * The VOID cells of a `width × height` board — every cell inside the rect that the deterministic shape mask
 * does NOT cover (D231: the renderer draws nothing there and they are unpickable, which is what makes a
 * generated board organic instead of a square). The complement is the ONE derivation both board renderers
 * read: the world fight board (world-shell/voxel_fight_folds `build_args_from_dungeon`) and the simulator's
 * derived board (simulator/board.ts) used to walk this rect independently, so a mask convention change could
 * have landed on one surface and not the other.
 *
 * An EMPTY mask means "no shape was published" (a legacy mask-less record), which is not the same as "every
 * cell is a void": it yields NO voids and the caller renders the full rect, exactly as before.
 *
 * @param {number} width @param {number} height
 * @param {ReadonlySet<number>} inside the canonical stride-20 ON-cells (`decode_shape_mask`'s output)
 * @returns {{ x: number, y: number }[]} the complement, row-major
 */
export function voids_from_shape_mask(width, height, inside) {
  if (!inside?.size) return []
  const voids = []
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (!inside.has(encode(x, y))) voids.push({ x, y })
  return voids
}

/** A decoded participant `Weapon` struct → the plain attack line the board prices the strike from. Tolerates the
 * `.fields` VecMap wrap; missing/blank falls back to the unarmed line (never a 0-reach gate). */
function normalize_weapon(raw) {
  const w = raw?.fields ?? raw
  if (!w || typeof w !== 'object') return { ...UNARMED_WEAPON }
  return {
    element: Number(w.element ?? UNARMED_WEAPON.element),
    damage: Number(w.damage ?? UNARMED_WEAPON.damage),
    crit_damage: Number(w.crit_damage ?? UNARMED_WEAPON.crit_damage),
    crit_rate: Number(w.crit_rate ?? UNARMED_WEAPON.crit_rate),
    ap_cost: Number(w.ap_cost ?? UNARMED_WEAPON.ap_cost),
    reach: Math.max(1, Number(w.reach ?? UNARMED_WEAPON.reach)),
  }
}

/**
 * A decoded `spell::Stats` struct → the plain numeric snapshot the sim's damage/resistance formulas read. The
 * field names ARE the Move struct's own (`spell.move Stats` ≡ `@aresrpg/sim` `Stats` — one vocabulary, owned by
 * the deterministic twin and deliberately not re-listed here), so this only unwraps the gRPC `.fields` nesting
 * and coerces u64-as-decimal-string to Number. Absent/blank ⇒ `{}`; the sim reads a missing key as 0.
 * @param {any} raw @returns {Record<string, number>}
 */
export function normalize_stats(raw) {
  const block = raw?.fields ?? raw
  if (!block || typeof block !== 'object') return {}
  /** @type {Record<string, number>} */
  const out = {}
  for (const [key, value] of Object.entries(block)) {
    const scalar = Number(value?.fields ?? value)
    if (Number.isFinite(scalar)) out[key] = scalar
  }
  return out
}

/**
 * A decoded `VecMap<ID, u8>` (participant.move `spell_levels`) → `{ [spell_template_object_id]: level }` — the
 * seat's LEARNED spell levels, snapshotted at join. Over gRPC json a VecMap renders flat as
 * `{ contents: [{ key, value }] }`; a nested read wraps entries in `.fields` (the same two shapes
 * read_character's spellbook decode handles). Absent/empty ⇒ `{}`, which every reader takes as "level 1, the
 * free unlock" — exactly what `participant.move` means by an absent key.
 * @param {any} raw @returns {Record<string, number>}
 */
export function decode_spell_levels(raw) {
  const map = raw?.fields ?? raw
  const contents = map?.contents ?? (Array.isArray(map) ? map : [])
  /** @type {Record<string, number>} */
  const out = {}
  for (const entry of contents) {
    const row = entry?.fields ?? entry ?? {}
    const id = String(row.key?.fields?.id ?? row.key?.id ?? row.key ?? '')
    const level = Number(row.value?.fields ?? row.value ?? 0)
    if (id && Number.isFinite(level) && level > 0) out[id] = level
  }
  return out
}

/** The engine seat's entity id at a seat index (character id), or null. */
export const seat_entity_at = (view, seat) => (view?.escrow?.[seat] ? participant_entity_id(view.escrow[seat]) : null)

/** True iff a decoded Fight carries its REAL BoardGeom. A torn read-after-write record decodes width/height
 *  NUMERIC ZERO (`decode_fight`: `Number(board.width ?? 0)` over a missing/empty `board` — fight_read.js) —
 *  such a record must NEVER present: the GRID fallback dims + empty start cells are a wrong frame, not a
 *  shape (the 07-18 adaptive-run composite: board mounted, zero placement highlights). A synthetic fixture
 *  that simply OMITS the fields never passed through decode and stays complete — 0 is the decode's own
 *  torn-read signature, undefined is not. */
export const fight_geometry_complete = (fight) => Number(fight?.width) !== 0 && Number(fight?.height) !== 0

/**
 * Build the board view from a decoded engine `Fight` + the run context. Null fight + a live run = the OPEN
 * (pre-engage) view. `version` is the Fight OBJECT version (the snapshot-adoption floor). `offset` is the
 * per-world `bounds/2` world↔chain codec offset (@aresrpg/sdk/coords world_offsets).
 * @param {{ fight?: any, version?: number|string|bigint, run?: { id:string, room:number, world:string } | null,
 *           rooms_total?: number, mob_names?: Record<string,string>, mob_levels?: Record<string,number>,
 *           mob_elements?: Record<string,number>, creator?: string | null,
 *           offset?: { x: number, z: number } }} args
 */
export function board_state_from_fight({
  fight = null,
  version = 0,
  run = null,
  rooms_total = 0,
  mob_names = {},
  mob_levels = {},
  mob_elements = {},
  creator = null,
  offset = { x: DEFAULT_WORLD_OFFSET, z: DEFAULT_WORLD_OFFSET },
}) {
  if (!fight) {
    if (!run) return null
    return {
      id: run.id,
      status: STATUS_OPEN,
      room_index: Math.max(0, (run.room ?? 1) - 1),
      creator,
      version: Number(version) || 0,
      escrow: [],
      mobs: [],
      turn_ptr: 0,
      turn_queue: [],
      turn_deadline_ms: 0,
      placement_deadline_ms: 0,
      world_seed: null,
      spawn_id: null,
      obstacles: [],
      holes: [],
      start_cells_a: [],
      start_cells_b: [],
      party_xp_pool: 0,
    }
  }
  // D771 (no invented dims — proper systems never fall back to fabricated values): the snapshot door gates on
  // fight_geometry_complete, so an adopted fight ALWAYS carries numeric dims here. A dims-less record yields 0
  // (an unrepresentable 0×0 board that holds) rather than a fabricated phantom GRID_W×GRID_H frame.
  const width = Number(fight.width) || 0
  const height = Number(fight.height) || 0
  const canon = (/** @type {any} */ c) => to_canonical(c)
  const escrow = (fight.participants ?? []).map((/** @type {any} */ p, /** @type {number} */ seat) => {
    // THE SEAT'S COMPOSED BUILD (#1077) — ONE object per fact, carried end to end so no surface has to invent a
    // subset. `stats` is the LIVE block (participant.move re-derives it per alter: base + the timed rows);
    // `base_stats` is the JOIN SNAPSHOT, and that is what the fight reducer takes as an entity's `stats` — it
    // re-adds the timed rows itself from `effects`, so feeding it the live block would double-count them.
    // `spell_levels` is the seat's learned level per SpellTemplate object id (absent ⇒ 1).
    const stats = normalize_stats(p.stats)
    const base_stats = normalize_stats(p.base_stats)
    return {
      seat,
      addr: p.owner,
      character: p.character,
      name: '',
      classe: p.class ?? '',
      team: Number(p.team ?? 0),
      hp: Number(p.hp ?? 0),
      max_hp: Number(p.max_hp ?? 0),
      ap: Number(p.ap ?? 0),
      mp: Number(p.mp ?? 0),
      base_ap: Number(p.base_ap ?? 6),
      base_mp: Number(p.base_mp ?? 3),
      cell: canon(p.cell),
      ready: Boolean(p.ready),
      alive: Number(p.hp ?? 0) > 0,
      casts_this_turn: Number(p.casts_this_turn ?? 0),
      weapon: normalize_weapon(p.weapon),
      stats,
      base_stats,
      spell_levels: decode_spell_levels(p.spell_levels),
      // LIVE agility: the tackle-contest input the move-wash projection (project.move_wash) prices the escape
      // fraction from. DERIVED off the block above — a named scalar, never a second decode.
      agility: stats.agility ?? 0,
      // Immutable join/equipment range. Timed rows stay in Fight.fx.statuses and are folded exactly once by
      // statuses.range_bonus_of; reading live stats here would double-count an already-active row.
      base_range: base_stats.range ?? 0,
    }
  })
  // IDENTITY JOIN KEY — the Fight's `group_template` (every FightMob is minted `template: @0x0`; provenance
  // rides the Fight). base_ap/base_mp are the group's shared kit budget, fanned out per row for the HUD.
  const group_template = fight.group_template || null
  const group_base_ap = Number(fight.group_base_ap ?? 0)
  const group_base_mp = Number(fight.group_base_mp ?? 0)
  const mobs = (fight.mobs ?? []).map((/** @type {any} */ m) => {
    const template = group_template || m.template
    // The TARGET's block is an input to MY damage number (resistances) — it rides the same two-block shape as a
    // seat: live for the tackle contest, the join snapshot for the reducer.
    const stats = normalize_stats(m.stats)
    const base_stats = normalize_stats(m.base_stats)
    return {
      template,
      element: Number(mob_elements?.[template] ?? 255),
      level: Number(m.level ?? mob_levels?.[template] ?? 1),
      hp: Number(m.hp ?? 0),
      max_hp: Number(m.max_hp ?? 0),
      cell: canon(m.cell),
      ap: Number(m.ap ?? 0),
      mp: Number(m.mp ?? 0),
      base_ap: group_base_ap,
      base_mp: group_base_mp,
      alive: Number(m.hp ?? 0) > 0,
      stats,
      base_stats,
      // LIVE agility (mob.move `FightMob.stats` — the per-fight mutable combat block): the locker side of the
      // tackle contest (project.move_wash). 0 when a legacy read omits stats (contest then prices bucket 2).
      agility: stats.agility ?? 0,
      base_range: base_stats.range ?? 0,
    }
  })
  const room_index = Math.max(0, (run?.room ?? 1) - 1)
  const engine_status = Number(fight.status ?? 0)
  const status =
    engine_status === ENGINE_PLACEMENT
      ? STATUS_PLACEMENT
      : engine_status === ENGINE_ACTIVE
        ? STATUS_ACTIVE
        : engine_status === ENGINE_DEFEAT
          ? STATUS_FAILED
          : run && rooms_total > 0 && (run.room ?? 1) < rooms_total
            ? STATUS_ROOM_CLEARED
            : STATUS_WON
  const shape_mask = decode_shape_mask(fight.shape_mask)
  const obstacles = (fight.obstacles ?? []).map(canon)
  const holes = (fight.holes ?? []).map(canon)
  const start_cells_a = (fight.start_cells_a ?? []).map(canon)
  const start_cells_b = (fight.start_cells_b ?? []).map(canon)
  // V2 · A5 OMISSION SIGNAL (register): preserve the distinction between a payload that MODELS the status class (an
  // array, incl []) and one that OMITS it (undefined). The store's omission-hold (fold.carry_statuses) reads this to
  // decide whether to HOLD a prior receipt-floored status or adopt "nobody has one" as authoritative. Coercing to []
  // here (the old `?? []`) destroyed the signal and let a thinner read silently drop a floored invisibility/buff.
  const invisibility_statuses =
    fight.invisibility_statuses === undefined
      ? undefined
      : status_snapshot_entities(fight.invisibility_statuses, escrow.map(participant_entity_id), mobs.length)
  return {
    id: fight.id,
    status,
    width,
    grid_width: width,
    grid_height: height,
    shape_mask: shape_mask.size ? shape_mask : undefined,
    anchor:
      fight.anchor_x || fight.anchor_z
        ? { x: chain_to_world(fight.anchor_x, offset.x), z: chain_to_world(fight.anchor_z, offset.z) }
        : null,
    room_index,
    creator,
    version: Number(version) || 0,
    escrow,
    mobs,
    turn_ptr: Number(fight.turn_ptr ?? 0),
    turn_queue: fight.queue?.length ? fight.queue : interleave_order(escrow.length, mobs.length),
    turn_ms: Number(fight.turn_ms ?? 0),
    turn_deadline_ms: Number(fight.turn_deadline_ms ?? 0),
    placement_deadline_ms: Number(fight.placement_deadline_ms ?? 0),
    world_seed: fight.world_seed ?? null,
    spawn_id: fight.spawn_id ?? null,
    obstacles,
    holes,
    start_cells_a,
    start_cells_b,
    party_xp_pool: 0,
    mob_names,
    invisibility_statuses,
  }
}
