// SPAWNS RECONCILE — the pure machinery under the spawns_zones door (D770a W2): the moved rule homes
// (searchable / claimable / hysteresis), the chain→world row ingest, the [G]/[R] retargeting fold, and the
// two reconcile folds (versioned snapshot + chain-direct top-up) that make the atom order-independent —
// a poll never regresses a receipt-proven fact (grace-shielded adds/values, tombstoned removals) and an
// agreeing poll converges as a no-op. Everything here is a pure transform over plain data; the door
// (spawns_zones.js) is the only caller.

import { chain_to_world, DEFAULT_ZONE_SIZE } from '@aresrpg/sdk/coords'

// SPEC §6 "close enough shows press G" — the ONE ENGAGE distance: arms the [G] gather prompt on a resource AND
// gates the [R] claim LEGALITY on a mob group. Measured from the GROUP ANCHOR —
// the exact chain position `zones::claim_mob_group_in_zone` travel-verifies against.
export const PROXIMITY_M = 6
// [R] ATTACK-PROMPT VISIBILITY — the attack button should show at 3-4 blocks from the group, for
// convenience — the prompt ARMS on this WIDER ring, measured from the NEAREST group member (the mobs you
// actually see) rather than the invisible centroid. 10 blocks from the nearest member is ~3-4 blocks beyond the
// 6-block engage ring, so the prompt appears before you're in claim range; engaging still requires closing to
// PROXIMITY_M of the anchor (a press in the visible-but-far band gets the honest "get closer"). Splitting the
// two rings is the whole feature: VISIBILITY widened, LEGALITY unchanged.
export const ATTACK_VISIBLE_M = 10
// GATHER HYSTERESIS (client rider): K adjacent chain cells sit ~1 block apart — hold the armed target unless
// a different one is nearer by more than this many real blocks.
export const GATHER_HYSTERESIS_M = 0.75
// SEARCH FAST-PATH grace: a receipt-proven fact (chain-direct read post-cert) is shielded from a lagging
// /v1 snapshot (indexer ~1.5s + api cache 5s + client LRU 3s) for this long; a snapshot that AGREES clears
// the shield instantly. Applies symmetrically to adds (searched rows) and removals (claimed/gathered rows).
export const RECEIPT_GRACE_MS = 12000
// The search RP beat: the progress toast sweeps for this long while the tx flies (presentation as data).
export const SEARCH_PROGRESS_MS = 2600
const BEAT_KEEP = 12 // beats are fire-and-forget juice — keep a bounded tail for late subscribers/tests

/** @typedef {{ spawn_id: string|number, kind: 'mob'|'resource', x: number, z: number, [k: string]: any }} SpawnRow */
/** @typedef {{ discovered_at_ms: number|null, proven_at: number|null, rows: Map<string, SpawnRow>, row_proven: Map<string, number> }} ZoneEntry */
/** @typedef {{ seq: number, kind: string, at: number, duration?: number, payload?: any }} SpawnBeat */
/** @typedef {{ seq: number, kind: 'search'|'claim'|'gather', payload: any }} SpawnTxRequest */

// ── the searchable rule (moved from the HUD's compass_math — ONE home, mirrors zones.move::search_internal) ──

/** Whether an RPC zone row counts as discovered (the zones view serves only discovered rows, but be strict). */
export function zone_discovered(zone_row) {
  return !!zone_row && zone_row.discovered !== false
}

/** The epoch-ms a discovered zone re-opens for search (`discovered_at_ms + ttl`), or null when not applicable. */
export function reroll_at(zone_row, zone_ttl_ms) {
  if (!zone_discovered(zone_row) || !zone_ttl_ms || !zone_row.discovered_at_ms) return null
  return Number(zone_row.discovered_at_ms) + Number(zone_ttl_ms)
}

