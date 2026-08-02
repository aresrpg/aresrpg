// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Headless units for the GROUP WIRING seam (MULTICHAR lane): the DI core drives the pure group loop and
// executes its requests through injected fakes — no module mocks (bun mock.module is process-global), no DOM.
import { describe, expect, test } from 'bun:test'

import i18n from '../i18n'
import { tx_error } from '../game/core/abort_copy.js'

import {
  create_group_wiring,
  build_follow_entries,
  fight_facts_of,
  group_world_rows,
  name_alt_fight_refusal,
} from './group_wiring_core.js'

const ME = '0xwallet'
const LEADER = '0xleader'
const ALT_1 = '0xalt1'
const ALT_2 = '0xalt2'
const WORLD = '0xworld_a'
const OTHER_WORLD = '0xworld_b'

const members = (...ids) => ids.map((character, order) => ({ character, owner: ME, order }))
const worlds = (rows) => rows.map(([character_id, world_id]) => ({ character_id, world_id }))

function make_harness({ join_world_impl, join_fight_impl } = {}) {
  const calls = { join_world: [], write_checkpoint: [], join_fight: [], focus: [], follow: [], dragon: [] }
  // Mirrors tx.js's run_character_action: `{ queued: true }` (every group-wiring join) waits behind
  // whatever this fake is already running, the SAME guarantee the real ONE cross-character lane gives —
  // a faithful double, not a bare pass-through, or this harness could never catch a lost serialization.
  let join_world_tail = Promise.resolve()
  const wiring = create_group_wiring({
    join_world: (character_id, world_id, { queued = false } = {}) => {
      const task = () => {
        calls.join_world.push([character_id, world_id])
        return join_world_impl ? join_world_impl(character_id, world_id) : Promise.resolve()
      }
      const run = queued ? join_world_tail.then(task) : Promise.resolve().then(task)
      join_world_tail = run.catch(() => undefined)
      return run
    },
    read_checkpoint: () => ({ x: 105, z: 100 }),
    write_checkpoint: async (character_id, world_id, position) => {
      calls.write_checkpoint.push([character_id, world_id, position])
      return { character_id, world_id, position }
    },
    join_fight: (character_id, fight_id, options) =>
      join_fight_impl
        ? join_fight_impl(character_id, fight_id, options)
        : Promise.resolve(calls.join_fight.push([character_id, fight_id])),
    focus_seat: (character_id) => calls.focus.push(character_id),
    apply_follow: (rows) => calls.follow.push(rows),
    dragon_fly: (character_id, world_id, target) => {
      calls.dragon.push({ character_id, world_id, target })
      return Promise.resolve()
    },
    is_executed_failure: (error) => !!error?.executed,
    log: () => {},
  })
  return { wiring, calls }
}

// GROUP MEMBERSHIP IS AUTO-FOLLOW (#613): sync_group now reconciles the follower set to the owned group members
// behind the leader — no enable_follow/set_follow. To follow exactly `ids`, put exactly those owned alts in the
// group; sync_group arms them (entry-eval) and a later sync that drops an id kicks it.
const sync_full_group = (wiring, world_rows, ids = [ALT_1, ALT_2]) =>
  wiring.sync_group({
    my_address: ME,
    leader_character_id: LEADER,
    members: members(LEADER, ...ids),
    worlds: worlds(world_rows),
  })

