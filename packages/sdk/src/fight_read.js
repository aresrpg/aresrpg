// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { get_object_json, option_value, to_bigint } from './sui/read/_object.js'

// FIGHT READS + DECODERS for `aresrpg_fight` — pure normalizers over the `json:true`-flattened Fight /
// FightResult objects + the lifecycle events, plus thin gRPC object-fetch wrappers. Zero backend. The pure
// decoders (`decode_fight` / `decode_fight_result` / `decode_fight_event`) take already-fetched json so they
// unit-test offline; the `get_*` factories bind the house gRPC Core client. Nested participants/mobs/loot arrive
// as flattened json and pass THROUGH raw (their per-fighter struct decode is a separate, richer concern — one
// home per fact, not re-derived here). Field names read firsthand from fight.move / results.move / events.move.

// Fight.status (fight.move) — the ONE client lifecycle scalar.
const STATUS_LABELS = ['placement', 'active', 'victory', 'defeat']

/** Map a `Fight.status` / `FightResult.outcome` u8 to its label (`unknown` out of range). */
export function fight_status_label(status) {
  return STATUS_LABELS[Number(status)] ?? 'unknown'
}

/** Coerce a flattened Move `vector<u64>` (json numbers/strings) to a `number[]`. Safe ONLY for vectors whose
 *  elements are bounded, small-magnitude cell INDICES (obstacles/holes/start_cells_* — board.move's GRID_CELLS
 *  bound is 380, combat_grid.move) — never for a real 64-bit-magnitude value. */
function to_number_array(vec) {
  return Array.isArray(vec) ? vec.map(v => Number(v)) : []
}

/** Coerce a flattened Move `vector<u64>` (json numbers/strings) to a `bigint[]` — LOSSLESS. Required for
 *  `shape_mask`: each element is a full u64 BITSET WORD (combat_grid.move packs 64 board-cell bits per word),
 *  so a word routinely carries a set high bit ≥ 2^53 (JS's safe-integer bound) — `Number()` silently drops
 *  those bits (proven: a real 16×8 board lost 26/125 mask cells). Reuses `to_bigint` (this file's one home for
 *  json→BigInt) per element. */
function to_bigint_array(vec) {
  return Array.isArray(vec) ? vec.map(v => to_bigint(v)) : []
}

/** Coerce a flattened Move `vector<Actor>` (interleave.move: `{is_mob, idx}` turn-queue slots) to `{is_mob, idx}[]`. */
function to_actor_array(vec) {
  return Array.isArray(vec) ? vec.map(a => ({ is_mob: Boolean(a.is_mob), idx: Number(a.idx ?? 0) })) : []
}

/**
 * Decode a `json:true`-flattened `fight::Fight` shared object into the client's render/turn state: lifecycle
 * status, aging/dial snapshot, board geometry, the turn machine, and the settlement cache. DEPLOYED SHAPE (S-69,
 * chain-verified on a live lineage-4 Fight): the struct GROUPS board geometry under `board: BoardGeom` and the
 * win-content cache under `group: GroupContent` (fight.move's 32-field protocol cap) — those sub-structs stay
 * NESTED in the gRPC json (only vectors/Options/numerics get flattened-to-string treatment), so this reads
 * `json.board.*` / `json.group.*` directly rather than assuming a flat top-level field. `queue: vector<Actor>`
 * is the STORED turn order (empty until activation; same `{is_mob, idx}` shape the client's own interleave
 * replication produces pre-activation). `participants`/`mobs` pass through raw (fighter-level decode is
 * separate). Null in → null out.
 * @param {any} json the flattened Move struct (from `get_object_json`)
 */
