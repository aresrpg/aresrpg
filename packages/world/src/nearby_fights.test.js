// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// NEARBY FIGHTS — pure panel logic proof: the shaping tolerates BOTH the
// served shape_fight and the stale RpcFight twin, proximity gates at 50 blocks, join/spectate legality matches
// the on-chain gate (join = public or exact-group placement, spectate = started), friends sort to the top,
// the two toggles filter, and the list caps at 20. Standalone — no store/IO imports, no mocks.
import { describe, expect, test } from 'bun:test'

import { OPENNESS_PUBLIC, OPENNESS_GROUP } from './openness.js'
import {
  FIGHT_PROXIMITY_M,
  FIGHT_LIST_CAP,
  participant_ids,
  to_fight_marker,
  fight_distance,
  in_range,
  is_join_legal,
  is_dungeon_join_legal,
  is_spectatable,
  sort_friends_first,
  cap_and_filter,
  party_character_ids,
  section_fight_rows,
  to_dungeon_fight,
  forming_fight_sword_markers,
  group_engage_blocked,
} from './nearby_fights.js'

// A served /v1/fights row (shape_fight — the shape get_fights actually returns).
const served = (over = {}) => ({
  fight_id: '0xf1',
  world: '0xw',
  spawn_id: '7',
  anchor: { x: 100, z: 200 },
  public: true,
  status: 'placement',
  participants: [
    { character: '0xcharA', seat: 0 },
    { character: '0xcharB', seat: 1 },
  ],
  mob_count: 3,
  ...over,
})

// The stale RpcFight twin (participants as a Record, anchor_x/_z, `fight` id) — a projection drift must not blank it.
const stale = (over = {}) => ({
  fight: '0xf2',
  anchor_x: 10,
  anchor_z: 20,
  public_fight: false,
  status: 'active',
  participants: { '0xcharC': 0 },
  mob_count: 1,
  ...over,
})

describe('constants', () => {
  test('openness + cap + radius match the documented constants', () => {
    expect(OPENNESS_PUBLIC).toBe('public')
    expect(OPENNESS_GROUP).toBe('group')
    expect(FIGHT_PROXIMITY_M).toBe(50)
    expect(FIGHT_LIST_CAP).toBe(20)
  })
})

describe('participant_ids — both shapes', () => {
  test('array shape (served)', () => {
    expect(participant_ids(served())).toEqual(['0xcharA', '0xcharB'])
  })
  test('record shape (stale)', () => {
    expect(participant_ids(stale())).toEqual(['0xcharC'])
  })
  test('missing → []', () => {
    expect(participant_ids({})).toEqual([])
    expect(participant_ids(null)).toEqual([])
  })
})

describe('to_fight_marker', () => {
  test('served row → marker, placement = not started, public', () => {
    const m = to_fight_marker(served())
    expect(m.id).toBe('0xf1')
    expect(m.public).toBe(true)
    expect(m.status).toBe('placement')
    expect(m.started).toBe(false)
    expect(m.participant_count).toBe(2)
    expect(m.mob_count).toBe(3)
    expect(m.position).toEqual({ x: 100, z: 200 })
  })
  test('carries the served group_template (mob-group id) through, null when absent', () => {
    // shape_fight joins rpc:group_template onto the fight; the marker threads it so the panel can name the mobs.
    expect(to_fight_marker(served({ group_template: '0xtmpl' })).group_template).toBe('0xtmpl')
    expect(to_fight_marker(served()).group_template).toBeNull() // no join → honest "Enemies #N" fallback
  })
  test('stale row → marker, active = started, group-only', () => {
    const m = to_fight_marker(stale())
    expect(m.id).toBe('0xf2')
    expect(m.public).toBe(false)
    expect(m.started).toBe(true)
    expect(m.participant_ids).toEqual(['0xcharC'])
  })
  test('to_world coord bringer is applied to the anchor', () => {
    const m = to_fight_marker(served(), (c) => c - 50)
    expect(m.position).toEqual({ x: 50, z: 150 })
  })
  test('no id → null (never a ghost row)', () => {
    expect(to_fight_marker({ anchor: { x: 1, z: 2 } })).toBeNull()
  })
})

