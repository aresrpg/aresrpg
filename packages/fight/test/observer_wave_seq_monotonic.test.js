// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2124 — AN OBSERVING SEAT LOST A PEER'S WHOLE TURN: no combat-log line, no vfx, while the board stayed correct.
//
// Live two-client drive (2026-08-03): the observer folded every mob beat and kept its turn timer right, but a
// partner turn produced ZERO presentation — and it lost the two MOB turns riding the same batch with it, which is
// what rules out any per-kind filter. The rows this suite replays are the REAL journal frames that fight served
// (`fixtures/capsules/observer_2124_peer_turns.journal.json`, captured with its provenance), so it decodes
// captured wire content rather than a model of it.
//
// THE MECHANISM. `wave_seq` is an IDENTITY allocator: each produced wave turn takes `wave_seq + 1 + i`, and the
// renderer's drain (`world-shell/voxel_fight_adapter.js` drain_wave) skips `turn.seq <= last_enqueued_seq` — a
// monotonic high-water mark that exists so a seq it already played can never play twice. Adopting an ahead object
// read (the poll's checkpoint lane, `world-shell/dungeon_fight_sync.js`) REWOUND that allocator to `presented_seq`,
// so the next batch's turns were minted on seq numbers the drain had already consumed — and were dropped in
// silence, with the fold left correct, which is exactly why the bug read as "the log is silent and the pixels are
// silent" and nothing else. Only the OBSERVING seat can hit it: an actor learns its own turn through a receipt
// admitted at commit time, before any object read can get ahead of it.
//
// The rewind bought nothing. `presenting` reads `state.wave` directly (project_state.js), and the same door
// already empties the wave one line above; only the seq collision was real.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'

import capture from './fixtures/capsules/observer_2124_peer_turns.journal.json' with { type: 'json' }

const { fight: FIGHT, observer: OBSERVER, peer: PEER } = capture
const MOB_BATCH = '964090809' // a mob turn the live observer DID present — this suite's positive control
const ADOPTED = '964091521' // the peer's cast commit: the version the object read gets ahead to
const PEER_BATCH = '964091817' // the peer's next turn — it must still present after that adoption
const T0 = 2_000_000

const rows_of = (version) => capture.events.filter((row) => String(row.version) === version)

/** One journal page, byte-shaped exactly as the walker and the SSE adapter both hand it to the door. */
const journal_input = (version) => {
  const rows = rows_of(version)
  return {
    type: 'journal',
    fight_id: FIGHT,
    page: {
      fight: FIGHT,
      events: rows.map((row) => ({
        seq: String(row.seq),
        kind: row.kind,
        data: row.data,
        digest: row.digest,
        version: String(row.version),
      })),
      journal_head: String(rows.at(-1).seq),
    },
  }
}

const participant = (owner, character, cell, hp) => ({
  owner,
  character,
  class: 'warrior',
  team: 0,
  hp,
  max_hp: 50,
  ap: 12,
  mp: 3,
  base_ap: 12,
  base_mp: 3,
  cell,
  ready: true,
  casts_this_turn: 0,
  weapon: null,
})

/**
 * The fight OBJECT as the poll's checkpoint lane reads it — the roster the captured rows name, at `version`.
 * `cell`/`hp` move the peer between reads: a read whose CONTENT is unchanged is refused ('unchanged',
 * core_inbox.js), so a fixed body would let the adoption below quietly become a no-op and the suite would pass
 * while proving nothing.
 */
const fight_object = (version, { cell = 27, hp = 28 } = {}) => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [participant('0xa11ce', OBSERVER, 5, 0), participant('0xb0b', PEER, cell, hp)],
  group_template: '0xmob_t',
  group_base_ap: 6,
  group_base_mp: 3,
  mobs: [
    { template: '0xmob_t', level: 3, hp: 60, max_hp: 60, cell: 46, ap: 6, mp: 3 },
    { template: '0xmob_t', level: 3, hp: 60, max_hp: 60, cell: 66, ap: 6, mp: 3 },
  ],
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [5, 27],
  start_cells_b: [],
  turn_ptr: 1,
  queue: [],
  turn_deadline_ms: T0 + 30_000,
  turn_entropy: T0 + 30_000,
  turn_ordinal: 16,
  placement_deadline_ms: 0,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
  version,
})

