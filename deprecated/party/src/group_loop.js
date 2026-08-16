// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE GROUP LOOP REDUCER (MULTICHAR lane, D769b design note) — the pure sequencer of a player's
// multi-character loop: ONE human drives N owned characters as a party. Membership truth stays in
// reduce.js (chain-reconciled); THIS reducer owns the leader-session orchestration facts and emits
// EFFECT REQUESTS exactly once per need:
//
//   INPUTS   { group | invite_accepted | member_world_state | follow_reconcile | follow_position_read |
//              follow_world_joined | transit_tick | follow_checkpoint_written | leader_position |
//              member_blocked | fight_started | fight_seat_update | turn_started | fight_ended |
//              dungeon_entered | dungeon_ended | reset }
//   OUTPUTS  { join_world[] · read_position[] · write_checkpoint[] · follow_render[] · join_fight[] ·
//              hud_focus · enter_dungeon[] }
//
// PER-FOLLOWER STATE MACHINE (#613): follow-enable reads chain truth FIRST. A follower already in the
// leader's world takes NO world-join tx — it `read_position`s its checkpoint (a redundant same-world
// zones::join_world EXECUTES on rejoin and burns sponsor gas), then resolves NEAR → `with_you` or FAR →
// the in-world catch-up `in_transit`. A DIFFERENT world takes `joining` → the join tx → `in_transit`. The
// ARRIVING timer completes INTO `with_you` (never a frozen 00:00). A `with_you` follower is a free-run
// companion — its render row carries `free_run` + the leader `anchor` and is steered at the edge by
// pet_follow (step_pet_follow), continuously present (never range-despawned; the module's own snap threshold
// is the only "genuinely far" gate). An executed refusal (unopened fight result) latches the row to
// `blocked`. Only the `in_transit` flight leg is timer-projected here (despawn-and-continue past
// FOLLOW_VISIBLE_RANGE); executed tx failures re-enter as `member_blocked` and hold the latch forever
// (tx-retry burn law — the edge never re-fires a digest-bearing failure).

export const MAX_OWNED_FOLLOWERS = 5
/** Blocks — beyond this from the leader a follower visually DESPAWNS (the proof-of-time timer keeps deriving);
 *  it respawns and resumes its run-in the moment the projection re-enters range (#509 despawn-and-continue). */
export const FOLLOW_VISIBLE_RANGE = 30
/** Blocks — a run-in longer than this rides the EXISTING fast-travel (dragon) flow instead of a slow jog to
 *  the leader (#509 §3 catch-up). The reducer only DECIDES + emits the request; the edge drives the flight. */
export const DRAGON_DISTANCE = 50

// Ruled follow transit: roughly the avatar's run pace, with humane lower/upper bounds regardless of distance.
// Kept in this headless core instead of importing the engine package: @aresrpg/party stays dependency-free.
export const TRANSIT_SPEED = 10.5
export const TRANSIT_MIN_MS = 10_000
export const TRANSIT_MAX_MS = 5 * 60_000

// Controller yaw convention: forward is (-sin(yaw), -cos(yaw)). `behind` therefore points along
// (sin(yaw), cos(yaw)), while positive `beside` points to the controller's right.
const FORMATION_SLOTS = Object.freeze([
  Object.freeze({ behind: 3, beside: -2 }),
  Object.freeze({ behind: 3, beside: 2 }),
  Object.freeze({ behind: 5, beside: -3 }),
  Object.freeze({ behind: 5, beside: 3 }),
  Object.freeze({ behind: 6, beside: 0 }),
])

const EMPTY_ROWS = Object.freeze([])
// follow_render is `null` on frames that did NOT recompute the render set, and an array (possibly empty) on
// the frames that did — so the edge tells an untouched frame apart from an all-despawn one (an all-out-of-range
// render set is a meaningful []). Every other output stays a stable empty array.
const no_outputs = () => ({
  join_world: EMPTY_ROWS,
  read_position: EMPTY_ROWS,
  follow_move: EMPTY_ROWS,
  write_checkpoint: EMPTY_ROWS,
  follow_render: null,
  fast_travel: EMPTY_ROWS,
  join_fight: EMPTY_ROWS,
  hud_focus: null,
  enter_dungeon: EMPTY_ROWS,
})
const still = (state) => ({ state, outputs: no_outputs() })

/**
 * Resolve an alt's deterministic formation target. Slots remain 3–6 horizontal blocks from the leader.
 * @param {{ x: number, z: number }} leader_position
 * @param {number} leader_yaw controller yaw in radians
 * @param {number} slot_index zero-based owned-alt index in chain group order
 * @returns {{ x: number, z: number } | null}
 */