/**
 * Whether the zone at `(zx, zy)` is searchable NOW: undiscovered (no row), OR discovered with its TTL
 * elapsed. Mirrors `zones.move::search_internal`'s refusal gate exactly.
 * @param {any} zone_row the zone row for the cell, or null/undefined when undiscovered
 * @param {number|null} zone_ttl_ms the world's zone TTL (from the world doc)
 * @param {number} now epoch ms
 */
export function zone_searchable(zone_row, zone_ttl_ms, now) {
  if (!zone_discovered(zone_row)) return true
  const ready = reroll_at(zone_row, zone_ttl_ms)
  return ready != null && now >= ready
}

/** The RPC-row-shaped discovery fact for zone (zx, zy) as the receipt-reconciled core `zones` map currently
 *  knows it — `{discovered: true, discovered_at_ms}` once a receipt (zone_searched) or a snapshot has proven
 *  it, else null (undiscovered or not yet known). The explicit-cell read every `zone_row`-shaped predicate
 *  above (zone_discovered / reroll_at / zone_searchable) expects as input — the ONE home so a fold and an
 *  external projection (CompassStrip's own cell, computed off the published pose) never re-derive the shape.
 * @param {Map<string, ZoneEntry>} zones @param {number} zx @param {number} zy
 */
export function zone_row_of(zones, zx, zy) {
  if (zx == null || zy == null) return null
  const zone = zones.get(zone_key(zx, zy))
  return zone?.discovered_at_ms != null ? { discovered: true, discovered_at_ms: zone.discovered_at_ms } : null
}

// ── the claimability + hysteresis rules (moved from hunt_zone.js / spawn_rigs.js — renderer decides nothing) ──

/** True when the player stands within engage range of the group anchor — the ONE claimability gate (the
 *  deployed `zones::claim_mob_group_in_zone` door travel-verifies to the GROUP, so proximity is the honest
 *  client mirror; the row anchor IS the chain position the door verifies against). */
export function is_group_claimable(player_x, player_z, group_x, group_z, range) {
  const dx = Number(player_x) - Number(group_x)
  const dz = Number(player_z) - Number(group_z)
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || !(range > 0)) return false
  return dx * dx + dz * dz <= range * range
}

/** HYSTERESIS: hold the armed gather target unless a different node is MEANINGFULLY closer (margin_m). */
export function pick_gather_target({ armed_key, armed_d2, nearest_key, nearest_d2, margin_m }) {
  if (armed_key == null || armed_d2 == null) return nearest_key // nothing armed yet — just take the nearest
  if (armed_key === nearest_key || nearest_key == null) return armed_key // agree, or armed is the only one in range
  const armed_d = Math.sqrt(armed_d2)
  const nearest_d = Math.sqrt(nearest_d2)
  return nearest_d < armed_d - margin_m ? nearest_key : armed_key // switch only when MEANINGFULLY closer
}

// ── keys + ingest ────────────────────────────────────────────────────────────────────────────────────────────

export const zone_key = (zx, zy) => `${zx}:${zy}`

export const parse_key = (key) => {
  const [zx, zy, kind, ...rest] = String(key).split(':')
  return {
    zx: Number(zx),
    zy: Number(zy),
    kind,
    spawn_id: rest.join(':'),
    zone: zone_key(zx, zy),
    rk: `${kind}:${rest.join(':')}`,
  }
}

/** CHAIN-absolute rows → WORLD render space, keyed `kind:spawn_id` (the one ingest seam). */
export const ingest_rows = (state, rows) => {
  /** @type {Map<string, SpawnRow>} */
  const out = new Map()
  for (const row of rows ?? []) {
    const world_row = { ...row, x: chain_to_world(row.x, state.offset_x), z: chain_to_world(row.z, state.offset_z) }
    out.set(`${row.kind}:${row.spawn_id}`, world_row)
  }
  return out
}

