// NEARBY FIGHTS — the PURE panel/discovery logic for the "See fights in the area" feature: a
// 50-block proximity prompt → a panel of the current fights in range, spectate once started / join if public +
// in placement; the dungeon twin lists room-fights, friends on top, capped at 20. Zero IO here: shaping an
// RPC row into a marker, the proximity test, the friends-first sort, the two filter toggles, the join/spectate
// legality gates, and the openness constants — every branch the world_fights_discovery poll + FightsModal read,
// so it unit-tests offline. IO (the /v1 poll, the PromptStack arming, the join/spectate txs) lives one layer up.
//
// DATA TRUTH: `get_fights` returns the SERVED `shape_fight` (packages/rpc/api/views.js), NOT the stale RpcFight
// TS type — `{ fight_id, world, spawn_id, anchor:{x,z}, public, status, participants:[{character,seat}],
// mob_count, ... }`. We read the served shape and tolerate the legacy field names (`fight`, `anchor_x`,
// participants-as-Record) so a projection drift can never blank the panel. `/v1/dungeon-runs` rows are
// `{ pass_id, world, player, room, fight_id }` (shape_run) — a dungeon room-fight is discovered THROUGH its run.

// Openness vocabulary ('public' | 'group') moved to its ONE home — @aresrpg/world (openness.js): the spawns
// core carries the live choice and stamps claim_tx with it; this module's legality rules read the same values.

/** The proximity radius (world blocks): players within 50 blocks of a fight see the
 *  "see fights in the area" prompt. Mirrors the gather/attack idiom's PROXIMITY_M shape, just a coarser ring. */
export const FIGHT_PROXIMITY_M = 50

/** The panel row cap: list only the first 20 fights, to avoid spamming. Applied AFTER the
 *  friends-first sort so the 20 kept are the most relevant (friends, then nearest). */
export const FIGHT_LIST_CAP = 20

/** Read a served fight's id tolerantly (`fight_id` is the shape_fight field; `fight` is the stale twin). */
function fight_id_of(f) {
  return f?.fight_id ?? f?.fight ?? null
}

/** Read a served fight's chain-space anchor tolerantly (`anchor:{x,z}` is shape_fight; `anchor_x/_z` is stale). */
function anchor_of(f) {
  const x = f?.anchor?.x ?? f?.anchor_x ?? null
  const z = f?.anchor?.z ?? f?.anchor_z ?? null
  return { x: x == null ? null : Number(x), z: z == null ? null : Number(z) }
}

/** Read a served fight's public flag tolerantly (`public` is shape_fight; `public_fight` is the raw chain name). */
function public_of(f) {
  return Boolean(f?.public ?? f?.public_fight ?? false)
}

/** The participant CHARACTER ids of a served fight — shape_fight emits a sorted `[{character, seat}]` array; the
 *  stale RpcFight type is a `Record<character, seat>`. Return a bare id list, tolerating both. */
export function participant_ids(f) {
  const parts = f?.participants
  if (Array.isArray(parts)) return parts.map((p) => p?.character).filter(Boolean)
  if (parts && typeof parts === 'object') return Object.keys(parts)
  return []
}

/**
 * Shape ONE served `/v1/fights` row into the marker the panel + proximity test read. `to_world(chain_coord)`
 * brings the chain-space anchor into the player's signed WORLD space (the discovery poll passes the same
 * `chain_to_world`+offset world_spawns uses); omitted → the anchor passes through raw (unit tests / same-space
 * callers). `distance` is filled by the poll once it knows the player cell (null here — pure shaping only).
 * @param {any} f a served fight row (shape_fight)
 * @param {(coord:number)=>number} [to_world] chain→world coord bringer (identity when omitted)
 * @returns {{ id:string, spawn_id:string|null, position:{x:number,z:number}, public:boolean, status:string,
 *   started:boolean, participant_ids:string[], participant_count:number, mob_count:number, group_template:string|null,
 *   distance:number|null } | null}
 */
export function to_fight_marker(f, to_world = (c) => c) {
  const id = fight_id_of(f)
  if (!id) return null
  const { x, z } = anchor_of(f)
  const ids = participant_ids(f)
  const status = String(f?.status ?? 'placement')
  return {
    id,
    // the CLAIMED mob group's u64 handle (shape_fight serves it as a string; "0" = no spawn) — the join key the
    // engage gate matches a world spawn row against, so an already-fought pack is un-attackable across accounts.
    spawn_id: f?.spawn_id != null ? String(f.spawn_id) : null,
    position: { x: x == null ? 0 : to_world(x), z: z == null ? 0 : to_world(z) },
    public: public_of(f),
    status,
    started: status !== 'placement', // owner: spectate "once started" — placement is the JOIN window, not spectate
    participant_ids: ids,
    participant_count: ids.length,
    mob_count: Number(f?.mob_count ?? 0),
    // The fight's mob-group MobTemplate id (shape_fight's read-time join from rpc:group_template) — the panel
    // resolves it to the mob display name via the client's catalog home; null → the honest "Enemies #N".
    group_template: f?.group_template ?? null,
    distance: null,
  }
}