export function follow_formation_target(leader_position, leader_yaw, slot_index) {
  const slot = Number.isInteger(slot_index) ? FORMATION_SLOTS[slot_index] : null
  const x = leader_position?.x
  const z = leader_position?.z
  if (!slot || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(leader_yaw)) return null

  const sin = Math.sin(leader_yaw)
  const cos = Math.cos(leader_yaw)
  return {
    x: x + slot.behind * sin + slot.beside * cos,
    z: z + slot.behind * cos - slot.beside * sin,
  }
}

/** Horizontal squared distance; callers can compare without a square root. */
export function horizontal_distance_squared(
  /** @type {{ x: number, z: number }} */ from,
  /** @type {{ x: number, z: number }} */ to
) {
  const dx = to.x - from.x
  const dz = to.z - from.z
  return dx * dx + dz * dz
}

export const empty_group_state = () => ({
  my_address: null,
  leader_character_id: null,
  members: /** @type {Array<{ character: string, owner: string, order: number }>} */ ([]),
  world_by_character: /** @type {Record<string, string | null>} */ ({}),
  requested_world_joins: /** @type {Record<string, string>} */ ({}),
  blocked: /** @type {Record<string, Record<string, boolean>>} */ ({}),
  leader_pose: /** @type {{ x: number, z: number, yaw: number } | null} */ (null),
  follower_track: /** @type {Record<string, { x: number, z: number, progress_at: number }>} */ ({}),
  fight: /** @type {{ fight_id: string, seated: string[], requested: string[] } | null} */ (null),
  focus_character_id: /** @type {string | null} */ (null),
  dungeon: /** @type {{ world_id: string, requested: string[] } | null} */ (null),
  follow: {
    enabled: false,
    /** @type {string | null} */
    leader_character_id: null,
    /** @type {string[]} */
    follower_character_ids: [],
    /** @type {Record<string, any>} */
    followers: {},
    dungeon_background: false,
  },
})

const follow_leader_world = (state) => state.world_by_character[state.follow.leader_character_id] ?? null

/** Owned members EXCLUDING the leader, in chain group order — the follow/join candidate set. */
const owned_alts = (state) =>
  state.members
    .filter((member) => member.character !== state.leader_character_id && member.owner === state.my_address)
    .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0))

const is_blocked = (state, character_id, scope) => !!state.blocked[character_id]?.[scope]

/**
 * #1661 — ARRIVED alts: the owned members whose follow row reached `with_you`, the ONE state both arrival
 * paths converge on through `enter_with_you` (a near same-world settle, a run-in expiry, a dragon landing).
 * Arrival is an EVENT, not a measurement: same-world was a LOOSE predicate — an alt whose travel never
 * completed (its join tx never landed, its transit still running, its client not there to sign) shares the
 * leader's world field long before it stands beside them, and being seated in that state is an idle forfeit.
 * A distance threshold would only swap one loose predicate for another. A row can only be `with_you` in the
 * leader's world (the machine seats it there), so world alignment falls out — no second check, and an alt
 * that never arrives satisfies nothing without a single presence/offline branch to maintain.
 */
const arrived_alts = (state) =>
  owned_alts(state).filter((member) => state.follow.followers[member.character]?.status === 'with_you')

const prune_keys = (record, keep) => {
  const next = {}
  for (const key of Object.keys(record)) if (keep.has(key)) next[key] = record[key]
  return next
}