export function decode_fight(json) {
  if (!json) return null
  const board = json.board ?? {}
  const group = json.group ?? {}
  const kit = group.kit ?? {} // the group's shared mob kit (mob-kit dedup) — one home for all N mobs
  return {
    id: json.id,
    // provenance
    world: json.world,
    spawn_id: to_bigint(json.spawn_id),
    world_seed: to_bigint(json.world_seed),
    anchor_x: Number(json.anchor_x ?? 0),
    anchor_z: Number(json.anchor_z ?? 0),
    // join toggle
    public_fight: Boolean(json.public_fight),
    party_id: option_value(json.party_id),
    // §8 aging + engine-dial snapshot (read at lock)
    aged_bp: Number(json.aged_bp ?? 0),
    turn_ms: to_bigint(json.turn_ms),
    placement_ms: to_bigint(json.placement_ms),
    team_bound: Number(json.team_bound ?? 0),
    // lifecycle
    // NEVER a defaulted 0 (#1277): `status` is non-optional on chain, so an absent one is a TORN read and 0 is
    // the roster window — the one value that makes a live fight look provisional forever. Absent stays null and
    // the fight core's completeness gate refuses the record; `status_label` reads it as 'unknown'.
    status: json.status == null ? null : Number(json.status),
    status_label: fight_status_label(json.status),
    // fighters (raw flattened arrays + convenience counts)
    participants: json.participants ?? [],
    mobs: json.mobs ?? [],
    participant_count: (json.participants ?? []).length,
    mob_count: (json.mobs ?? []).length,
    // board geometry — NESTED under `board` (fight.move BoardGeom; the client renders these, no JS re-derivation)
    width: Number(board.width ?? 0),
    height: Number(board.height ?? 0),
    // shape_mask is u64 BITSET WORDS (not cell indices) — BigInt end-to-end or high bits silently drop. Bit i of
    // word w reads as `(word >> BigInt(i)) & 1n`. obstacles/holes/start_cells_* stay Number: they're cell INDICES
    // bounded < 380 (GRID_CELLS), never a 64-bit-magnitude value.
    shape_mask: to_bigint_array(board.shape_mask),
    obstacles: to_number_array(board.obstacles),
    holes: to_number_array(board.holes),
    start_cells_a: to_number_array(board.start_cells_a),
    start_cells_b: to_number_array(board.start_cells_b),
    // turn machine — `queue` is the chain's OWN stored order (empty pre-activation; the caller replicates the
    // deterministic interleave for the placement window — see @aresrpg/frontend fight_bridge.interleave_order)
    queue: to_actor_array(json.queue),
    turn_ptr: Number(json.turn_ptr ?? 0),
    turn_deadline_ms: to_bigint(json.turn_deadline_ms),
    last_action_ms: to_bigint(json.last_action_ms),
    placement_deadline_ms: to_bigint(json.placement_deadline_ms),
    // settlement cache (the group's WIN content) — NESTED under `group` (fight.move GroupContent)
    group_template: group.template,
    group_xp: to_bigint(group.xp),
    // the group's shared mob-kit AP/MP base (fight.move MobKit — mob-kit dedup): every FightMob refills from this,
    // so the client surfaces it as each mob's ap/mp maximum. stats/spells stay content-resolved off group_template
    // (the sim + board already key the kit by the real MobTemplate id), so they are NOT decoded per-mob here.
    group_base_ap: Number(kit.base_ap ?? 0),
    group_base_mp: Number(kit.base_mp ?? 0),
  }
}

// ╔════════════════ [ The seat's AUTHORED weapon lines (§17.27 wave-2a) ] ═════ ]

/// The engine's per-seat weapon-line dynamic-field key (`fight.move WeaponLinesKey { seat: u64 }`). Matched by
/// SUFFIX, never by a package id: the key type carries its DEFINING package (type origin), which an upgrade
/// leaves behind while the deployment pointer moves on — an id-equality filter would silently find nothing on
/// the first upgraded lineage.
const WEAPON_LINES_KEY_SUFFIX = '::fight::WeaponLinesKey'

/**
 * Decode a flattened `vector<participant::WeaponLine>` into the client's plain per-element bands. `damage_max` /
 * `crit_damage_max` absent ⇒ their own floor (the FIXED line — `new_weapon_line` sets `damage_max: damage` on
 * chain), so one degradation path covers every authoring shape. Non-array ⇒ `[]` (the honest "no lines").
 * @param {any} json
 */
export function decode_weapon_lines(json) {
  if (!Array.isArray(json)) return []
  return json.map(line => {
    const damage = Number(line?.damage ?? 0)
    const crit_damage = Number(line?.crit_damage ?? damage)
    return {
      element: Number(line?.element ?? 255),
      damage,
      damage_max: Number(line?.damage_max ?? damage),
      crit_damage,
      crit_damage_max: Number(line?.crit_damage_max ?? crit_damage),
    }
  })
}