describe('group wiring — feeds the reducer, executes its requests once', () => {
  test('explicit enable runs owned CROSS-WORLD joins sequentially through the one transaction queue', async () => {
    let release_first
    let mark_started
    const first_started = new Promise((resolve) => {
      mark_started = resolve
    })
    const first_gate = new Promise((resolve) => {
      release_first = resolve
    })
    const { wiring, calls } = make_harness({
      join_world_impl: async (character_id) => {
        if (character_id === ALT_1) {
          mark_started()
          await first_gate
        }
      },
    })
    // both alts are in a DIFFERENT world → both take the join transaction (a same-world alt would read its
    // position instead and never queue a join — #613); the queue serializes the two joins.
    sync_full_group(wiring, [
      [LEADER, WORLD],
      [ALT_1, OTHER_WORLD],
      [ALT_2, OTHER_WORLD],
    ])
    wiring.pose_tick({ x: 100, z: 100, yaw: 0 }, { character_id: LEADER })
    await first_started
    expect(calls.join_world).toEqual([[ALT_1, WORLD]])
    release_first()
    await wiring.settled()
    expect(calls.join_world).toEqual([
      [ALT_1, WORLD],
      [ALT_2, WORLD],
    ])
    expect(wiring.store.getState().follow.followers[ALT_1].status).toBe('in_transit')
    expect(wiring.store.getState().follow.followers[ALT_2].status).toBe('in_transit')
  })

  test('#496 — the follow formation anchors to the avatar facing_yaw, never the camera azimuth (pose.yaw)', () => {
    const { wiring } = make_harness()
    sync_full_group(wiring, [
      [LEADER, WORLD],
      [ALT_1, WORLD],
    ])
    // Orbiting a STANDING avatar: the camera azimuth (pose.yaw) swings while the avatar heading holds.
    // The leader pose the reducer clocks must track facing_yaw — feeding pose.yaw is the #496 camera chase.
    wiring.pose_tick({ x: 0, z: 0, yaw: Math.PI, facing_yaw: 0 }, { character_id: LEADER })
    expect(wiring.store.getState().leader_pose.yaw).toBe(0)
    // Absent facing_yaw (pre-motion frame) still degrades to the camera yaw so the pose is never dropped.
    wiring.pose_tick({ x: 0, z: 0, yaw: 1.25 }, { character_id: LEADER })
    expect(wiring.store.getState().leader_pose.yaw).toBe(1.25)
  })

  test('an EXECUTED follow join failure latches the member and a leader world change never re-fires it', async () => {
    const { wiring, calls } = make_harness({
      join_world_impl: () => Promise.reject(Object.assign(new Error('abort'), { executed: true })),
    })
    sync_full_group(
      wiring,
      [
        [LEADER, WORLD],
        [ALT_2, OTHER_WORLD],
      ],
      [ALT_2]
    ) // only ALT_2 in the group → follows
    wiring.pose_tick({ x: 100, z: 100, yaw: 0 }, { character_id: LEADER })
    await wiring.settled()
    expect(calls.join_world).toEqual([[ALT_2, WORLD]])
    wiring.sync_group({
      my_address: ME,
      leader_character_id: LEADER,
      members: members(LEADER, ALT_2),
      worlds: worlds([[LEADER, '0xworld_c']]),
    })
    await wiring.settled()
    expect(calls.join_world).toEqual([[ALT_2, WORLD]])
    expect(calls.join_fight).toHaveLength(0)
  })

  test('#509 — transit is a VISIBLE run-in; arrival writes the checkpoint; a dungeon hides the followers', async () => {
    const { wiring, calls } = make_harness()
    // ALT_1 is in a DIFFERENT world → the join → proof-of-time flight leg (a same-world alt would resolve
    // straight to with_you and never run this timer). Only ALT_1 is grouped, so only it follows.
    sync_full_group(
      wiring,
      [
        [LEADER, WORLD],
        [ALT_1, OTHER_WORLD],
      ],
      [ALT_1]
    )
    const now = Date.now()
    wiring.pose_tick({ x: 100, z: 100, yaw: 0, facing_yaw: 0 }, { character_id: LEADER }, now)
    await wiring.settled()
    // the run-in is VISIBLE: mid-transit the timer projects the follower into range and it renders (no
    // arrival-spawn model). Position derives from the reducer's proof-of-time timer, never peer presence.
    wiring.transit_tick(now + 5_000)
    expect(wiring.store.getState().follow.followers[ALT_1].status).toBe('in_transit')
    expect(calls.follow.at(-1).map((row) => row.character_id)).toEqual([ALT_1])
    // arrival writes the checkpoint beside the leader's current cell
    wiring.transit_tick(now + 30_000)
    await wiring.settled()
    expect(calls.write_checkpoint).toEqual([[ALT_1, WORLD, { x: 101.5, z: 100.5 }]])
    expect(wiring.store.getState().follow.followers[ALT_1].status).toBe('with_you') // #613 — completion consumed
    // a dungeon hides the in-world followers (the background timer keeps ticking, but nothing renders in-cave)
    wiring.dungeon_snapshot(true)
    expect(wiring.store.getState().follow.dungeon_background).toBe(true)
    expect(calls.follow.at(-1)).toEqual([])
  })

  test('#171/#613 — a same-world group member follows (with_you), and a KICK despawns its standalone rig', async () => {
    const { wiring, calls } = make_harness()
    const now = Date.now()
    wiring.pose_tick({ x: 100, z: 100, yaw: 0, facing_yaw: 0 }, { character_id: LEADER }, now)
    // group ALT_1 with the leader — NEAR (read_checkpoint fake {105,100} is ~5 blocks off) → it resolves
    // straight to the with_you free-run companion and renders its standalone rig at once. No redundant join.
    sync_full_group(
      wiring,
      [
        [LEADER, WORLD],
        [ALT_1, WORLD],
      ],
      [ALT_1]
    )
    await wiring.settled()
    expect(calls.join_world).toEqual([])
    expect(wiring.store.getState().follow.follower_character_ids).toEqual([ALT_1])
    expect(wiring.store.getState().follow.followers[ALT_1].status).toBe('with_you')
    expect(calls.follow.at(-1).map((r) => r.character_id)).toEqual([ALT_1])
    // KICK — ALT_1 leaves the group → reconcile disarms it (kick is the only disable) and forces apply_follow([])
    // so the standalone rig despawns. A bare length-gate would have leaked the rig; a kick MUST end following.
    wiring.sync_group({
      my_address: ME,
      leader_character_id: LEADER,
      members: members(LEADER),
      worlds: worlds([[LEADER, WORLD]]),
    })
    expect(wiring.store.getState().follow.enabled).toBe(false)
    expect(wiring.store.getState().follow.follower_character_ids).toEqual([])
    expect(calls.follow.at(-1)).toEqual([])
  })

  test('#509 — a FAR join rides the dragon: fast_travel drives dragon_fly, then follow_dragon_arrived seats it', async () => {
    const { wiring, calls } = make_harness()
    // leader at the origin; ALT_1 in another world → its join checkpoint (read_checkpoint fake → {105,100}) is
    // ~145 blocks out (> DRAGON_DISTANCE 50) → the run-in ALSO dispatches the dragon.
    wiring.pose_tick({ x: 0, z: 0, yaw: 0, facing_yaw: 0 }, { character_id: LEADER })
    sync_full_group(
      wiring,
      [
        [LEADER, WORLD],
        [ALT_1, OTHER_WORLD],
      ],
      [ALT_1]
    )
    await wiring.settled()
    // the far run-in dispatched the dragon to the leader's cell, and its landing seated the follower
    expect(calls.dragon.map((row) => row.character_id)).toEqual([ALT_1])
    expect(calls.dragon[0].target).toEqual({ x: 0, z: 0 })
    expect(wiring.store.getState().follow.followers[ALT_1].status).toBe('with_you') // #613 — completion consumed
    expect(calls.write_checkpoint.at(-1)?.[0]).toBe(ALT_1) // the arrival checkpoint landed beside the leader
  })

  test('#613 — an emptied party projection KICKS every follower (kick is the only disable, no ghost follow)', async () => {
    const { wiring, calls } = make_harness()
    // leader beside the join checkpoint ({105,100}) so the follower simply runs in — no dragon, no arrival churn
    wiring.pose_tick({ x: 100, z: 100, yaw: 0 }, { character_id: LEADER }, 1_000)
    sync_full_group(
      wiring,
      [
        [LEADER, WORLD],
        [ALT_1, WORLD],
      ],
      [ALT_1]
    ) // ALT_1 near → with_you companion
    await wiring.settled()
    expect(wiring.store.getState().follow.follower_character_ids).toEqual([ALT_1])
    // the party empties (leave / kick-all) → reconcile drops every follower. The OLD bug: the 'group' mirror
    // never pruned follower_character_ids, so a kicked character followed forever with no escape. Kick MUST end it.
    wiring.sync_group({ my_address: ME, leader_character_id: LEADER, members: [], worlds: [] })
    expect(wiring.store.getState().follow.enabled).toBe(false)
    expect(wiring.store.getState().follow.follower_character_ids).toEqual([])
    expect(calls.follow.at(-1)).toEqual([]) // the render despawns the dropped rig
  })

  test('a placement fight joins the ARRIVED alts ONCE across polls; focus follows each owned turn', async () => {
    const { wiring, calls } = make_harness()
    // #1661 — the leader's pose comes FIRST so each alt's checkpoint read can settle: {105,100} against a
    // leader at {100,100} is a near arrival (with_you). Only an ARRIVED alt is auto-seated, so a fixture that
    // never lets its followers finish traveling is a fixture that must not see a join.
    wiring.pose_tick({ x: 100, z: 100, yaw: 0 }, { character_id: LEADER })
    sync_full_group(wiring, [
      [LEADER, WORLD],
      [ALT_1, WORLD],
      [ALT_2, WORLD],
    ])
    await wiring.settled()
    // group membership IS auto-follow (#613): both grouped alts are followers → once they ARRIVE, fight_started
    // steers both.
    const facts = { fight_id: '0xf', placement: true, over: false, active_entity_id: null, seated: [LEADER] }
    wiring.fight_snapshot(facts, { join_open: true })
    wiring.fight_snapshot(facts, { join_open: true }) // poll echo
    await wiring.settled()
    expect(calls.join_fight).toEqual([
      [ALT_1, '0xf'],
      [ALT_2, '0xf'],
    ])
    // turn order drives the seat focus exactly once per boundary; mob turns change nothing
    wiring.fight_snapshot({ ...facts, placement: false, seated: [LEADER, ALT_1, ALT_2], active_entity_id: LEADER })
    wiring.fight_snapshot({ ...facts, placement: false, seated: [LEADER, ALT_1, ALT_2], active_entity_id: LEADER })
    wiring.fight_snapshot({ ...facts, placement: false, seated: [LEADER, ALT_1, ALT_2], active_entity_id: 'mob-0' })
    wiring.fight_snapshot({ ...facts, placement: false, seated: [LEADER, ALT_1, ALT_2], active_entity_id: ALT_1 })
    expect(calls.focus).toEqual([LEADER, ALT_1])
    // victory clears the armed fight; the next fight re-arms cleanly
    wiring.fight_snapshot({ ...facts, over: true, seated: [LEADER, ALT_1, ALT_2] })
    expect(wiring.store.getState().fight).toBe(null)
  })

  test('party fight joins queue behind the creator and complete one member at a time', async () => {
    const creator_gate = Promise.withResolvers()
    const order = ['creator:start']
    let tail = creator_gate.promise.then(() => order.push('creator:end'))
    let pending = 1
    const schedule_tx = (task, { queued = false } = {}) => {
      if (!queued && pending) return Promise.reject(new Error('character action in progress'))
      pending += 1
      const scheduled = tail.then(task)
      tail = scheduled
        .catch(() => undefined)
        .then(() => {
          pending -= 1
        })
      return scheduled
    }
    const { wiring, calls } = make_harness({
      join_fight_impl: (character_id, fight_id, options) =>
        schedule_tx(async () => {
          order.push(`${character_id}:start`)
          calls.join_fight.push([character_id, fight_id])
          await Promise.resolve()
          order.push(`${character_id}:end`)
        }, options),
    })
    wiring.pose_tick({ x: 100, z: 100, yaw: 0 }, { character_id: LEADER })
    sync_full_group(wiring, [
      [LEADER, WORLD],
      [ALT_1, WORLD],
      [ALT_2, WORLD],
    ])
    await wiring.settled()
    // group membership IS auto-follow (#613): both grouped alts are followers, and both ARRIVED above (#1661)
    // → fight_started steers both.

    wiring.fight_snapshot(
      { fight_id: '0xf', placement: true, over: false, active_entity_id: null, seated: [LEADER] },
      { join_open: true }
    )
    await Promise.resolve()
    expect(calls.join_fight).toEqual([])

    creator_gate.resolve()
    await wiring.settled()
    expect(calls.join_fight).toEqual([
      [ALT_1, '0xf'],
      [ALT_2, '0xf'],
    ])
    expect(order).toEqual([
      'creator:start',
      'creator:end',
      `${ALT_1}:start`,
      `${ALT_1}:end`,
      `${ALT_2}:start`,
      `${ALT_2}:end`,
    ])
  })

  test('a mid-active resume (join window closed) arms focus WITHOUT firing any join transaction', async () => {
    const { wiring, calls } = make_harness()
    sync_full_group(wiring, [
      [LEADER, WORLD],
      [ALT_1, WORLD],
      [ALT_2, WORLD],
    ])
    wiring.fight_snapshot(
      { fight_id: '0xf', placement: false, over: false, active_entity_id: ALT_2, seated: [LEADER, ALT_2] },
      { join_open: false }
    )
    await wiring.settled()
    expect(calls.join_fight).toEqual([])
    expect(calls.focus).toEqual([ALT_2])
  })
})