// ── membership mirror ─────────────────────────────────────────────────────────────────────────────────────
function reduce_membership(state, input) {
  switch (input.kind) {
    case 'group': {
      const { my_address, leader_character_id, members } = input
      const rows = Array.isArray(members) ? members.filter((member) => member?.character) : []
      const keep = new Set(
        [
          ...rows.map((member) => member.character),
          state.follow.leader_character_id,
          ...state.follow.follower_character_ids,
        ].filter(Boolean)
      )
      return still({
        ...state,
        my_address: my_address ?? state.my_address,
        leader_character_id: leader_character_id ?? state.leader_character_id,
        members: rows,
        world_by_character: prune_keys(state.world_by_character, keep),
        requested_world_joins: prune_keys(state.requested_world_joins, keep),
        focus_character_id: keep.has(state.focus_character_id) ? state.focus_character_id : null,
      })
    }
    case 'invite_accepted': {
      const { character_id, owner } = input
      if (!character_id || state.members.some((member) => member.character === character_id)) return still(state)
      return still({
        ...state,
        members: [...state.members, { character: character_id, owner: owner ?? '', order: state.members.length }],
      })
    }
    case 'member_world_state': {
      const { character_id, world_id } = input
      if (!character_id) return still(state)
      const previous_world = state.world_by_character[character_id] ?? null
      const next = { ...state, world_by_character: { ...state.world_by_character, [character_id]: world_id ?? null } }
      if (
        !state.follow.enabled ||
        character_id !== state.follow.leader_character_id ||
        !previous_world ||
        !world_id ||
        previous_world === world_id
      )
        return still(next)

      const now = Number.isFinite(input.now) ? input.now : 0
      const followers = { ...state.follow.followers }
      const join_world = []
      const read_position = []
      for (const follower_character_id of state.follow.follower_character_ids) {
        const row = followers[follower_character_id]
        if (!row || is_blocked(state, follower_character_id, 'world_join')) continue
        // #613 — SAME entry evaluation as follow-enable, on the leader's world change: a follower ALREADY in the
        // leader's new world reads its position (no redundant same-world join → no burned gas); only a genuinely
        // cross-world follower takes the join tx, carrying its in-flight transit progress across the re-anchor.
        if (state.world_by_character[follower_character_id] === world_id) {
          followers[follower_character_id] = {
            ...row,
            status: 'resolving',
            world_id,
            carry_ratio: 1,
            receipt_confirmed: false,
          }
          read_position.push({ character_id: follower_character_id, world_id })
          continue
        }
        const remaining_ms =
          row.status === 'in_transit' ? Math.max(0, row.deadline_ms - now) : Number(row.remaining_ms ?? 0)
        const carry_ratio =
          row.status === 'in_transit' && row.total_ms > 0 ? Math.max(0, Math.min(1, remaining_ms / row.total_ms)) : 1
        followers[follower_character_id] = {
          ...row,
          status: 'joining',
          world_id,
          carry_ratio,
          receipt_confirmed: false,
        }
        join_world.push({ character_id: follower_character_id, world_id })
      }
      return {
        state: { ...next, follow: { ...state.follow, followers } },
        outputs: { ...no_outputs(), join_world, read_position },
      }
    }
    case 'member_blocked': {
      const { character_id, scope } = input
      if (!character_id || !scope) return still(state)
      // #613 — the executed-failure latch is no longer a silent flag: a follower whose entry/arrival was
      // refused (an unopened fight result aborts its join) becomes an explicit `blocked` ROW the party surface
      // names inline, instead of a follower frozen mid-timer behind a context-free toast. The blocked[][] latch
      // still holds (tx-retry burn law — the world/fight join is never re-fired for this member this session).
      // Only a WORLD-JOIN (entry) refusal names the blocked row — that is the "needs its fight result opened"
      // surface. A fight_join executed failure is a different cause; it keeps its silent latch, not this copy.
      const row = state.follow.followers[character_id]
      const follow =
        row && scope === 'world_join'
          ? {
              ...state.follow,
              followers: {
                ...state.follow.followers,
                [character_id]: { ...row, status: 'blocked', blocked_scope: scope },
              },
            }
          : state.follow
      return still({
        ...state,
        follow,
        blocked: { ...state.blocked, [character_id]: { ...state.blocked[character_id], [scope]: true } },
      })
    }
    default:
      return still(state)
  }
}

const clamp_eta = (eta_ms) => Math.max(TRANSIT_MIN_MS, Math.min(TRANSIT_MAX_MS, Math.round(eta_ms)))

export function transit_eta_ms(from, to) {
  if (![from?.x, from?.z, to?.x, to?.z].every(Number.isFinite)) return TRANSIT_MAX_MS
  return clamp_eta((Math.sqrt(horizontal_distance_squared(from, to)) / TRANSIT_SPEED) * 1000)
}

const ARRIVAL_OFFSETS = Object.freeze([
  Object.freeze({ x: 1, z: 0 }),
  Object.freeze({ x: -1, z: 0 }),
  Object.freeze({ x: 0, z: 1 }),
  Object.freeze({ x: 0, z: -1 }),
  Object.freeze({ x: 1, z: 1 }),
])

/** Pick a distinct cell beside the leader; occupied party cells are skipped deterministically. */
export function follow_arrival_cell(leader_position, occupied = new Set()) {
  if (![leader_position?.x, leader_position?.z].every(Number.isFinite)) return null
  const base_x = Math.floor(leader_position.x) + 0.5
  const base_z = Math.floor(leader_position.z) + 0.5
  for (const offset of ARRIVAL_OFFSETS) {
    const cell = { x: base_x + offset.x, z: base_z + offset.z }
    if (!occupied.has(`${cell.x}:${cell.z}`)) return cell
  }
  return { x: base_x + 2, z: base_z }
}