export const blank_world = () => ({
  world_id: null,
  zone_size: DEFAULT_ZONE_SIZE,
  offset_x: 0,
  offset_z: 0,
  zone_ttl_ms: null,
  /** @type {{x:number,z:number}|null} SIGNED WORLD space — the proven standing position */
  checkpoint: null,
  /** @type {{zx:number,zy:number}|null} the checkpoint's zone — the hunt zone */
  hunt_zone: null,
  /** @type {Map<string, ZoneEntry>} */
  zones: new Map(),
  /** @type {Map<string, number>} receipt-proven REMOVALS (claimed/depleted rows) → removed_at; a lagging
   * snapshot re-listing one within the grace window must not resurrect it. */
  tombstones: new Map(),
  /** @type {Map<string, {kind:'search'|'claim'|'gather', at:number, payload?:any}>} pending-until-settle */
  pending: new Map(),
  snapshot_version: 0,
  /** @type {{x:number,z:number}|null} the renderer-reported player position (tick input) */
  player: null,
  /** @type {string|null} the armed [G] target (flat row key) — hysteresis memory */
  gather_target_key: null,
  /** @type {string|null} the armed [R] target (flat row key) — nearest group VISIBLE within ATTACK_VISIBLE_M */
  attack_target_key: null,
  /** @type {boolean} is the armed [R] target also within the ENGAGE ring (claimable → gold), or only visible? */
  attack_engageable: false,
  /** @type {Map<string, {x:number,z:number}[]>} per-mob-group member positions (world space) — a TYPED INPUT the
   * renderer feeds for its PLACED groups; the nearest-member basis of the [R] visibility ring. A group with none
   * fed falls back to its anchor (an unplaced group is always far, where anchor ≈ group — never mis-armed). */
  members: new Map(),
})

// ── shared fold helpers (every fold clones what it changes; inputs are never mutated) ────────────────────────

export const with_beats = (state, at, rows) => ({
  ...state,
  beat_seq: state.beat_seq + rows.length,
  beats: [...state.beats, ...rows.map((b, i) => ({ seq: state.beat_seq + i + 1, at, ...b }))].slice(-BEAT_KEEP),
})

export const with_request = (state, kind, payload) => ({
  ...state,
  req_seq: state.req_seq + 1,
  tx_request: { seq: state.req_seq + 1, kind, payload },
})

/** Remove one row as a RECEIPT-PROVEN removal (claim landed / node depleted) — tombstoned against stale polls. */
export const remove_row_proven = (state, key, now) => {
  const k = parse_key(key)
  const zone = state.zones.get(k.zone)
  if (!zone?.rows.has(k.rk)) return state
  const rows = new Map(zone.rows)
  rows.delete(k.rk)
  const row_proven = new Map(zone.row_proven)
  row_proven.delete(k.rk)
  const zones = new Map(state.zones)
  zones.set(k.zone, { ...zone, rows, row_proven })
  const tombstones = new Map(state.tombstones)
  tombstones.set(key, now)
  return { ...state, zones, tombstones }
}

export const clear_pending = (state, subject) => {
  if (!state.pending.has(subject)) return state
  const pending = new Map(state.pending)
  pending.delete(subject)
  return { ...state, pending }
}

// ── the [G]/[R] retargeting fold (the two relocated renderer decisions) ──────────────────────────────────────

/** Squared distance to a group's NEAREST fed member, or to the row anchor when the renderer has fed none (an
 *  unplaced group — always far, where anchor ≈ group). This is the [R] VISIBILITY basis. */
const nearest_member_d2 = (members, row, p) => {
  if (!members || members.length === 0) return (row.x - p.x) ** 2 + (row.z - p.z) ** 2
  let best = Infinity
  for (const m of members) {
    const d2 = (m.x - p.x) ** 2 + (m.z - p.z) ** 2
    if (d2 < best) best = d2
  }
  return best
}

/** One pass over the rows: nearest in-range resource + mob, and whether the armed [G] target is still live.
 *  The mob VISIBILITY ring is the wider ATTACK_VISIBLE_M measured from the nearest MEMBER; its ANCHOR distance
 *  rides along so retarget can flag whether that armed target is also within the ENGAGE ring (claimable). */