describe('proximity — 50-block ring', () => {
  const at = (x, z) => to_fight_marker(served({ anchor: { x, z } }))
  test('distance is planar x/z', () => {
    expect(fight_distance(at(3, 4), { x: 0, z: 0 })).toBe(5)
  })
  test('in_range true inside 50, false past it', () => {
    expect(in_range(at(30, 40), { x: 0, z: 0 })).toBe(true) // 50 exactly
    expect(in_range(at(36, 48), { x: 0, z: 0 })).toBe(false) // 60
  })
  test('null player cell or anchor → out of range (never a spurious hit)', () => {
    expect(in_range(at(0, 0), null)).toBe(false)
    expect(fight_distance(null, { x: 0, z: 0 })).toBe(Infinity)
  })
})

describe('join / spectate legality', () => {
  test('JOIN accepts public placement and an exact group member in group-only placement', () => {
    expect(is_join_legal(to_fight_marker(served({ public: true, status: 'placement' })))).toBe(true)
    expect(is_join_legal(to_fight_marker(served({ public: false, status: 'placement' })))).toBe(false) // group-only
    expect(is_join_legal(to_fight_marker(served({ public: false, status: 'placement' })), true)).toBe(true)
    expect(is_join_legal(to_fight_marker(served({ public: true, status: 'active' })))).toBe(false) // started
    expect(is_join_legal(to_fight_marker(served({ public: false, status: 'active' })), true)).toBe(false)
    expect(is_join_legal(null)).toBe(false)
  })
  test('DUNGEON join legal in placement regardless of the (always-private) openness — vouched same-room on-chain', () => {
    expect(is_dungeon_join_legal(to_fight_marker(served({ public: false, status: 'placement' })))).toBe(true)
    expect(is_dungeon_join_legal(to_fight_marker(served({ public: false, status: 'active' })))).toBe(false)
    expect(is_dungeon_join_legal(null)).toBe(false)
  })
  test('SPECTATE legal once started (active), never placement or terminal', () => {
    expect(is_spectatable(to_fight_marker(served({ status: 'active' })))).toBe(true)
    expect(is_spectatable(to_fight_marker(served({ status: 'placement' })))).toBe(false)
    expect(is_spectatable(to_fight_marker(served({ status: 'victory' })))).toBe(false)
    expect(is_spectatable(to_fight_marker(served({ status: 'defeat' })))).toBe(false)
  })
})

describe('Party exact-member identity + D749 sections', () => {
  test('FightsModal member ids come only from Member.character, never every character owned by a member wallet', () => {
    const members = [
      { character: '0xleader', owner: '0xsame', order: 0 },
      { character: '0xaccepted-alt', owner: '0xsame', order: 1 },
      { character: '0xfriend', owner: '0xother', order: 2 },
    ]
    expect([...party_character_ids(members)]).toEqual(['0xleader', '0xaccepted-alt', '0xfriend'])
    expect(party_character_ids(members).has('0xunaccepted-same-owner-alt')).toBe(false)
  })

  test('sections render GROUP before PUBLIC and preserve relevance order inside each', () => {
    const rows = [
      { id: 'public-friend', public: true },
      { id: 'group-near', public: false },
      { id: 'public-near', public: true },
      { id: 'group-far', public: false },
    ]
    expect(section_fight_rows(rows)).toEqual([
      { key: 'group', rows: [rows[1], rows[3]] },
      { key: 'public', rows: [rows[0], rows[2]] },
    ])
  })
})