/** #643 — the ONE derivation of the occupied arrival cells: every seated follower's `arrival_position` keyed
 *  "x:z". Both the run-in expiry (transit_tick) and the dragon landing (follow_dragon_arrived) seat beside the
 *  leader and must not collide; a single home means a future change to how cells are decided touches one place. */
const occupied_arrival_cells = (followers) =>
  new Set(
    Object.values(followers)
      .filter((row) => row?.arrival_position)
      .map((row) => `${row.arrival_position.x}:${row.arrival_position.z}`)
  )

const begin_transit = (row, checkpoint, leader_pose, now) => {
  const ratio = Number.isFinite(row.carry_ratio) ? row.carry_ratio : 1
  const total_ms = clamp_eta(transit_eta_ms(checkpoint, leader_pose) * Math.max(0, Math.min(1, ratio)))
  return {
    ...row,
    status: 'in_transit',
    checkpoint: { x: checkpoint.x, z: checkpoint.z },
    started_at_ms: now,
    deadline_ms: now + total_ms,
    total_ms,
    remaining_ms: total_ms,
    progress: 0,
    carry_ratio: 1,
    receipt_confirmed: false,
  }
}

/** Enter the free-run companion state seeded at `spot` (the edge's step_pet_follow motion starts here — never
 *  on the leader, so a NEAR alt ambles from where it stood rather than teleporting in). Timer fields are
 *  cleared: with_you shows NO ARRIVING bar. */
const enter_with_you = (row, spot) => ({
  ...row,
  status: 'with_you',
  seed: { x: spot.x, z: spot.z },
  remaining_ms: 0,
  progress: 1,
  receipt_confirmed: false,
})

/** Settle a SAME-WORLD follower against the checkpoint chain truth just read: within the companion band it is
 *  already beside you → with_you (no timer); beyond it, the in-world catch-up flight (in_transit) — never a
 *  world join either way. The band reuses FOLLOW_VISIBLE_RANGE = the pet_follow snap threshold: inside it
 *  step_pet_follow closes the gap as a companion (no snap); past it the timed flight animates the approach. */
const settle_same_world = (row, position, leader_pose, now) =>
  horizontal_distance_squared(position, leader_pose) <= FOLLOW_VISIBLE_RANGE * FOLLOW_VISIBLE_RANGE
    ? enter_with_you(row, position)
    : begin_transit({ ...row, carry_ratio: 1 }, position, leader_pose, now)

/**
 * Deterministic projection of a follower's LIVE position from the proof-of-time timer — the pure function
 * any client can run off the SAME RPC-visible facts (the join checkpoint + the timer's progress + the leader
 * pose), never peer-channel presence (owner ruling 2026-07-23: public follower positions are RPC-derived
 * truth; a peer's own stream is at most a cosmetic hint). This is the FLIGHT leg only: while in transit the follower runs a
 * straight line from its join checkpoint toward its formation slot at running speed (progress is time/eta, so it
 * advances at ~run pace — it RIDES the flight, never teleports). Returns null for any other status — a `with_you`
 * follower is a free-run companion steered at the edge by pet_follow, not a slot-pinned projection (#613).
 * @param {any} row one follow.followers entry
 * @param {{ x: number, z: number, yaw: number } | null} leader_pose
 * @param {number} slot_index zero-based follower slot
 * @returns {{ x: number, z: number, yaw: number } | null}
 */
export function project_follower_position(row, leader_pose, slot_index) {
  if (!row || !leader_pose) return null
  const slot = follow_formation_target(leader_pose, leader_pose.yaw, slot_index)
  if (!slot) return null
  if (row.status !== 'in_transit' || ![row.checkpoint?.x, row.checkpoint?.z].every(Number.isFinite)) return null
  const p = Math.max(0, Math.min(1, Number(row.progress ?? 0)))
  const x = row.checkpoint.x + (slot.x - row.checkpoint.x) * p
  const z = row.checkpoint.z + (slot.z - row.checkpoint.z) * p
  // Face the direction of travel while running in (falls back to the leader's heading at the slot).
  const yaw = p < 1 ? Math.atan2(slot.x - row.checkpoint.x, slot.z - row.checkpoint.z) : leader_pose.yaw
  return { x, z, yaw }
}