/**
 * ENGAGE-GROUP GATE: is the mob group `spawn_id` already CLAIMED by a LIVE fight in
 * `fights`? The world-fight engage affordance (off the polled visible_fights Map) AND the pre-sign liveness
 * re-check (off a fresh get_fights array) both ask this against the SAME /v1/fights truth — so a pack another
 * player (or my own alt) is already fighting is un-attackable BEFORE any compose/submit, refusing the burn. Every
 * element carries `spawn_id` (a marker after to_fight_marker, or a raw served row natively); "0"/null (the
 * "no spawn" sentinel + the stale/protector twin) never blocks — refuse only on a real match.
 * @param {Map<string,any> | any[] | null | undefined} fights the visible_fights Map, a marker array, or raw rows
 * @param {string|number|null|undefined} spawn_id the world spawn row's group handle
 * @returns {boolean}
 */
export function group_engage_blocked(fights, spawn_id) {
  if (spawn_id == null) return false
  const key = String(spawn_id)
  if (key === '0' || key === '') return false
  const list = Array.isArray(fights) ? fights : [...(fights?.values?.() ?? [])]
  return list.some((f) => f != null && f.spawn_id != null && String(f.spawn_id) === key)
}

/** Planar world-block distance from a player cell to a marker's world anchor (null cell/anchor → Infinity, so a
 *  not-yet-resolved row never spuriously reads "in range"). */
export function fight_distance(marker, player_cell) {
  if (!marker?.position || !player_cell) return Infinity
  const dx = Number(marker.position.x) - Number(player_cell.x)
  const dz = Number(marker.position.z) - Number(player_cell.z)
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return Infinity
  return Math.hypot(dx, dz)
}

/** Is a marker within `radius` world blocks of the player cell? The 50-block prompt/panel gate. */
export function in_range(marker, player_cell, radius = FIGHT_PROXIMITY_M) {
  return fight_distance(marker, player_cell) <= radius
}

/** A fight has a "known" (friend/party) fighter if any of its participants is in `known_char_ids`. */
function has_known_member(marker, known_char_ids) {
  if (!known_char_ids || known_char_ids.size === 0) return false
  return marker.participant_ids.some((id) => known_char_ids.has(id))
}

/** Exact Party character roster. Owner addresses are deliberately ignored: one owner may contribute several
 * accepted characters, while another character owned by that wallet is not a member until it is accepted. */
export function party_character_ids(members) {
  return new Set((members ?? []).map((member) => member?.character).filter(Boolean))
}

/**
 * JOIN legality: the player side shows "joined" once the fight is open to public and in placement phase. The on-chain
 * `fight::join` gate is authoritative (public/party + placement + not-full + not-gated); this is the CLIENT
 * affordance gate so the panel never shows a doomed Join. `group_member` means this fight already contains an
 * exact character from the caller's Party roster; the join PTB then supplies that party id for the chain gate.
 */
export function is_join_legal(marker, group_member = false) {
  return !!marker && marker.status === 'placement' && (marker.public === true || group_member)
}

/**
 * DUNGEON-room JOIN legality: lets a party team up for the boss. A dungeon room-fight is created gated + private
 * (public_fight false), so the world's public gate does NOT apply — `dungeon::join_fight` is VOUCHED: it needs
 * placement phase + the SAME room (re-derived on-chain from the creator's pass) + the joiner's own RunPass. This
 * is the CLIENT affordance gate; same-room + pass-possession are proven on-chain. So the panel offers Join for a
 * dungeon room-fight iff it is still in placement.
 */
export function is_dungeon_join_legal(row) {
  return !!row && row.status === 'placement'
}

/** SPECTATE legality: a fight can be spectated once it has started. A started fight (status !== placement, and not terminal)
 *  mounts a read-only board. Terminal fights (victory/defeat) are mid-teardown — nothing to watch. */
export function is_spectatable(marker) {
  return (
    !!marker &&
    (marker.status === 'active' || marker.started) &&
    marker.status !== 'victory' &&
    marker.status !== 'defeat'
  )
}