describe('sort_friends_first', () => {
  const mk = (id, chars, dist) => ({
    ...to_fight_marker(served({ fight_id: id, participants: chars.map((c, i) => ({ character: c, seat: i })) })),
    distance: dist,
  })
  test('friend fights float above non-friend, then nearest-first', () => {
    const friends = new Set(['0xfriend'])
    const a = mk('0xA', ['0xstranger'], 5) // non-friend, near
    const b = mk('0xB', ['0xfriend'], 40) // friend, far
    const c = mk('0xC', ['0xfriend'], 10) // friend, near
    const out = sort_friends_first([a, b, c], friends)
    expect(out.map((m) => m.id)).toEqual(['0xC', '0xB', '0xA']) // friends (near→far) then the stranger
  })
  test('no friends → pure nearest-first, stable by id on ties', () => {
    const a = mk('0xA', ['x'], 10)
    const b = mk('0xB', ['y'], 10)
    const out = sort_friends_first([b, a], new Set())
    expect(out.map((m) => m.id)).toEqual(['0xA', '0xB'])
  })
})

describe('cap_and_filter', () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    to_fight_marker(served({ fight_id: `0x${i}`, participants: [{ character: `0xc${i}`, seat: 0 }] }))
  ).map((m, i) => ({ ...m, distance: i }))

  test('caps at 20 by default, to avoid spamming', () => {
    expect(cap_and_filter(many).length).toBe(FIGHT_LIST_CAP)
  })
  test('friends_only keeps only fights with a friend fighter', () => {
    const friend_char_ids = new Set(['0xc3', '0xc7'])
    const out = cap_and_filter(many, { friend_char_ids, friends_only: true })
    expect(out.map((m) => m.id).sort()).toEqual(['0x3', '0x7'])
  })
  test('group_only keeps only fights with a party fighter', () => {
    const party_char_ids = new Set(['0xc5'])
    const out = cap_and_filter(many, { party_char_ids, group_only: true })
    expect(out.map((m) => m.id)).toEqual(['0x5'])
  })
  test('friends_only with an empty friend set keeps nothing (honest, never all-pass)', () => {
    expect(cap_and_filter(many, { friends_only: true }).length).toBe(0)
  })
  test('sort happens before cap — friend rows survive the 20-cap even when far', () => {
    const friend_char_ids = new Set(['0xc29']) // the LAST (farthest) row is a friend
    const out = cap_and_filter(many, { friend_char_ids })
    expect(out[0].id).toBe('0x29') // floated to the top, kept despite being 30th by distance
    expect(out.length).toBe(20)
  })
})

describe('to_dungeon_fight', () => {
  const marker = to_fight_marker(served({ fight_id: '0xroomfight', status: 'placement' }))
  test('run + fight marker → a joinable dungeon row carrying the creator pass + room', () => {
    const row = to_dungeon_fight({ pass_id: '0xpass', player: '0xowner', room: 3, fight_id: '0xroomfight' }, marker)
    expect(row.id).toBe('0xroomfight')
    expect(row.run_pass_id).toBe('0xpass') // join_fight re-derives (creator_pass, room)
    expect(row.room).toBe(3)
    expect(row.owner).toBe('0xowner')
    expect(is_join_legal(row)).toBe(true) // inherits the marker's placement+public gate
  })
  test('a run between rooms (null fight) → null (nothing to join/watch)', () => {
    expect(to_dungeon_fight({ pass_id: '0xpass', room: 2, fight_id: null }, null)).toBeNull()
  })
})

// RED-FIRST regression: another player starting a fight must show its sword marker immediately —
// world_fights_discovery.js polled OTHER players' fights into visible_fights but rendered zero world meshes;
// the fights view gaining a newly-forming fight must project a sword marker for it.
describe('forming_fight_sword_markers', () => {
  test('a NEWLY forming (placement) fight in visible_fights projects exactly one marker', () => {
    const forming = to_fight_marker(served({ fight_id: '0xnew', status: 'placement' }))
    const map = new Map([[forming.id, forming]])
    expect(forming_fight_sword_markers(map)).toEqual([{ id: '0xnew', position: forming.position }])
  })
  test('an ACTIVE (started) fight never gets the herald — the seated players own board took over', () => {
    const active = to_fight_marker(served({ fight_id: '0xactive', status: 'active' }))
    expect(forming_fight_sword_markers(new Map([[active.id, active]]))).toEqual([])
  })
  test('accepts a plain array too (map/array-tolerant, mirrors the store Map + a test list)', () => {
    const forming = to_fight_marker(served({ fight_id: '0xarr', status: 'placement' }))
    expect(forming_fight_sword_markers([forming])).toEqual([{ id: '0xarr', position: forming.position }])
  })
  test('an empty/gone fights view projects no markers (the diff layer despawns the rest)', () => {
    expect(forming_fight_sword_markers(new Map())).toEqual([])
    expect(forming_fight_sword_markers(undefined)).toEqual([])
  })
})

