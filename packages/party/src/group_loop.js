// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE GROUP LOOP REDUCER (MULTICHAR lane, D769b design note) — the pure sequencer of a player's
// multi-character loop: ONE human drives N owned characters as a party. Membership truth stays in
// reduce.js (chain-reconciled); THIS reducer owns the leader-session orchestration facts and emits
// EFFECT REQUESTS exactly once per need:
//
//   INPUTS   { group | invite_accepted | member_world_state | follow_enable | follow_world_joined |
//              transit_tick | follow_checkpoint_written | leader_position | member_blocked |
//              fight_started | fight_seat_update | turn_started | fight_ended | dungeon_entered |
//              dungeon_ended | reset }
//   OUTPUTS  { join_world[] · write_checkpoint[] · follow_render[] · join_fight[] · hud_focus ·
//              enter_dungeon[] }
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
const no_outputs = () => ({
  join_world: EMPTY_ROWS,
  follow_move: EMPTY_ROWS,
  write_checkpoint: EMPTY_ROWS,
  follow_render: EMPTY_ROWS,
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
  config: {
    snap_distance: config.snap_distance ?? FOLLOW_SNAP_DISTANCE,
    stuck_ms: config.stuck_ms ?? FOLLOW_STUCK_MS,
    arrive_eps: config.arrive_eps ?? FOLLOW_ARRIVE_EPS,
  },
})

const leader_world = (state) => state.world_by_character[state.leader_character_id] ?? null
const follow_leader_world = (state) => state.world_by_character[state.follow.leader_character_id] ?? null

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
      for (const follower_character_id of state.follow.follower_character_ids) {
        const row = followers[follower_character_id]
        if (!row || is_blocked(state, follower_character_id, 'world_join')) continue
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
        outputs: { ...no_outputs(), join_world },
      }
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

const rendered_followers = (state, pose) =>
  state.follow.follower_character_ids.flatMap((character_id, slot_index) => {
    const row = state.follow.followers[character_id]
    if (row?.status !== 'arrived' || !row.receipt_confirmed) return []
    const target = follow_formation_target(pose, pose.yaw, slot_index)
    return target ? [{ character_id, ...target, yaw: pose.yaw }] : []
  })

// ── follow transit: explicit session ids + reducer-clocked ETA, never active-character selection ──────────
// eslint-disable-next-line complexity -- one exhaustive event switch is the reducer's single write door.
function reduce_follow(state, input) {
  switch (input.kind) {
    case 'follow_enable': {
      const { leader_character_id } = input
      const world_id = state.world_by_character[leader_character_id] ?? null
      if (!leader_character_id || !world_id) return still(state)
      const allowed = new Set(
        state.members
          .filter((member) => member.character !== leader_character_id && member.owner === state.my_address)
          .map((member) => member.character)
      )
      const room = Math.max(0, MAX_OWNED_FOLLOWERS - state.follow.follower_character_ids.length)
      const added = [...new Set(input.follower_character_ids ?? [])]
        .filter((character_id) => allowed.has(character_id) && !is_blocked(state, character_id, 'world_join'))
        .slice(0, room)
      if (!added.length) return still(state)
      const follower_character_ids = [
        ...state.follow.follower_character_ids.filter((character_id) => character_id !== leader_character_id),
        ...added.filter((character_id) => !state.follow.follower_character_ids.includes(character_id)),
      ]
      const followers = { ...state.follow.followers }
      for (const character_id of added)
        followers[character_id] = {
          status: 'joining',
          world_id,
          carry_ratio: 1,
          receipt_confirmed: false,
        }
      return {
        state: {
          ...state,
          follow: { ...state.follow, enabled: true, leader_character_id, follower_character_ids, followers },
        },
        outputs: {
          ...no_outputs(),
          join_world: added.map((character_id) => ({ character_id, world_id })),
        },
      }
    }
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
      return still({
        ...state,
        follow: {
          ...state.follow,
          followers: {
            ...state.follow.followers,
            [input.character_id]: begin_transit(row, checkpoint, state.leader_pose, now),
          },
        },
      })
    }
    case 'transit_tick': {
      if (!state.follow.enabled || !Number.isFinite(input.now)) return still(state)
      const followers = { ...state.follow.followers }
      const occupied = new Set(
        Object.values(followers)
          .filter((row) => row?.arrival_position)
          .map((row) => `${row.arrival_position.x}:${row.arrival_position.z}`)
      )
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
        followers[character_id] = {
          ...row,
          status: 'arrived',
          remaining_ms: 0,
          progress: 1,
          arrival_position: position,
          receipt_confirmed: false,
        }
        write_checkpoint.push({ character_id, world_id: row.world_id, position })
      }
      return {
        state: { ...state, follow: { ...state.follow, followers } },
        outputs: { ...no_outputs(), write_checkpoint },
      }
    }
    case 'follow_checkpoint_written': {
      const row = state.follow.followers[input.character_id]
      if (!row || row.status !== 'arrived' || row.receipt_confirmed) return still(state)
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
        outputs: { ...no_outputs(), follow_render: rendered_followers(state, pose) },
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
      // #540 — MEMBERSHIP IS NOT CONSENT: an aligned alt used to auto-join every fight the active character
      // engaged (never completes, the fight never starts, refresh doesn't re-adopt — a full multi-char block).
      // Gate behind the SAME explicit follow.enabled this reducer already requires for follow_world_joined /
      // transit — no separate flag: the future auto-follow UI (enable_group_follow, unwired today) is exactly
      // "consent to steer my alts," and that single switch should arm joins/dungeons alongside positioning.
      const joiners =
        !join_open || !state.follow.enabled
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
      // #540 — same membership-is-not-consent hole as fight_started: an owned alt used to auto-enter every
      // dungeon assignment regardless of follow.enabled. Same gate, same reasoning.
      const owned = state.follow.enabled ? new Set(owned_alts(state).map((member) => member.character)) : new Set()
      const rows = (Array.isArray(assignments) ? assignments : []).filter(
        (assignment) =>
          owned.has(assignment?.character_id) &&
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
  'follow_enable',
  'follow_world_joined',
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
  if (kind === 'reset') return still({ ...empty_group_state(), config: state.config })
  return still(state)
}