// The render set. A `with_you` follower is a FREE-RUN companion (#613): the reducer ships the pet_follow
// consumer contract (free_run + the leader anchor step_pet_follow steers toward) and it is CONTINUOUSLY present
// — never range-despawned here (the module's own snap threshold is the only "genuinely far" gate). The
// `in_transit` FLIGHT leg stays TIMER-DERIVED, despawning beyond the visible range (despawn-and-continue —
// transit_tick keeps advancing progress off-screen, so it respawns and finishes its run once back in range).
const rendered_followers = (state, pose) =>
  state.follow.follower_character_ids.flatMap((character_id, slot_index) => {
    const row = state.follow.followers[character_id]
    if (row?.status === 'with_you') {
      const seed = [row.seed?.x, row.seed?.z].every(Number.isFinite) ? row.seed : pose
      return [
        {
          character_id,
          x: seed.x,
          z: seed.z,
          yaw: pose.yaw,
          free_run: true,
          anchor: { x: pose.x, z: pose.z, yaw: pose.yaw },
        },
      ]
    }
    const projected = project_follower_position(row, pose, slot_index)
    if (!projected) return []
    if (horizontal_distance_squared(projected, pose) > FOLLOW_VISIBLE_RANGE * FOLLOW_VISIBLE_RANGE) return []
    return [{ character_id, x: projected.x, z: projected.z, yaw: projected.yaw }]
  })

/**
 * GROUP MEMBERSHIP IS AUTO-FOLLOW (#613 DESIGN COLLAPSE, supersedes the per-character toggle): the follower set
 * IS the player's owned group members other than the driven leader — PARTY TRUTH, never a client toggle set (so
 * it is immune to the state-desync class the toggle caused). Reconcile the machine to that truth on every
 * membership/leader sync: a newly-grouped alt is armed through the SAME entry evaluation; a KICKED member (gone
 * from the group) is dropped — kicking is the ONLY disable, no toggle exists. Idempotent: an already-following
 * member keeps its live row (resolving / joining / in_transit / with_you / blocked) untouched.
 *
 * ENTRY EVALUATION reads chain truth FIRST. A follower ALREADY in the leader's world takes NO world-join tx —
 * the redundant same-world `zones::join_world` EXECUTES on a rejoin (Move only aborts a FIRST join below the
 * level gate; a rejoin re-points the world field and emits WorldJoined) and burns sponsor gas, a money leak. It
 * begins `resolving` + one `read_position` (settled NEAR → with_you / FAR → the catch-up transit); a follower in
 * a DIFFERENT world begins `joining` + one sequenced `join_world` → the proof-of-time timer leg.
 */
function reconcile_follow(state, leader_character_id) {
  const leader = leader_character_id ?? state.leader_character_id
  const base = leader === state.leader_character_id ? state : { ...state, leader_character_id: leader }
  const desired = (leader ? owned_alts(base).map((member) => member.character) : []).slice(0, MAX_OWNED_FOLLOWERS)
  const world_id = base.world_by_character[leader] ?? null
  const followers = {}
  const follower_character_ids = []
  const join_world = []
  const read_position = []
  for (const character_id of desired) {
    const existing = base.follow.follower_character_ids.includes(character_id)
      ? base.follow.followers[character_id]
      : null
    if (existing) {
      followers[character_id] = existing // already following — its live row is untouched (idempotent)
      follower_character_ids.push(character_id)
      continue
    }
    if (!world_id) continue // cannot place a follower until the leader's world is known; a later sync arms it
    const same_world = base.world_by_character[character_id] === world_id
    followers[character_id] = {
      status: same_world ? 'resolving' : 'joining',
      world_id,
      carry_ratio: 1,
      receipt_confirmed: false,
    }
    ;(same_world ? read_position : join_world).push({ character_id, world_id })
    follower_character_ids.push(character_id)
  }
  const enabled = follower_character_ids.length > 0
  const next = {
    ...base,
    follow: {
      ...base.follow,
      enabled,
      leader_character_id: enabled ? leader : null,
      follower_character_ids,
      followers,
      dungeon_background: enabled ? base.follow.dungeon_background : false,
    },
  }
  // A kick shrinks the set → re-emit the render so the dropped follower's standalone rig despawns.
  const changed =
    follower_character_ids.length !== base.follow.follower_character_ids.length ||
    join_world.length > 0 ||
    read_position.length > 0
  return {
    state: next,
    outputs: {
      ...no_outputs(),
      join_world,
      read_position,
      follow_render: changed && base.leader_pose ? rendered_followers(next, base.leader_pose) : null,
    },
  }
}