// ENGAGE-GROUP GATE (leg ①) — regression fixed 2026-07-19: a cross-account race let a second account attack a
// mob group a live fight had already claimed, because the affordance was not reconciliated against chain state
// first. A mob group a LIVE fight already CLAIMED must be un-attackable client-side, before compose/submit. The
// join key is the served fight's spawn_id (FightCreated carries the claimed (world, spawn_id) — views.js
// shape_fight serves it); to_fight_marker now exposes it so the affordance gates off CHAIN/RPC truth — working
// ACROSS accounts (the alt/other player's fight is a row in visible_fights, never local session state, which the
// attacking account could not have known).
describe('to_fight_marker exposes spawn_id (the group→fight join key)', () => {
  test('served u64-string spawn_id passes through as a string', () => {
    expect(to_fight_marker(served({ spawn_id: '77' })).spawn_id).toBe('77')
  })
  test('a numeric spawn_id is normalized to a string (group rows carry the u64 either way)', () => {
    expect(to_fight_marker(served({ spawn_id: 77 })).spawn_id).toBe('77')
  })
  test('a missing spawn_id (stale twin / protector row) → null, never a false key', () => {
    expect(to_fight_marker(stale()).spawn_id).toBeNull()
  })
})

describe('group_engage_blocked — a group a live fight already claimed is not attackable', () => {
  const live = new Map()
  const add = (over) => {
    const m = to_fight_marker(served(over))
    live.set(m.id, m)
  }
  add({ fight_id: '0xf_a', spawn_id: '77', status: 'placement' }) // another account's FORMING fight on spawn 77
  add({ fight_id: '0xf_b', spawn_id: '88', status: 'active' }) //    …and an ACTIVE one on spawn 88

  test('a group whose spawn_id has a live fight → BLOCKED (both placement and active phases)', () => {
    expect(group_engage_blocked(live, '77')).toBe(true)
    expect(group_engage_blocked(live, '88')).toBe(true)
    expect(group_engage_blocked(live, 77)).toBe(true) // a numeric group-row spawn_id matches the string fight key
  })
  test('a group with no live fight → NOT blocked (the ordinary engageable case)', () => {
    expect(group_engage_blocked(live, '99')).toBe(false)
  })
  test('spawn_id 0 / null / undefined never blocks (0 = the "no spawn" sentinel; a bare 0 never all-passes)', () => {
    expect(group_engage_blocked(live, '0')).toBe(false)
    expect(group_engage_blocked(live, 0)).toBe(false)
    expect(group_engage_blocked(live, null)).toBe(false)
    expect(group_engage_blocked(live, undefined)).toBe(false)
  })
  test('a fight row carrying no spawn_id never blocks anyone (protector / stale-twin safety)', () => {
    expect(group_engage_blocked([to_fight_marker(stale())], '77')).toBe(false)
  })
  test('map / array / empty tolerant (the store Map for leg ① + the fresh get_fights array leg ③ passes)', () => {
    expect(group_engage_blocked([...live.values()], '77')).toBe(true)
    expect(group_engage_blocked(new Map(), '77')).toBe(false)
    expect(group_engage_blocked(undefined, '77')).toBe(false)
  })
  test('raw served rows work too (leg ③ passes get_fights output straight in, not markers)', () => {
    expect(group_engage_blocked([served({ spawn_id: '77' })], '77')).toBe(true)
  })
})
