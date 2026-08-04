// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2209 — ONE MOB TURN IS ONE PRESENTATION SLOT, whatever the wire did to it.
//
// The indexer's fight stream sends ONE SSE frame per stored event (`packages/rpc/indexer/src/stream.rs`
// pump_fight — no batching, by contract), so a mob turn that the chain emitted as one transaction reaches this
// client as five separate deliveries. Presentation prices per wave turn (`present.js` MOB_TURN_MS), so a door
// that mints a turn per DELIVERY buys three 3s slots for one mob turn — nine seconds of wave for three seconds
// of fight — and the orphaned `Hit` loses its caster (it lands in a batch with no Cast to attribute it to).
//
// The property pinned here is CONVERGENCE, and it is stated as an equality rather than a shape: the same five
// rows delivered as five live frames and as one journal page must produce the BYTE-IDENTICAL wave. That single
// assertion is blind to none of it — slot count, slot duration, beat set, beat timing and caster attribution
// are all inside it — which is exactly what the deleted `fight_sse_adapter.test.js` check ("a mob turn split
// across frames presents as ONE 3s slot, never one per row") guarded and what its stated replacement
// (`live_journal_cursor_2162.test.js`, a `visible_shape` flatMap) is structurally unable to see.

import { expect, test } from 'bun:test'

import { MOB_TURN_MS } from '../src/present.js'
import { create_fight_store } from '../src/store.js'
import { open_fight_stream } from '../../frontend/src/world-shell/fight_sse_adapter.js'

const FIGHT = '0xc0a1'
const ME = '0xchar_me'
const T0 = 2_000_000
const BASE_VERSION = 2
const TURN_VERSION = 3
const FIRST_SEQ = 10

// The solo board the deleted check used: one seat, one mob, and the mob turn the chain cranks in ONE transaction.
const solo_fight_object = () => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xme',
      character: ME,
      class: 'warrior',
      team: 0,
      hp: 50,
      max_hp: 50,
      ap: 12,
      mp: 3,
      base_ap: 12,
      base_mp: 3,
      cell: 21,
      ready: true,
      casts_this_turn: 0,
      weapon: null,
    },
  ],
  group_template: '0xmob_t',
  group_base_ap: 6,
  group_base_mp: 3,
  mobs: [{ template: '0xmob_t', level: 3, hp: 20, max_hp: 20, cell: 45, ap: 6, mp: 3 }],
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [21],
  start_cells_b: [],
  turn_ptr: 0,
  queue: [],
  turn_deadline_ms: T0 + 30_000,
  turn_entropy: T0 + 30_000,
  turn_ordinal: 1,
  placement_deadline_ms: 0,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
})

// ONE mob turn, exactly as the chain emits it: the turn markers bracket the mob's move, its cast and the hit.
const MOB_TURN_ROWS = [
  ['TurnStarted', { is_mob: true, idx: 0 }],
  ['MobMoved', { idx: 0, to_cell: 44 }],
  ['Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 21 }],
  ['Hit', { victim_is_mob: false, victim_idx: 0, amount: 6, remaining_hp: 44, caster_is_mob: true, caster_idx: 0 }],
  ['TurnEnded', { is_mob: true, idx: 0 }],
].map(([kind, data], index) => ({
  fight_id: FIGHT,
  seq: String(FIRST_SEQ + index),
  kind,
  data: { fight: FIGHT, ...data },
  digest: '0xcrank',
  version: String(TURN_VERSION),
}))

const seated_store = () => {
  const store = create_fight_store()
  store
    .getState()
    .input(
      { type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ME, address: '0xme', beat_ctx: { grid_width: 20 } } },
      T0
    )
  store.getState().input({ type: 'snapshot', fight: solo_fight_object(), version: BASE_VERSION }, T0 + 50)
  return store
}

const fake_source = () => {
  const listeners = new Map()
  return {
    readyState: 1,
    addEventListener: (kind, listener) => listeners.set(kind, listener),
    emit: (row) => listeners.get('fight')?.({ data: JSON.stringify(row), lastEventId: `${row.version}:${row.seq}` }),
    close: () => {},
  }
}

