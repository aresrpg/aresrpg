// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE GROUP LOOP REDUCER (MULTICHAR lane, D769b design note) — the pure sequencer of a player's
// multi-character loop: ONE human drives N owned characters as a party. Membership truth stays in
// reduce.js (chain-reconciled); THIS reducer owns the leader-session orchestration facts and emits
// EFFECT REQUESTS exactly once per need:
//
//   INPUTS   { group | invite_accepted | member_world_state | leader_position | member_position |
//              member_blocked | fight_started | fight_seat_update | turn_started | fight_ended |
//              dungeon_entered | dungeon_ended | reset }
//   OUTPUTS  { join_world[] · follow_move[] (formation target + teleport-if-stuck) · join_fight[] ·
//              hud_focus · enter_dungeon[] }
//
// Every request latches (idempotent re-folds emit nothing); executed tx failures re-enter as
// `member_blocked` and hold the latch open forever (tx-retry burn law — the edge never re-fires a
// digest-bearing failure). Thresholds ride `config` as INPUT constants. The formation/snap/stuck
// geometry moved here VERBATIM from frontend owned_follow.js (one home; the renderer imports the same
// rules for its ease-time snap — one definition, two application points, zero copies).

export const MAX_OWNED_FOLLOWERS = 5
export const FOLLOW_SNAP_DISTANCE = 30
export const FOLLOW_STUCK_MS = 3000
/** A follower within this many blocks of its slot counts as arrived — never "stuck". */
export const FOLLOW_ARRIVE_EPS = 2
/** Minimum per-sample displacement (blocks) that counts as progress toward the slot. */
export const FOLLOW_PROGRESS_EPS = 0.25

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
const no_outputs = () => ({
  join_world: EMPTY_ROWS,
  follow_move: EMPTY_ROWS,
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

/** Snap only once an alt is strictly farther than the configured distance from its leader. */
export function should_snap_to_leader(
  /** @type {{ x: number, z: number }} */ follower_position,
  /** @type {{ x: number, z: number }} */ leader_position,
  max_distance = FOLLOW_SNAP_DISTANCE
) {
  return horizontal_distance_squared(follower_position, leader_position) > max_distance * max_distance
}

/** A blocked interval becomes snap-worthy only after it strictly exceeds the staleness threshold. */
export function stuck_too_long(stuck_since_ms, now_ms, threshold_ms = FOLLOW_STUCK_MS) {
  return Number.isFinite(stuck_since_ms) && Number.isFinite(now_ms) && now_ms - stuck_since_ms > threshold_ms
}

/** @param {{ snap_distance?: number, stuck_ms?: number, arrive_eps?: number }} [config] */
export const empty_group_state = (config = {}) => ({
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
  config: {
    snap_distance: config.snap_distance ?? FOLLOW_SNAP_DISTANCE,
    stuck_ms: config.stuck_ms ?? FOLLOW_STUCK_MS,
    arrive_eps: config.arrive_eps ?? FOLLOW_ARRIVE_EPS,
  },
})

const leader_world = (state) => state.world_by_character[state.leader_character_id] ?? null

/** Owned members EXCLUDING the leader, in chain group order — the follow/join candidate set. */
const owned_alts = (state) =>
  state.members
    .filter((member) => member.character !== state.leader_character_id && member.owner === state.my_address)
    .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0))

const is_blocked = (state, character_id, scope) => !!state.blocked[character_id]?.[scope]

/** Owned alts standing in the leader's world — the only members the loop may steer/seat. */
const aligned_alts = (state) => {
  const world = leader_world(state)
  if (!world) return []
  return owned_alts(state).filter((member) => state.world_by_character[member.character] === world)
}