/**
 * Read a Fight's seat-keyed AUTHORED weapon lines → `{ [seat]: line[] }` (`{}` when the fight has none, which is
 * every bare-handed / un-authored seat and the honest degradation on an unreadable node).
 *
 * The engine seats these at `create`/`join` and attaches them as per-seat DYNAMIC FIELDS on the Fight
 * (`fight.move attach_weapon_lines`), so they do NOT ride the object json `get_fight` decodes — this is the only
 * door to them off-chain. They are also IMMUTABLE for a seat's lifetime (attached once, never updated), so a
 * caller reads them when the roster changes, not on every poll.
 *
 * WHY the client needs them at all: `cast.move` resolves a weapon strike from these lines and falls back to the
 * participant's single family `Weapon` only when a seat has none. A client that cannot see them prices every
 * strike off the family line and previews a number the chain will not settle (#1323).
 * @param {import("../types.js").Context} context
 */
export function get_weapon_lines(context) {
  const { grpc_client } = context
  return async fight_id => {
    try {
      /** @type {Record<number, ReturnType<typeof decode_weapon_lines>>} */
      const by_seat = {}
      let cursor = null
      do {
        const {
          dynamicFields,
          hasNextPage,
          cursor: next,
        } = await grpc_client.core.listDynamicFields({
          parentId: fight_id,
          cursor,
        })
        const ids = (dynamicFields ?? [])
          .filter(field =>
            String(field?.name?.type ?? '').endsWith(WEAPON_LINES_KEY_SUFFIX),
          )
          .map(({ fieldId }) => fieldId)
        if (ids.length) {
          const { objects } = await grpc_client.core.getObjects({
            objectIds: ids,
            include: { json: true },
          })
          for (const entry of objects ?? []) {
            if (entry instanceof Error) continue
            // `Field<WeaponLinesKey, vector<WeaponLine>>` flattens to `{ name: { seat }, value: [...] }`.
            const json = /** @type {any} */ (entry)?.json
            const seat = Number(json?.name?.seat ?? NaN)
            if (Number.isInteger(seat)) by_seat[seat] = decode_weapon_lines(json?.value)
          }
        }
        cursor = hasNextPage ? next : null
      } while (cursor)
      return by_seat
    } catch {
      return {}
    }
  }
}

/**
 * Decode a `json:true`-flattened `results::FightResult` (the soulbound per-seat outcome). `rolled` is a PLAIN
 * `vector<RolledLoot>` → `[{ item_template, qty }]` (empty `[]` on a defeat / no-drop victory). `loot` is the
 * group's table snapshot (roll INPUTS), passed through raw. Null in → null out.
 * @param {any} json
 */
export function decode_fight_result(json) {
  if (!json) return null
  // `rolled` is the CURRENT `results::FightResult.rolled` — a PLAIN `vector<RolledLoot>` (results.move), set at
  // `open` and shrinking one entry per `mint_rolled`. `json:true` flattens a plain vector to a plain ARRAY, so
  // decode it directly. It was mis-modelled here as the pre-S-46 `Option<vector>` and run through `option_value`,
  // which on a real NON-EMPTY vector `[{…}]` returns element[0] (a single object) — then `.map` THREW, the
  // caller's `.catch(()=>null)` blanked the whole result, the client minted nothing, and `burn_result` fired
  // against a still-full result → abort 105 ENotEmpty.
  const rolled = Array.isArray(json.rolled)
    ? json.rolled.map((/** @type {any} */ e) => ({ item_template: e.item_template, qty: to_bigint(e.qty) }))
    : []
  return {
    id: json.id,
    fight: json.fight,
    world: json.world,
    character: json.character,
    outcome: Number(json.outcome ?? 0),
    outcome_label: fight_status_label(json.outcome),
    final_hp: Number(json.final_hp ?? 0),
    xp_share: to_bigint(json.xp_share),
    aged_bp: Number(json.aged_bp ?? 0),
    chance: Number(json.chance ?? 0),
    mob_count: Number(json.mob_count ?? 0),
    is_opened: Array.isArray(json.rolled), // a FightResult only exists post-`open` — the field's presence IS opened
    rolled,
    loot: json.loot ?? [],
  }
}