const scan_targets = (state, p) => {
  const range2 = PROXIMITY_M * PROXIMITY_M // resource gather ring + the mob ENGAGE (claimability) ring, from anchors
  const visible2 = ATTACK_VISIBLE_M * ATTACK_VISIBLE_M // the wider mob PROMPT ring, from the nearest member
  const hit = {
    nearest_res: null,
    nearest_res_d2: range2,
    armed_d2: null,
    nearest_mob: null,
    nearest_mob_d2: visible2,
    nearest_mob_anchor_d2: 0,
  }
  for (const [zk, zone] of state.zones)
    for (const [rk, row] of zone.rows) {
      const key = `${zk}:${rk}`
      if (row.kind === 'resource') {
        const d2 = (row.x - p.x) ** 2 + (row.z - p.z) ** 2
        if (key === state.gather_target_key && d2 <= range2) hit.armed_d2 = d2
        if (d2 < hit.nearest_res_d2) {
          hit.nearest_res_d2 = d2
          hit.nearest_res = key
        }
      } else if (!state.pending.has(`claim:${key}`)) {
        const member_d2 = nearest_member_d2(state.members.get(key), row, p)
        if (member_d2 < hit.nearest_mob_d2) {
          hit.nearest_mob_d2 = member_d2
          hit.nearest_mob = key
          hit.nearest_mob_anchor_d2 = (row.x - p.x) ** 2 + (row.z - p.z) ** 2 // legality is still anchor-based
        }
      }
    }
  return hit
}

/** Recompute the [G]/[R] targets off the player position + row/member positions (the fold half of the render
 *  contract). Emits BOTH [R] flags: `attack_target_key` (VISIBLE — arms the prompt) and `attack_engageable`
 *  (that target is within the ENGAGE ring → gold; else it shows un-gold and a press gets "get closer"). */
export const retarget = (state) => {
  const p = state.player
  if (!p)
    return state.gather_target_key === null && state.attack_target_key === null && !state.attack_engageable
      ? state
      : { ...state, gather_target_key: null, attack_target_key: null, attack_engageable: false }
  const hit = scan_targets(state, p)
  const gather_target_key = pick_gather_target({
    armed_key: hit.armed_d2 != null ? state.gather_target_key : null,
    armed_d2: hit.armed_d2,
    nearest_key: hit.nearest_res,
    nearest_d2: hit.nearest_res === null ? null : hit.nearest_res_d2,
    margin_m: GATHER_HYSTERESIS_M,
  })
  const attack_target_key = hit.nearest_mob
  const attack_engageable = attack_target_key != null && hit.nearest_mob_anchor_d2 <= PROXIMITY_M * PROXIMITY_M
  if (
    gather_target_key === state.gather_target_key &&
    attack_target_key === state.attack_target_key &&
    attack_engageable === state.attack_engageable
  )
    return state
  return { ...state, gather_target_key, attack_target_key, attack_engageable }
}

// ── the reconcile folds ──────────────────────────────────────────────────────────────────────────────────────

/** One fetched cell's next row set: fresh rows minus live tombstones, with receipt-proven values holding
 *  against a lagging poll (omitted → carried · disagreeing → proven wins · agreeing → shield dropped). */
const reconcile_cell = (state, prev, fresh, zk, tombstones, now) => {
  /** @type {Map<string, SpawnRow>} */
  const rows = new Map()
  /** @type {Map<string, number>} */
  const row_proven = new Map()
  for (const [rk, row] of fresh) {
    const flat = `${zk}:${rk}`
    const removed_at = tombstones.get(flat)
    // a receipt removed this row; a lagging snapshot re-listing it within grace must NOT resurrect it.
    if (removed_at != null && now < removed_at + RECEIPT_GRACE_MS) continue
    if (removed_at != null) tombstones.delete(flat)
    rows.set(rk, row)
  }
  for (const [rk, proven_at] of prev?.row_proven ?? []) {
    const proven_row = prev?.rows.get(rk)
    if (now >= proven_at + RECEIPT_GRACE_MS || !proven_row) continue // shield lapsed — the snapshot wins
    const listed = fresh.get(rk)
    if (listed && JSON.stringify(listed) === JSON.stringify(proven_row)) continue // agreement — confirmed
    rows.set(rk, proven_row)
    row_proven.set(rk, proven_at)
  }
  return { rows, row_proven }
}