// ── world alignment: the ONE derivation both membership and world folds share ─────────────────────────────
/** Emit join_world for every owned alt whose known world diverges from the leader's, latching each request. */
const with_world_requests = (state) => {
  const world = leader_world(state)
  if (!world) return still(state)
  const pending = owned_alts(state).filter((member) => {
    const character_id = member.character
    const bound = state.world_by_character[character_id]
    return (
      bound != null &&
      bound !== world &&
      state.requested_world_joins[character_id] !== world &&
      !is_blocked(state, character_id, 'world_join')
    )
  })
  if (!pending.length) return still(state)
  const requested = { ...state.requested_world_joins }
  for (const member of pending) requested[member.character] = world
  return {
    state: { ...state, requested_world_joins: requested },
    outputs: {
      ...no_outputs(),
      join_world: pending.map((member) => ({ character_id: member.character, world_id: world })),
    },
  }
}

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
      const keep = new Set(rows.map((member) => member.character))
      return with_world_requests({
        ...state,
        my_address: my_address ?? state.my_address,
        leader_character_id: leader_character_id ?? state.leader_character_id,
        members: rows,
        world_by_character: prune_keys(state.world_by_character, keep),
        requested_world_joins: prune_keys(state.requested_world_joins, keep),
        follower_track: prune_keys(state.follower_track, keep),
        focus_character_id: keep.has(state.focus_character_id) ? state.focus_character_id : null,
      })
    }
    case 'invite_accepted': {
      const { character_id, owner } = input
      if (!character_id || state.members.some((member) => member.character === character_id)) return still(state)
      return with_world_requests({
        ...state,
        members: [...state.members, { character: character_id, owner: owner ?? '', order: state.members.length }],
      })
    }
    case 'member_world_state': {
      const { character_id, world_id } = input
      if (!character_id) return still(state)
      const requested = { ...state.requested_world_joins }
      if (requested[character_id] === world_id) delete requested[character_id] // confirmation drains the latch
      return with_world_requests({
        ...state,
        world_by_character: { ...state.world_by_character, [character_id]: world_id ?? null },
        requested_world_joins: requested,
      })
    }
    case 'member_blocked': {
      const { character_id, scope } = input
      if (!character_id || !scope) return still(state)
      return still({
        ...state,
        blocked: { ...state.blocked, [character_id]: { ...state.blocked[character_id], [scope]: true } },
      })
    }
    default:
      return still(state)
  }
}

// ── follow: formation targets + the teleport-if-stuck pure rule ───────────────────────────────────────────
function reduce_follow(state, input) {
  switch (input.kind) {
    case 'leader_position': {
      const { x, z, yaw, now } = input
      if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return still(state)
      const pose = { x, z, yaw }
      const followers = aligned_alts(state).slice(0, MAX_OWNED_FOLLOWERS)
      if (!followers.length) return still({ ...state, leader_pose: pose })
      const track = { ...state.follower_track }
      const rows = followers.flatMap((member, slot_index) => {
        const target = follow_formation_target(pose, yaw, slot_index)
        if (!target) return []
        const seen = track[member.character]
        const teleport =
          !!seen &&
          (should_snap_to_leader(seen, pose, state.config.snap_distance) ||
            (horizontal_distance_squared(seen, target) > state.config.arrive_eps ** 2 &&
              stuck_too_long(seen.progress_at, now, state.config.stuck_ms)))
        // a snap relocates the follower — reset its track so the next tick measures from the slot
        if (teleport) track[member.character] = { x: target.x, z: target.z, progress_at: now }
        return [{ character_id: member.character, x: target.x, z: target.z, yaw, teleport }]
      })
      return {
        state: { ...state, leader_pose: pose, follower_track: track },
        outputs: { ...no_outputs(), follow_move: rows },
      }
    }
    case 'member_position': {
      const { positions, now } = input
      if (!Array.isArray(positions) || !positions.length) return still(state)
      const followers = aligned_alts(state).slice(0, MAX_OWNED_FOLLOWERS)
      const slot_of = new Map(followers.map((member, index) => [member.character, index]))
      const track = { ...state.follower_track }
      for (const row of positions) {
        const slot_index = slot_of.get(row?.character_id)
        if (slot_index == null || !Number.isFinite(row.x) || !Number.isFinite(row.z)) continue
        const previous = track[row.character_id]
        const target = state.leader_pose
          ? follow_formation_target(state.leader_pose, state.leader_pose.yaw, slot_index)
          : null
        const arrived = target && horizontal_distance_squared(row, target) <= state.config.arrive_eps ** 2
        const moved = previous && horizontal_distance_squared(previous, row) > FOLLOW_PROGRESS_EPS ** 2
        const progress_at = !previous || !target || moved || arrived ? now : previous.progress_at
        track[row.character_id] = { x: row.x, z: row.z, progress_at }
      }
      return still({ ...state, follower_track: track })
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
      const joiners = !join_open
        ? []
        : aligned_alts(state).filter(
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
      const owned = new Set(owned_alts(state).map((member) => member.character))
      const rows = (Array.isArray(assignments) ? assignments : []).filter(
        (assignment) =>
          owned.has(assignment?.character_id) &&
          !requested_before.includes(assignment.character_id) &&
          !is_blocked(state, assignment.character_id, 'dungeon')
      )
      const dungeon = { world_id, requested: [...requested_before, ...rows.map((row) => row.character_id)] }
      return { state: { ...state, dungeon }, outputs: { ...no_outputs(), enter_dungeon: rows } }
    }
    case 'dungeon_ended':
      return still({ ...state, dungeon: null })
    default:
      return still(state)
  }
}

const MEMBERSHIP_KINDS = new Set(['group', 'invite_accepted', 'member_world_state', 'member_blocked'])
const FOLLOW_KINDS = new Set(['leader_position', 'member_position'])
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
  if (kind === 'reset') return still({ ...empty_group_state(), config: state.config })
  return still(state)
}