// ╔════════════════ [ Events (single home = events.move) ] ════════════════════ ]

// S-46 SPLIT: the indexed fight lifecycle events below live in the ENGINE package's `fight_events` module — filter
// `${ENGINE_PACKAGE_ID}::fight_events::${name}`. The three FightResult events (ResultOpened /
// LootMinted / ResultBurned) are ALSO emitted from CORE `results` (`${PACKAGE_ID}::results::${name}`) when
// `open`/`mint_rolled`/`burn_result` run — filter both homes if you index the core FightResult lifecycle.
/** Every fight event struct name (engine `fight_events.move`) — the indexer type-filter set (see the note above). */
export const FIGHT_EVENT_NAMES = [
  'FightCreated',
  'FightJoined',
  'Placed',
  'Ready',
  'TurnStarted',
  'Moved',
  'Displaced',
  'Cast',
  'Hit',
  'TurnEnded',
  'Victory',
  'Defeat',
  'Settled',
  'ResultMinted',
  'ResultOpened',
  'LootMinted',
  'ResultBurned',
  'Swept',
]

/** The fully-qualified event type string for a fight lifecycle event (indexer/gRPC/GraphQL filter). Pass the ENGINE
 *  package id — the `fight_events` module lives there post-split (the three FightResult events also exist under core
 *  `${PACKAGE_ID}::results::${name}`; build that string directly if you filter the core home). */
export function fight_event_type(package_id, name) {
  return `${package_id}::fight_events::${name}`
}

// Numeric (u64/u32/u8) event fields across events.move — coerced to Number; every other field (fight / world /
// character / result / item_template / owner) is an ID/address kept as-is, and bools arrive as bools. Names are
// disjoint between the numeric and id sets, so a name-keyed coercion is unambiguous.
const NUMERIC_EVENT_FIELDS = new Set([
  'spawn_id',
  'anchor_x',
  'anchor_z',
  'aged_bp',
  'mob_count',
  'seat',
  'cell',
  'idx',
  'target_idx',
  'caster_idx',
  'victim_idx',
  'target_cell',
  'from_cell',
  'to_cell',
  'requested',
  'blocked',
  'deadline_ms',
  'amount',
  'remaining_hp',
  'outcome',
  'results',
  'xp_share',
  'final_hp',
  'loot_units',
  'qty',
])

/**
 * Decode a raw fight event into `{ kind, ...fields }`: `kind` is the struct name (e.g. `Moved`), numeric fields
 * are coerced to Number, ids/addresses/bools pass through. Accepts the common `{ type, parsedJson }` shape (with
 * `parsedType`/`json` fallbacks). Returns null if there is no payload.
 * @param {any} event a raw event (`{ type, parsedJson }`)
 */
export function decode_fight_event(event) {
  if (!event) return null
  const type = event.type ?? event.parsedType ?? ''
  const payload = event.parsedJson ?? event.json ?? event.contents
  if (!payload) return null
  const kind = String(type).split('::').pop() ?? ''
  const out = /** @type {Record<string, any>} */ ({ kind })
  for (const [key, value] of Object.entries(payload)) {
    // `Displaced.kind` is the mechanics code (push/pull), while `out.kind` is the event struct name used by every
    // consumer. Keep both facts instead of letting the payload overwrite the decoder discriminator.
    const output_key = key === 'kind' ? 'effect_kind' : key
    out[output_key] = key === 'kind' || NUMERIC_EVENT_FIELDS.has(key) ? Number(value) : value
  }
  return out
}

// ╔════════════════ [ Object fetches (gRPC Core) ] ════════════════════════════ ]

/**
 * Fetch + decode a `Fight` shared object by id (null if unreadable). The zero-backend fight-board read.
 * @param {import("../types.js").Context} context
 */
export function get_fight(context) {
  const { grpc_client } = context
  return async fight_id =>
    decode_fight(await get_object_json(grpc_client, fight_id))
}

/**
 * Fetch + decode a `FightResult` object by id (null if unreadable). The client drives `open`/`mint_rolled`/`burn`
 * off this (`is_opened`, `rolled`).
 * @param {import("../types.js").Context} context
 */
export function get_fight_result(context) {
  const { grpc_client } = context
  return async result_id =>
    decode_fight_result(await get_object_json(grpc_client, result_id))
}