/** An unfetched zone (outside the poll's neighbourhood): rows drop — except grace-shielded proven ones. */
const carry_proven_rows = (prev, now) => {
  /** @type {Map<string, SpawnRow>} */
  const rows = new Map()
  /** @type {Map<string, number>} */
  const row_proven = new Map()
  for (const [rk, proven_at] of prev?.row_proven ?? [])
    if (now < proven_at + RECEIPT_GRACE_MS && prev?.rows.has(rk)) {
      rows.set(rk, prev.rows.get(rk))
      row_proven.set(rk, proven_at)
    }
  return { rows, row_proven }
}

/** The versioned 6s snapshot: the atomic reconcile across the discovered-zone list + fetched neighbourhood. */
export const fold_snapshot = (state, input, now) => {
  const version = Number(input.version) || 0
  if (version <= state.snapshot_version) return state // stale poll — the versioned-snapshot guard
  /** @type {Map<string, ZoneEntry>} */
  const zones = new Map()
  const listed = new Map((input.zones ?? []).map((z) => [zone_key(z.zx, z.zy), z]))
  const cells = new Map((input.cells ?? []).map((c) => [zone_key(c.zx, c.zy), c]))
  const tombstones = new Map(state.tombstones)
  for (const [zk, z] of listed) {
    const prev = state.zones.get(zk)
    const cell = cells.get(zk)
    const { rows, row_proven } = cell
      ? reconcile_cell(state, prev, ingest_rows(state, cell.rows), zk, tombstones, now)
      : carry_proven_rows(prev, now)
    zones.set(zk, { discovered_at_ms: z.discovered_at_ms ?? null, proven_at: null, rows, row_proven })
  }
  // a receipt-DISCOVERED zone a lagging snapshot omits survives inside its grace window.
  for (const [zk, prev] of state.zones)
    if (!zones.has(zk) && prev.proven_at != null && now < prev.proven_at + RECEIPT_GRACE_MS) zones.set(zk, prev)
  // tombstones whose row no snapshot lists anymore are consumed (the chain converged) — GC on expiry.
  for (const [flat, removed_at] of tombstones) if (now >= removed_at + RECEIPT_GRACE_MS) tombstones.delete(flat)
  return retarget({ ...state, snapshot_version: version, zones, tombstones })
}

/** A single-zone chain-direct top-up (the search fast-path / ghost resync): merge-ADD only — removals stay
 *  the snapshot's job; `proven` rows get the receipt shield. */
export const fold_zone_rows = (state, input, now) => {
  const zk = zone_key(input.zx, input.zy)
  const zone = state.zones.get(zk) ?? {
    discovered_at_ms: null,
    proven_at: null,
    rows: new Map(),
    row_proven: new Map(),
  }
  const rows = new Map(zone.rows)
  const row_proven = new Map(zone.row_proven)
  const fresh = ingest_rows(state, input.rows)
  for (const [rk, row] of fresh) {
    const flat = `${zk}:${rk}`
    if (state.tombstones.has(flat) && now < (state.tombstones.get(flat) ?? 0) + RECEIPT_GRACE_MS) continue
    if (input.proven && !rows.has(rk)) row_proven.set(rk, now)
    rows.set(rk, row)
  }
  const zones = new Map(state.zones)
  zones.set(zk, { ...zone, rows, row_proven })
  return retarget({ ...state, zones })
}