/** The LIVE delivery: the real SSE adapter, one frame per stored event — the wire the indexer actually speaks. */
const live_wave = () => {
  const store = seated_store()
  const source = fake_source()
  const close = open_fight_stream({
    fight_id: FIGHT,
    input: (message) => store.getState().input(message, T0 + 500),
    event_source_factory: () => source,
    base_url: 'https://rpc.test',
    install_deadline_belt: false,
    set_timeout: (fn) => ({ fn }),
    clear_timeout: () => {},
  })
  for (const row of MOB_TURN_ROWS) source.emit(row)
  close()
  return store.getState()
}

/** The CONTROL delivery: the same five rows as ONE journal page — the walker's own wire, nothing fragmented. */
const page_wave = () => {
  const store = seated_store()
  store.getState().input(
    {
      type: 'journal',
      fight_id: FIGHT,
      batch: {
        fight_id: FIGHT,
        source: 'journal',
        head: MOB_TURN_ROWS.at(-1).seq,
        events: MOB_TURN_ROWS,
      },
    },
    T0 + 500
  )
  return store.getState()
}

const wave_ms = (wave) => wave.reduce((total, turn) => total + turn.duration, 0)

test('#2209 one mob turn split across five SSE frames is ONE presentation slot', () => {
  const { wave } = live_wave()

  expect(wave.length, 'one mob turn is one wave turn — one slot per DELIVERY is the #2209 regression').toBe(1)
  expect(wave[0].duration).toBe(MOB_TURN_MS)
  expect(wave_ms(wave), 'a three-second mob turn may never cost the eye more than one slot').toBe(MOB_TURN_MS)
  expect(wave[0].source_id, 'the slot belongs to the mob that took the turn').toBe('mob-0')
  expect(wave[0].version).toBe(TURN_VERSION)
})

test('#2209 the orphaned Hit keeps its caster', () => {
  const { wave } = live_wave()
  const damage = wave.flatMap((turn) => turn.beats.filter((beat) => beat.kind === 'damage').map((beat) => turn))

  expect(damage.length, 'the mob hit me exactly once').toBe(1)
  expect(damage[0].source_id, "a Hit delivered alone must not be attributed to 'fight' — its caster is on the row").toBe('mob-0') // prettier-ignore
})

test('#2209 a bracket the wire never closes still presents — a new version flushes it', () => {
  const store = seated_store()
  const source = fake_source()
  const close = open_fight_stream({
    fight_id: FIGHT,
    input: (message) => store.getState().input(message, T0 + 500),
    event_source_factory: () => source,
    base_url: 'https://rpc.test',
    install_deadline_belt: false,
    set_timeout: (fn) => ({ fn }),
    clear_timeout: () => {},
  })
  // The stream dies after the Hit: the turn's own `TurnEnded` never arrives, so the bracket stays open.
  for (const row of MOB_TURN_ROWS.slice(0, 4)) source.emit(row)
  expect(store.getState().wave, 'an open bracket holds its rows').toEqual([])

  // …and the NEXT transaction proves it can never grow. Nothing may be stranded: a wave that never drains is a
  // fight the player can never act in again (`presenting` gates every input off this same list).
  source.emit({ ...MOB_TURN_ROWS[0], seq: '20', version: String(TURN_VERSION + 1) })
  close()

  const { wave } = store.getState()
  expect(wave.length, 'the stranded turn paces as one slot the moment a newer version lands').toBe(1)
  expect(wave[0].version).toBe(TURN_VERSION)
  expect(wave[0].beats.map((beat) => beat.kind)).toEqual(['turn_start', 'move', 'arrival', 'cast', 'damage'])
})

test('#2209 both deliveries of one turn converge: five live frames ≡ one journal page', () => {
  const live = live_wave()
  const page = page_wave()

  // THE SEAL. Nothing downstream may be able to tell the two deliveries apart — slot count, slot duration, beat
  // set, per-beat timing, entry windows and caster attribution are all inside this one equality.
  expect(live.wave, 'the transport may not change what the eye is shown').toEqual(page.wave)
  expect(live.core.inbox.presented_version, 'every live row still crosses admission before any beat exists').toBe(
    TURN_VERSION
  )
  expect(page.core.inbox.presented_version).toBe(TURN_VERSION)
})