// ── follow transit: membership-driven follower set + reducer-clocked ETA, never active-character selection ──
// eslint-disable-next-line complexity -- one exhaustive event switch is the reducer's single write door.
function reduce_follow(state, input) {
  switch (input.kind) {
    // GROUP MEMBERSHIP IS AUTO-FOLLOW (#613): reconcile the follower set to the owned group members behind the
    // driven leader. Invite (a new member) arms it here; a kick (a removed member) drops it. No toggle exists.
    case 'follow_reconcile':
      return reconcile_follow(state, input.leader_character_id)
    case 'follow_world_joined': {
      const row = state.follow.followers[input.character_id]
      const { checkpoint } = input
      if (
        !state.follow.enabled ||
        !row ||
        row.status !== 'joining' ||
        input.world_id !== follow_leader_world(state) ||
        ![checkpoint?.x, checkpoint?.z].every(Number.isFinite) ||
        !state.leader_pose
      )
        return still(state)
      const now = Number.isFinite(input.now) ? input.now : 0
      const next = {
        ...state,
        follow: {
          ...state.follow,
          followers: {
            ...state.follow.followers,
            [input.character_id]: begin_transit(row, checkpoint, state.leader_pose, now),
          },
        },
      }
      // DRAGON CATCH-UP (#509 §3): a run-in longer than DRAGON_DISTANCE ALSO requests the EXISTING fast-travel
      // flow. The follower keeps its in_transit proof-of-time timer (so the twin math is untouched), but the edge
      // flies it to the leader and lands it early via follow_dragon_arrived. It is already despawned past
      // FOLLOW_VISIBLE_RANGE, so the dragon owns the visible catch-up; a near follower just runs in on foot.
      const far = horizontal_distance_squared(checkpoint, state.leader_pose) > DRAGON_DISTANCE * DRAGON_DISTANCE
      if (!far) return still(next)
      return {
        state: next,
        outputs: {
          ...no_outputs(),
          fast_travel: [
            {
              character_id: input.character_id,
              world_id: row.world_id,
              x: state.leader_pose.x,
              z: state.leader_pose.z,
            },
          ],
        },
      }
    }
    case 'follow_dragon_arrived': {
      // The edge reports the dragon flight landed — seat the follower beside the leader's CURRENT cell, exactly
      // like a run-in expiry: the ARRIVING timer is CONSUMED into the with_you free-run companion (#613), never
      // left at a dead 00:00. Idempotent: once with_you (by the dragon OR a run-in expiry that beat it), a stray
      // replay is inert (status is no longer in_transit).
      const row = state.follow.followers[input.character_id]
      if (!row || row.status !== 'in_transit' || !state.leader_pose) return still(state)
      const position = follow_arrival_cell(state.leader_pose, occupied_arrival_cells(state.follow.followers))
      if (!position) return still(state)
      const next = {
        ...state,
        follow: {
          ...state.follow,
          followers: {
            ...state.follow.followers,
            [input.character_id]: { ...enter_with_you(row, position), arrival_position: position },
          },
        },
      }
      return {
        state: next,
        outputs: {
          ...no_outputs(),
          write_checkpoint: [{ character_id: input.character_id, world_id: row.world_id, position }],
          follow_render: rendered_followers(next, state.leader_pose),
        },
      }
    }
    // #613 — the SAME-WORLD chain-truth result: no join happened, just a checkpoint read. Settle the resolving
    // row NEAR → with_you (present immediately, no timer) or FAR → the in-world catch-up flight, and emit a
    // render frame so a near follower pops in as a companion at once.
    case 'follow_position_read': {
      const row = state.follow.followers[input.character_id]
      const { position } = input
      if (
        !state.follow.enabled ||
        !row ||
        row.status !== 'resolving' ||
        ![position?.x, position?.z].every(Number.isFinite) ||
        !state.leader_pose
      )
        return still(state)
      const now = Number.isFinite(input.now) ? input.now : 0
      const settled = settle_same_world(row, position, state.leader_pose, now)
      const next = {
        ...state,
        follow: { ...state.follow, followers: { ...state.follow.followers, [input.character_id]: settled } },
      }
      // Same-world FAR rides the dragon too (owner ruling: "same world but far ⇒ the in-world catch-up leg,
      // fast-travel/dragon"): a catch-up longer than DRAGON_DISTANCE requests the flight, exactly like the
      // cross-world far leg — the follower keeps its proof-of-time timer, the edge flies it in and lands early.
      const far =
        settled.status === 'in_transit' &&
        horizontal_distance_squared(position, state.leader_pose) > DRAGON_DISTANCE * DRAGON_DISTANCE
      return {
        state: next,
        outputs: {
          ...no_outputs(),
          fast_travel: far
            ? [
                {
                  character_id: input.character_id,
                  world_id: row.world_id,
                  x: state.leader_pose.x,
                  z: state.leader_pose.z,
                },
              ]
            : EMPTY_ROWS,
          follow_render: rendered_followers(next, state.leader_pose),
        },
      }
    }
    case 'transit_tick': {
      if (!state.follow.enabled || !Number.isFinite(input.now)) return still(state)
      const followers = { ...state.follow.followers }
      const occupied = occupied_arrival_cells(followers)
      const write_checkpoint = []
      for (const character_id of state.follow.follower_character_ids) {
        const row = followers[character_id]
        if (row?.status !== 'in_transit') continue
        const remaining_ms = Math.max(0, row.deadline_ms - input.now)
        if (remaining_ms > 0) {
          followers[character_id] = {
            ...row,
            remaining_ms,
            progress: Math.max(0, Math.min(1, 1 - remaining_ms / row.total_ms)),
          }
          continue
        }
        const position = follow_arrival_cell(state.leader_pose, occupied)
        if (!position) continue
        occupied.add(`${position.x}:${position.z}`)
        // #613 — completion is CONSUMED: the ARRIVING timer becomes the with_you free-run companion (seeded at
        // the arrival cell, timer fields cleared), never a bar frozen at 00:00 forever. arrival_position stays
        // for the occupied-cell dedup across siblings arriving the same tick.
        followers[character_id] = { ...enter_with_you(row, position), arrival_position: position }
        write_checkpoint.push({ character_id, world_id: row.world_id, position })
      }
      const next = { ...state, follow: { ...state.follow, followers } }
      return {
        state: next,
        outputs: {
          ...no_outputs(),
          write_checkpoint,
          // Each tick advances progress → the projection moves → re-emit the render set so the run-in animates
          // and a follower crossing the visible-range boundary despawns/respawns without waiting on a pose tick.
          follow_render: state.leader_pose ? rendered_followers(next, state.leader_pose) : EMPTY_ROWS,
        },
      }
    }
    case 'follow_checkpoint_written': {
      const row = state.follow.followers[input.character_id]
      if (!row || row.status !== 'with_you' || row.receipt_confirmed) return still(state)
      const confirmed = { ...row, receipt_confirmed: true }
      const next = {
        ...state,
        follow: {
          ...state.follow,
          followers: { ...state.follow.followers, [input.character_id]: confirmed },
        },
      }
      return {
        state: next,
        outputs: {
          ...no_outputs(),
          follow_render: state.leader_pose ? rendered_followers(next, state.leader_pose) : EMPTY_ROWS,
        },
      }
    }
    case 'follow_background':
      return still({
        ...state,
        follow: { ...state.follow, dungeon_background: state.follow.enabled && !!input.active },
      })
    case 'leader_position': {
      const { x, z, yaw, now } = input
      if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return still(state)
      const pose = { x, z, yaw }
      if (input.character_id && state.follow.enabled && input.character_id !== state.follow.leader_character_id)
        return still(state)
      return {
        state: { ...state, leader_pose: pose },
        // Only a render frame while follow is armed — an idle session never spends an apply on []. When armed,
        // an empty projection is still emitted (all followers out of range → despawn-all is a real render).
        outputs: { ...no_outputs(), follow_render: state.follow.enabled ? rendered_followers(state, pose) : null },
      }
    }
    default:
      return still(state)
  }
}