describe('pure helpers', () => {
  // #2007 — the group loop's world truth is RESOLVED FROM THE ONE BINDING BOOK at decision time. The roster
  // card's `world_id` is a cached snapshot: feeding it here made a third home that could disagree with both
  // the session and the roster, and routed followers through a stale-world join.
  test('group_world_rows resolves leader + members + live followers from the book, never from cards', () => {
    const book = new Map([
      [LEADER, WORLD], // the join receipt already moved the leader; the roster card still says OTHER_WORLD
      [ALT_1, OTHER_WORLD],
    ])
    const rows = group_world_rows((id) => book.get(id), {
      leader_character_id: LEADER,
      members: members(LEADER, ALT_1),
      follower_character_ids: [ALT_2],
    })
    expect(rows).toEqual([
      { character_id: LEADER, world_id: WORLD },
      { character_id: ALT_1, world_id: OTHER_WORLD },
      { character_id: ALT_2, world_id: null }, // unknown reads as unbound, never invented
    ])
  })

  test('group_world_rows scopes to the group — an unrelated roster character is never fed', () => {
    const rows = group_world_rows(() => WORLD, {
      leader_character_id: LEADER,
      members: members(LEADER),
      follower_character_ids: [],
    })
    expect(rows.map((row) => row.character_id)).toEqual([LEADER])
  })

  test('fight_facts_of maps an engine view to the loop facts (players only, mob keys excluded)', () => {
    const view = {
      fight_id: '0xf',
      placement: true,
      winner: -1,
      active_entity_id: LEADER,
      fighters: new Map([
        [LEADER, {}],
        [ALT_1, {}],
        ['mob-0', {}],
      ]),
    }
    expect(fight_facts_of(view)).toEqual({
      fight_id: '0xf',
      placement: true,
      over: false,
      active_entity_id: LEADER,
      seated: [LEADER, ALT_1],
    })
    expect(fight_facts_of(null)).toBe(null)
    expect(fight_facts_of({ fight_id: '0xf', winner: 0, fighters: new Map() })?.over).toBe(true)
  })

  test('build_follow_entries produces renderer rows from roster cards and skips unresolved identities', () => {
    const rows = [
      { character_id: ALT_1, x: 5, z: 7, yaw: 1 },
      { character_id: ALT_2, x: 6, z: 8, yaw: 1 },
    ]
    const cards = new Map([[ALT_1, { id: ALT_1, name: 'Kara', classe: 'yajin', male: false, color_1: 3 }]])
    const entries = build_follow_entries(rows, cards, WORLD)
    expect(entries).toHaveLength(1)
    expect(entries[0].entry).toMatchObject({
      id: ALT_1,
      name: 'Kara',
      classe: 'yajin',
      male: false,
      owned_follow: true,
      target_position: { x: 5, y: 0, z: 7 },
      target_yaw: 1,
    })
    expect(entries[0].cache_position).toEqual({ character_id: ALT_1, world_id: WORLD, x: 5, z: 7 })
    expect(build_follow_entries(rows, cards, null)).toEqual([])
  })

  test('#613 build_follow_entries threads the free-run companion contract (free_run + follow_anchor) for pet_follow', () => {
    const rows = [{ character_id: ALT_1, x: 5, z: 7, yaw: 1, free_run: true, anchor: { x: 9, z: 3, yaw: 0.2 } }]
    const cards = new Map([[ALT_1, { id: ALT_1, name: 'Kara', classe: 'yajin', male: false }]])
    const [{ entry }] = build_follow_entries(rows, cards, WORLD)
    expect(entry.free_run).toBe(true)
    expect(entry.follow_anchor).toEqual({ x: 9, z: 3, yaw: 0.2 }) // the leader target step_pet_follow steers toward
    expect(entry.position).toMatchObject({ x: 5, z: 7 }) // spawns at the alt's real seed, never on the leader
    expect(entry.target_position).toMatchObject({ x: 9, z: 3 }) // the range gate rides the anchor → always present
  })
})