/**
 * Sort markers FRIENDS-FIRST then nearest-first: friendlist fights surface on top. A friend fight is
 * one with any friend participant; ties (and non-friend rows) break on ascending distance, then id for a stable
 * order. Pure — returns a new array. `friend_char_ids` is a Set of the caller's friends' character ids.
 * @param {any[]} markers @param {Set<string>} friend_char_ids
 */
export function sort_friends_first(markers, friend_char_ids) {
  return [...markers].sort((a, b) => {
    const fa = has_known_member(a, friend_char_ids) ? 0 : 1
    const fb = has_known_member(b, friend_char_ids) ? 0 : 1
    if (fa !== fb) return fa - fb
    const da = a.distance ?? Infinity
    const db = b.distance ?? Infinity
    if (da !== db) return da - db
    return String(a.id).localeCompare(String(b.id))
  })
}

/**
 * The FINAL panel list: sort friends-first, apply the two toggles, cap at 20. `friends_only` keeps only
 * fights with a friend fighter; `group_only` keeps only fights with one of MY party's fighters (the parallel
 * "people I know" filter — friends vs my current group). Both empty sets → the toggle keeps nothing (an honest
 * "no friends/party in range", never a silent all-pass). Order: sort → filter → cap, so the kept ≤20 are the
 * most relevant survivors.
 * @param {any[]} markers
 * @param {{ friend_char_ids?:Set<string>, party_char_ids?:Set<string>, friends_only?:boolean,
 *   group_only?:boolean, cap?:number }} opts
 */
export function cap_and_filter(markers, opts = {}) {
  const {
    friend_char_ids = new Set(),
    party_char_ids = new Set(),
    friends_only = false,
    group_only = false,
    cap = FIGHT_LIST_CAP,
  } = opts
  let list = sort_friends_first(markers, friend_char_ids)
  if (friends_only) list = list.filter((m) => has_known_member(m, friend_char_ids))
  if (group_only) list = list.filter((m) => has_known_member(m, party_char_ids))
  return list.slice(0, cap)
}

/** D749 section order: the FIGHTS strip is rendered by the caller, then GROUP FIGHTS, then PUBLIC. Preserve the
 * already-ranked order inside each section and keep both sections visible instead of turning them into tabs. */
export function section_fight_rows(rows) {
  return [
    { key: 'group', rows: rows.filter((row) => !row.public) },
    { key: 'public', rows: rows.filter((row) => row.public) },
  ]
}

/**
 * World-space sword markers to plant for OTHER players' fights still FORMING — another player starting a
 * fight must see the sword marker appear immediately. A marker only carries the ceremony
 * while its fight is in `placement` — the SAME "spectate once started" boundary `is_spectatable` uses, mirrored
 * here from the other side: once a fight activates, the seated players' own board is the show, and once its id
 * leaves `visible_fights` (out of range / gone) there is nothing left to herald. Pure set derivation — the
 * engine-mount layer (world_fights_discovery.js) diffs this against what it already planted so it only ever
 * reacts to add/remove EDGES, never re-derives its own plant/despawn decision.
 * @param {Map<string, any> | any[] | null | undefined} visible_fights
 * @returns {{ id: string, position: { x: number, z: number } }[]}
 */
export function forming_fight_sword_markers(visible_fights) {
  const list = Array.isArray(visible_fights) ? visible_fights : [...(visible_fights?.values?.() ?? [])]
  return list.filter((m) => m && !m.started && m.position).map((m) => ({ id: m.id, position: m.position }))
}

/**
 * Shape a `/v1/dungeon-runs` row + its resolved fight marker into a dungeon panel row. A dungeon room-fight is
 * discovered THROUGH the run that created it (the run carries the current `room` + its latched `fight_id`); the fight
 * marker (from /v1/fights?id=) carries the roster/phase. `creator_pass_id` = the run's pass id — the joiner's
 * `dungeon::join_fight` re-derives `(creator_pass, room)` for the same-room proof, letting a party team up for the boss.
 * null fight (between rooms) → null (nothing to join/watch yet).
 * @param {{ pass_id:string, player:string, room:number, fight_id:string|null }} run
 * @param {any} fight_marker the marker for run.fight_id (to_fight_marker output), or null
 */
export function to_dungeon_fight(run, fight_marker) {
  // tolerate the served (pass_id/fight_id) AND stale (pass/fight) shapes — same drift as the fight rows.
  const fight_id = run?.fight_id ?? run?.fight
  const pass_id = run?.pass_id ?? run?.pass
  if (!fight_id || !fight_marker) return null
  return {
    ...fight_marker,
    run_pass_id: pass_id, // the creator's pass — join_fight re-derives (creator_pass, room)
    room: Number(run.room ?? 0),
    owner: run.player ?? null,
  }
}