// ── fight join + HUD focus ────────────────────────────────────────────────────────────────────────────────
function reduce_fight(state, input) {
  switch (input.kind) {
    case 'fight_started': {
      // `join_open` (default true) is the chain's join window: a fight adopted mid-active (resume) or a
      // dungeon room fight (its joins ride the RunPass path) arms focus/seat tracking WITHOUT emitting
      // join_fight — a join tx against a closed window is a guaranteed on-chain abort (burned gas).
      const { fight_id, seated, join_open = true } = input
      if (!fight_id) return still(state)
      const same = state.fight?.fight_id === fight_id
      const seated_now = [...new Set([...(same ? state.fight.seated : []), ...(seated ?? [])])]
      const requested_before = same ? state.fight.requested : []
      // #540/#495 — MEMBERSHIP IS NOT CONSENT: an aligned alt used to auto-join every fight the active
      // character engaged (never completes, the fight never starts, refresh doesn't re-adopt — a full
      // multi-char block). #1661 tightened the survivor to ARRIVAL: only an alt that COMPLETED travel to the
      // leader (`arrived_alts` — the with_you state) may be auto-seated. A member still in transit, still
      // waiting on its world join, or simply not there stays out of the fight it cannot play.
      const joiners =
        !join_open || !state.follow.enabled
          ? []
          : arrived_alts(state).filter(
              (member) =>
                !seated_now.includes(member.character) &&
                !requested_before.includes(member.character) &&
                !is_blocked(state, member.character, 'fight_join')
            )
      const fight = {
        fight_id,
        seated: seated_now,
        requested: [...requested_before, ...joiners.map((member) => member.character)],
      }
      return {
        state: { ...state, fight, focus_character_id: same ? state.focus_character_id : null },
        outputs: {
          ...no_outputs(),
          join_fight: joiners.map((member) => ({ character_id: member.character, fight_id })),
        },
      }
    }
    case 'fight_seat_update': {
      if (!state.fight) return still(state)
      const seated = [...new Set([...state.fight.seated, ...(input.seated ?? [])])]
      return still({
        ...state,
        fight: { ...state.fight, seated, requested: state.fight.requested.filter((id) => !seated.includes(id)) },
      })
    }
    case 'turn_started': {
      const { character_id } = input
      if (!state.fight || !character_id || character_id === state.focus_character_id) return still(state)
      const owned = state.members.some(
        (member) => member.character === character_id && member.owner === state.my_address
      )
      if (!owned) return still(state)
      return {
        state: { ...state, focus_character_id: character_id },
        outputs: { ...no_outputs(), hud_focus: character_id },
      }
    }
    case 'fight_ended':
      return still({ ...state, fight: null, focus_character_id: null })
    default:
      return still(state)
  }
}