/** The OBSERVING seat's client, bootstrapped on the object read preceding the captured rows. */
const observer_store = () => {
  const store = create_fight_store()
  store.getState().input(
    {
      type: 'init',
      fight_id: FIGHT,
      ctx: { my_entity_id: OBSERVER, address: '0xa11ce', beat_ctx: { grid_width: 20 } },
    },
    T0
  )
  store.getState().input({ type: 'snapshot', fight: fight_object(964090808), version: 964090808 }, T0 + 50)
  return store
}

/**
 * The RENDERER's drain, modelled exactly as `world-shell/voxel_fight_adapter.js` drain_wave does it: a turn at or
 * below the high-water mark has already been enqueued once and is skipped. This is the surface the combat log and
 * the vfx lane both hang off — a turn that never crosses it is invisible on every one of them.
 */
const create_renderer = (store) => {
  let last_enqueued_seq = 0
  const rendered = []
  const drain = () => {
    for (const turn of store.getState().wave) {
      if (turn.seq <= last_enqueued_seq) continue
      last_enqueued_seq = turn.seq
      for (const beat of turn.beats)
        rendered.push({ kind: beat.kind, entity_id: beat.payload?.entity_id ?? null, seq: turn.seq })
    }
  }
  store.subscribe(drain)
  drain()
  return { rendered, high_water: () => last_enqueued_seq }
}

describe('#2124 — an adopted object read must not cost the observing seat the NEXT peer turn', () => {
  test('a peer turn still reaches the renderer after an ahead object read adopts mid-wave', () => {
    const store = observer_store()
    const renderer = create_renderer(store)

    // 1 — the mob turns the observer demonstrably DID present: the positive control for the whole pipe.
    store.getState().input(journal_input(MOB_BATCH), T0 + 1_000)
    const control = renderer.high_water()
    expect(control, 'the mob batch must render — otherwise this suite proves nothing').toBeGreaterThan(0)
    expect(renderer.rendered.some((beat) => beat.kind === 'cast')).toBe(true)

    // 2 — the object poll reads AHEAD of the journal (the peer's commit landed; its rows have not arrived yet)
    //     while that mob wave is still unacked. The adoption supersedes the pending presentation — correct, the
    //     base is now the truth. It must not ALSO mint later turns on seqs the renderer has already consumed.
    store.getState().input({ type: 'snapshot', fight: fight_object(Number(ADOPTED), { cell: 26, hp: 26 }), version: Number(ADOPTED) }, T0 + 2_000) // prettier-ignore
    expect(store.getState().core.inbox.base_version, 'the read must actually ADOPT').toBe(Number(ADOPTED))
    expect(store.getState().wave, 'an adopted read supersedes the pending presentation').toEqual([])

    // 3 — the peer's NEXT turn arrives on the journal, the only transport an observing seat has for it.
    store.getState().input(journal_input(PEER_BATCH), T0 + 3_000)

    const peer_turn = renderer.rendered.filter((beat) => beat.seq > control && beat.entity_id === PEER)
    expect(peer_turn.map((beat) => beat.kind), "the peer's turn must reach the renderer — a silent log AND silent pixels was #2124").toContain('move') // prettier-ignore
    // …and the mob turns riding the SAME batch must not vanish with it (the live drive lost all three at once).
    const mobs = renderer.rendered.filter(
      (beat) => beat.seq > control && beat.kind === 'move' && String(beat.entity_id).startsWith('mob-')
    )
    expect(mobs, 'the mob turns sharing the peer batch present with it').toHaveLength(2)

    // 4 — THE LAW underneath: `wave_seq` is an identity allocator, so a turn minted after the adoption can never
    //     land on a seq the renderer has already consumed.
    expect(store.getState().wave_seq, 'wave_seq never rewinds').toBeGreaterThan(control)
  })

  test('wave_seq is monotonic across every object-read adoption', () => {
    const store = observer_store()
    store.getState().input(journal_input(MOB_BATCH), T0 + 1_000)
    const before = store.getState().wave_seq
    expect(before).toBeGreaterThan(0)
    store.getState().input({ type: 'snapshot', fight: fight_object(Number(ADOPTED), { cell: 26, hp: 26 }), version: Number(ADOPTED) }, T0 + 2_000) // prettier-ignore
    expect(store.getState().wave_seq).toBe(before)
    expect(store.getState().core.inbox.base_version, 'the read must actually ADOPT').toBe(Number(ADOPTED))
    expect(store.getState().wave, 'the adoption still supersedes what was pending').toEqual([])
  })
})
