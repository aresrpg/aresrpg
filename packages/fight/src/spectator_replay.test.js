// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SPECTATOR REPLAY PACING — ① other players' actions render instantly, using the same sequences a local
// turn uses, and ② a peer killing a mob must show during the replay, never delayed to the next turn.
// A peer's committed turn reaches this client ONLY through the poll's
// wholesale Fight OBJECT (the snapshot door) — no events, so the old adoption jumped state instantly (peers teleport,
// their kill lands a turn late when the next wholesale read rewrites the board). This suite drives the REAL store:
// a genuinely-newer snapshot revealing OTHER fighters' committed moves/casts/kills must REPLAY those changes through
// the SAME paced beat pipeline (wave_turns_of) the local player + mobs use — never an instant wholesale jump — and
// the wholesale view adopts only AFTER the replay drains.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from './store.js'
import { engine_view, presenting } from './project.js'
import { MOB_TURN_MS } from './present.js'

const FIGHT = '0xc00p'
const ALICE = '0xchar_alice'
const BOB = '0xchar_bob'
const T0 = 3_000_000

const participant = (owner, character, cell, over = {}) => ({
  owner,
  character,
  class: 'warrior',
  team: 0,
  hp: 50,
  max_hp: 50,
  ap: 12,
  mp: 3,
  base_ap: 12,
  base_mp: 3,
  cell,
  ready: true,
  casts_this_turn: 0,
  weapon: null,
  ...over,
})

const fight_object = ({ seats, mob = {} }) => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: seats,
  group_template: '0xmob_t',
  group_base_ap: 6,
  group_base_mp: 3,
  mobs: [{ template: '0xmob_t', level: 3, hp: 20, max_hp: 20, cell: 45, ap: 6, mp: 3, ...mob }],
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [21, 22],
  start_cells_b: [],
  turn_ptr: 0,
  queue: [],
  turn_deadline_ms: T0 + 30_000,
  placement_deadline_ms: 0,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
})

/** ALICE's client (seat p0). BOB is her coop peer (seat p1) — his turns are non-local for her. */
const alice_store = () => {
  const store = create_fight_store()
  store
    .getState()
    .input(
      { type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ALICE, address: '0xa11ce', beat_ctx: { grid_width: 20 } } },
      T0
    )
  // room opens with both seats + a mob, adopted as the FIRST snapshot (a seed, never a replay).
  store.getState().input(
    {
      type: 'snapshot',
      fight: fight_object({ seats: [participant('0xa11ce', ALICE, 21), participant('0xb0b', BOB, 22)] }),
      version: 1,
    },
    T0 + 10
  )
  return store
}

const wave_of = (store) => store.getState().wave
const beat_kinds = (turn) => turn.beats.map((b) => b.kind)