// ── dungeon sequencing (key assignment stays team_entry's home — assignments arrive AS INPUT) ─────────────
function reduce_dungeon(state, input) {
  switch (input.kind) {
    case 'dungeon_entered': {
      const { world_id, assignments } = input
      if (!world_id) return still(state)
      const requested_before = state.dungeon?.world_id === world_id ? state.dungeon.requested : []
      // #540/#495/#1734 — same membership-is-not-consent hole as fight_started: an owned alt used to auto-enter
      // every dungeon assignment while its travel was still unresolved. Reuse the fight door's arrival EVENT;
      // an alt that never reaches `with_you` falls out without any presence/offline branch.
      const arrived = new Set(state.follow.enabled ? arrived_alts(state).map((member) => member.character) : [])
      const rows = (Array.isArray(assignments) ? assignments : []).filter(
        (assignment) =>
          arrived.has(assignment?.character_id) &&
          !requested_before.includes(assignment.character_id) &&
          !is_blocked(state, assignment.character_id, 'dungeon')
      )
      const dungeon = { world_id, requested: [...requested_before, ...rows.map((row) => row.character_id)] }
      return {
        state: { ...state, dungeon, follow: { ...state.follow, dungeon_background: state.follow.enabled } },
        outputs: { ...no_outputs(), enter_dungeon: rows },
      }
    }
    case 'dungeon_ended':
      return still({ ...state, dungeon: null, follow: { ...state.follow, dungeon_background: false } })
    default:
      return still(state)
  }
}

const MEMBERSHIP_KINDS = new Set(['group', 'invite_accepted', 'member_world_state', 'member_blocked'])
const FOLLOW_KINDS = new Set([
  'follow_reconcile',
  'follow_position_read',
  'follow_world_joined',
  'follow_dragon_arrived',
  'transit_tick',
  'follow_checkpoint_written',
  'follow_background',
  'leader_position',
])
const FIGHT_KINDS = new Set(['fight_started', 'fight_seat_update', 'turn_started', 'fight_ended'])
const DUNGEON_KINDS = new Set(['dungeon_entered', 'dungeon_ended'])

/**
 * @param {any} state group-loop state (edge-owned keys survive the spread untouched)
 * @param {any} input one kind-tagged group input
 * @returns {{ state: any, outputs: { join_world: readonly any[], follow_move: readonly any[],
 *   join_fight: readonly any[], hud_focus: string | null, enter_dungeon: readonly any[] } }}
 */
export function reduce_group(state, input) {
  const kind = input?.kind
  if (MEMBERSHIP_KINDS.has(kind)) return reduce_membership(state, input)
  if (FOLLOW_KINDS.has(kind)) return reduce_follow(state, input)
  if (FIGHT_KINDS.has(kind)) return reduce_fight(state, input)
  if (DUNGEON_KINDS.has(kind)) return reduce_dungeon(state, input)
  if (kind === 'reset') return still(empty_group_state())
  return still(state)
}