// #614 — a fight-entry refusal about an ALT (join_fight never seats the leader — owned_alts excludes it)
// used to surface a toast that (a) could borrow a DIFFERENT reason's copy and (b) never named which
// character it was about, reading as if it concerned whoever the player was actively engaging.
describe('#614 — alt fight-entry refusals name the acting character, never collapse to one line', () => {
  const abort = (module, code) =>
    tx_error({ MoveAbort: { abortCode: code, location: { module } } }, { preflight: true })

  // Every one of these is a REAL, reachable refusal for an owned-alt join (engine::join's own asserts +
  // the character's fight_latch shard) — each already has its own honest line in abort_copy.js's table.
  const REASONS = [
    {
      label: 'already seated in another live fight',
      refusal: abort('fight_latch', 103),
      key: 'errors.fight_character_busy',
    },
    { label: 'the fight side is already full', refusal: abort('fight', 102), key: 'errors.fight_team_full' },
    {
      label: 'already holds a seat in this exact fight',
      refusal: abort('fight', 108),
      key: 'errors.fight_already_seated',
    },
    {
      label: 'an unopened fight result blocks the seat',
      refusal: abort('fight', 111),
      key: 'errors.fight_unclaimed_result',
    },
  ]

  for (const { label, refusal, key } of REASONS)
    test(`${label} keeps its own honest copy, named for the alt`, () => {
      const named = name_alt_fight_refusal(refusal, 'Shadowdancer')
      expect(named.message).toBe(i18n.t('fights.alt_entry_refused', { character: 'Shadowdancer', reason: i18n.t(key) }))
      expect(named.message).toContain('Shadowdancer')
    })

  test('every refusal reason produces a DISTINCT composed string — none collapse to a shared line', () => {
    const messages = REASONS.map(({ refusal }) => name_alt_fight_refusal(refusal, 'Shadowdancer').message)
    expect(new Set(messages).size).toBe(REASONS.length)
  })

  test('no resolved character name degrades honestly to the plain reason (never "undefined")', () => {
    const named = name_alt_fight_refusal(abort('fight_latch', 103), null)
    expect(named.message).toBe(i18n.t('errors.fight_character_busy'))
    expect(named.message).not.toContain('undefined')
  })

  test('an EXECUTED failure (gas burned) keeps its digest on the named error — the burn-law latch survives', () => {
    const executed = Object.assign(new Error('on-chain fight abort'), { digest: '0xdeadbeef' })
    const named = name_alt_fight_refusal(executed, 'Shadowdancer', { humanize: () => 'reason text' })
    expect(named.digest).toBe('0xdeadbeef')
  })

  test('a PRE-FLIGHT refusal (zero gas spent) carries no digest onto the named error — never falsely latched', () => {
    const named = name_alt_fight_refusal(abort('fight', 102), 'Shadowdancer')
    expect(named.digest).toBeUndefined()
  })
})