// M2b · ONE INGRESS (#291): snapshot-diff spectator replay (foreign_replay_*) is DELETED. A peer's committed
// turn now arrives as JOURNAL events (fold correctness proven in one_ingress.test.js); its PACED presentation is
// the peer lane's, entering through the same accept door. Re-enable when the peer lane lands its journal pacing.
describe.skip('spectator replay — a peer’s committed turn paces through the SAME beat pipeline', () => {
  // ① VECTOR A — a peer's committed CAST arrives only as a wholesale object read; it must REPLAY as paced beats
  // (walk + cast + damage floater), never an instant state jump.
  test('a peer move+cast revealed by a snapshot paces as a non-local replay wave (not instant)', () => {
    const alice = alice_store()
    expect(presenting(alice.getState())).toBe(false) // quiescent after the seed

    // BOB commits his turn on-chain; ALICE only learns via the next poll's wholesale OBJECT read: bob walked
    // 22→42 and cast the mob (hp 20→12). The snapshot carries the RESULT, no events.
    const after_bob = fight_object({
      seats: [participant('0xa11ce', ALICE, 21), participant('0xb0b', BOB, 42)],
      mob: { hp: 12 },
    })
    alice.getState().input({ type: 'snapshot', fight: after_bob, version: 2 }, T0 + 3_000)

    // GREEN: bob's turn REPLAYS as a paced non-local wave carrying the walk + cast + damage-floater sequence.
    expect(presenting(alice.getState()), 'a peer turn must pace a replay wave, never adopt instantly').toBe(true)
    const bob_turn = wave_of(alice).find((t) => !t.is_local && String(t.source_id) === BOB)
    expect(bob_turn, 'bob’s committed turn must produce a non-local paced turn').toBeTruthy()
    expect(bob_turn.duration).toBe(MOB_TURN_MS) // the SAME 3s slot a mob/peer turn gets
    const kinds = beat_kinds(bob_turn)
    expect(kinds).toContain('move') // the walk
    expect(kinds).toContain('cast') // the cast animation
    expect(kinds).toContain('damage') // the damage floater
    // GREEN: the wholesale board truth is DEFERRED behind the replay (the eye never jumps ahead of the beats).
    expect(alice.getState().view_version, 'the wholesale adopt waits for the replay to drain').toBe(1)
    expect(alice.getState().pending_snapshot?.version).toBe(2)
  })

  // ② VECTOR B — a peer's KILL must present its death beat INSIDE that turn's replay, not a turn late.
  test('a peer kill revealed by a snapshot presents the mob’s death beat DURING the paced replay', () => {
    const alice = create_fight_store()
    alice.getState().input(
      {
        type: 'init',
        fight_id: FIGHT,
        ctx: { my_entity_id: ALICE, address: '0xa11ce', beat_ctx: { grid_width: 20 } },
      },
      T0
    )
    alice.getState().input(
      {
        type: 'snapshot',
        fight: fight_object({
          seats: [participant('0xa11ce', ALICE, 21), participant('0xb0b', BOB, 22)],
          mob: { hp: 8 },
        }),
        version: 1,
      },
      T0 + 10
    )

    // BOB walks up (22→44) and lands the killing blow (mob hp 8→0) — revealed to ALICE only as the wholesale read.
    const after_kill = fight_object({
      seats: [participant('0xa11ce', ALICE, 21), participant('0xb0b', BOB, 44)],
      mob: { hp: 0 },
    })
    alice.getState().input({ type: 'snapshot', fight: after_kill, version: 2 }, T0 + 3_000)

    // GREEN: the kill rides a killing DAMAGE beat inside bob's paced replay turn (#170 5th recurrence: no
    // 'death'-kind beat anymore — the presenter derives the death visual from the presented-state edge).
    const bob_turn = wave_of(alice).find((t) => !t.is_local && String(t.source_id) === BOB)
    expect(bob_turn, 'the killing turn must replay as a paced non-local turn').toBeTruthy()
    const death = bob_turn.beats.find((b) => b.kind === 'damage' && b.payload?.killed)
    expect(death, 'the mob’s death must present DURING the replay, not a turn late').toBeTruthy()
    expect(String(death.payload.target_id)).toBe('mob-0')

    // GREEN: while the replay drains the mob is still shown ALIVE (death_hold) — it despawns when the beat presents.
    const mob_alive = engine_view(alice.getState()).fighters.get('mob-0')
    expect(mob_alive.dead, 'the mob holds alive through its death beat').toBe(false)
    // …and the wholesale board truth is deferred until the replay drains.
    expect(alice.getState().view_version).toBe(1)

    // Draining the replay adopts the wholesale read — the mob is now committed dead.
    const last = wave_of(alice)[wave_of(alice).length - 1]
    alice.getState().input({ type: 'presented', seq: last.seq }, T0 + 3_000 + MOB_TURN_MS)
    expect(alice.getState().view_version).toBe(2)
    expect(alice.getState().pending_snapshot).toBeNull()
    expect(engine_view(alice.getState()).fighters.get('mob-0').dead).toBe(true)
  })

  // A snapshot that changes NOTHING a spectator would see (my own seat only / status only) still adopts wholesale —
  // no spurious replay wave, no needless deferral.
  test('a snapshot with no foreign move/damage adopts wholesale (no replay wave)', () => {
    const alice = alice_store()
    // only MY seat moved (my own action — predicted locally, never spectator-paced) + nothing else changed.
    const mine = fight_object({ seats: [participant('0xa11ce', ALICE, 23), participant('0xb0b', BOB, 22)] })
    alice.getState().input({ type: 'snapshot', fight: mine, version: 2 }, T0 + 3_000)
    expect(presenting(alice.getState())).toBe(false)
    expect(alice.getState().view_version).toBe(2)
    expect(alice.getState().pending_snapshot).toBeNull()
  })

  // A re-delivered (duplicate) snapshot at the already-adopted version must NOT replay a second time.
  test('re-delivered snapshot does not double-replay', () => {
    const alice = alice_store()
    const after_bob = fight_object({
      seats: [participant('0xa11ce', ALICE, 21), participant('0xb0b', BOB, 42)],
      mob: { hp: 12 },
    })
    alice.getState().input({ type: 'snapshot', fight: after_bob, version: 2 }, T0 + 3_000)
    const last = wave_of(alice)[wave_of(alice).length - 1]
    alice.getState().input({ type: 'presented', seq: last.seq }, T0 + 3_000 + MOB_TURN_MS)
    expect(alice.getState().view_version).toBe(2)
    // the SAME object read arrives again (reconnect / poll catch-up): committed == snapshot ⇒ no new wave.
    alice.getState().input({ type: 'snapshot', fight: after_bob, version: 2 }, T0 + 7_000)
    expect(presenting(alice.getState())).toBe(false)
    expect(wave_of(alice).filter((t) => !t.is_local)).toHaveLength(0)
  })
})
