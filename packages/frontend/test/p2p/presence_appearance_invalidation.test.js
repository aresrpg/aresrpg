// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2171 — AN EQUIPPED PET MUST APPEAR ON EVERY OTHER SCREEN, WITHOUT THE PAYLOAD EVER CARRYING IT.
//
// Two clients, one process, the REAL modules on every hop: client A's party store publishes through the real
// `publish_room_state` → the real lobby-room send → the trystero double; the captured beat is delivered into
// client B's real `state` handler → the real @aresrpg/world fold → the real `visible_players` projection → the
// real game-core presence bridge → B's real remote-character cache. The only doubles are the transport and
// `/v1` itself.
//
// WHAT IS PROVEN, in the order the design is built:
//  1. LATENCY (the RED gate): A equips, and B resolves the pet within ONE beat + ONE fetch — the clock never
//     moves, so nothing here can be passing on the ~60s cache TTL. On edge this assertion fails: the beat
//     carried no revision, nothing invalidated B's cached row, and the pet stayed absent until the TTL.
//  2. SPOOF-PROOF (the reason the design exists): a beat that LIES — a peer claiming an equipped pet whose
//     `/v1` row has none — renders NOTHING. #553's ruling is untouched: ownership facts come from chain state,
//     and the beat's only power is to make the renderer ask the chain again. A liar buys itself one refetch.
//  3. UNEQUIP mirrors equip: the re-read returns no pet, so the follower's spawn verdict goes false.
//  4. The wire carries NO appearance fact — the published beat is searched for the pet's identity, and the
//     renderer is pinned to read its pet from the cache alone.
//  5. A repeated (heartbeat) beat costs nothing: identical appearance ⇒ no revision change ⇒ no refetch.

import { EventEmitter } from 'events'
import { readFileSync } from 'node:fs'

import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { configure_assets } from '@aresrpg/sdk/jobs'

import { reset_auth_mock } from '../../src/test_helpers/auth_mock.js'
import { deliver, reset_trystero_mock, trystero_sent } from '../../src/test_helpers/trystero_mock.js'

const WORLD = `0x${'b'.repeat(64)}`
const ALICE = '0xALICE' // client A — the player who equips
const BOB = '0xBOB' // client B — the observer

/** A's live roster row: the `/v1` doc shape the local store holds. Mutated by the equip/unequip steps below. */
let alice = { id: ALICE, name: 'Alice', classe: 'senshi', male: true, world_id: 'world-a' }
const EQUIPPED = {
  pet_equipped: true,
  pet: { item_id: '0xitem_pet', template_id: '0xtpl_pet', slug: 'pet_bouloute' },
}

reset_auth_mock({ address: '0xwallet' })
const [{ context }, read_party, lobby_room, core_toast, { use_dungeon }] = await Promise.all([
  import('../../src/game/store.js'),
  import('../../src/chain/read_party'),
  import('../../src/p2p/lobby-room.js'),
  import('../../src/game/core/toast.js'),
  import('../../src/world-shell/dungeon_store.js'),
])

const spies = [
  spyOn(context, 'get_state').mockImplementation(() => ({
    selected_character_id: ALICE,
    sui: { characters: [alice] },
  })),
  spyOn(read_party, 'get_party').mockImplementation(async () => null),
  spyOn(lobby_room, 'set_room_party').mockImplementation(() => {}),
  spyOn(core_toast, 'push_event_toast').mockImplementation(() => {}),
  spyOn(use_dungeon, 'getState').mockImplementation(() => ({ dungeon_id: null })),
  spyOn(use_dungeon, 'subscribe').mockImplementation(() => () => {}),
]

const { join_room, leave_room } = lobby_room
const { presence_store, presence_input } = await import('../../src/world-shell/presence_adapter.js')
const { use_party } = await import('../../src/world-shell/party_store.js')
const { watch_appearance_changes } = await import('../../src/world-shell/presence_appearance.js')
const { visible_players } = await import('@aresrpg/world/presence')
const { default: presence_module } = await import('../../src/game/core/modules/presence.js')
const { create_remote_character_cache } = await import('../../src/game/remote_character_cache.js')
const { resolve_mob_visual_url } = await import('../../src/game/data/mobs.js')
const { set_catalog_for_test: set_mob_catalog_for_test } = await import('../../src/game/data/mob_catalog.js')

// The pet's asset routing — the SAME merge-only registration remote_character_cache.test.js makes.
configure_assets({
  aggregator: 'https://fake-assets',
  classes: { mob: { published: true }, cosmetic: { published: true } },
})
const mob_url = (glb) => resolve_mob_visual_url(new Map(), glb)

const remote_players_source = readFileSync(new URL('../../src/game/remote_players.js', import.meta.url), 'utf8')

// ── client A: publish through the real store + real transport ────────────────────────────────────────────────
/** The last `state` beat client A actually put on the wire. */
const last_beat = () => {
  const sent = trystero_sent.filter((row) => row.name === 'state')
  return sent.length ? sent[sent.length - 1].payload : null
}

// ── client B: the observer's half, wired exactly as remote_players.js's frame loop wires it ──────────────────
/**
 * One observer tick: fold whatever beats have arrived into the game-core bridge, then run the two lines
 * remote_players.js runs per rig — a revision this rig has not applied yet invalidates that peer's cached /v1
 * row, and the same refresh wave re-reads it. `pet_of` is then EXACTLY the value the render branch reads.
 */
function make_observer(fetch_characters, now) {
  const cache = create_remote_character_cache({ fetch_characters, now })
  const bridge = presence_module()
  let state = { observed_peers: new Map() }
  let applied_rev = 0
  return {
    cache,
    entry: () => state.observed_peers.get(ALICE),
    /** @returns {Promise<void>} resolves when the re-read (if any) has landed — one beat + one fetch. */
    tick: () => {
      const rows = visible_players(presence_store.getState()).map((row) => ({ ...row, observed_at: 1 }))
      state = bridge.reduce(state, { type: 'action/presence_snapshot', payload: rows })
      const rev = state.observed_peers.get(ALICE)?.appearance_rev ?? 0
      if (rev !== applied_rev) {
        applied_rev = rev
        cache.invalidate(ALICE)
      }
      return cache.refresh([ALICE])
    },
  }
}

/** Hand one of A's beats to B's REAL receive path (lobby-room's `state` action handler → presence door). */
const receive_at_bob = (beat) => deliver('state', beat, 'peer-alice')

/** Flip the session the singleton presence atom belongs to — the one-process stand-in for a second client. */
const become = (character_id) => {
  presence_input({ type: 'reset' })
  presence_input({ type: 'session', character_id })
}

afterAll(() => {
  leave_room()
  use_party.getState()._stop_polling()
  for (const spy of spies) spy.mockRestore()
  set_mob_catalog_for_test()
  reset_auth_mock()
})

beforeEach(() => {
  reset_auth_mock({ address: '0xwallet' })
  leave_room()
  reset_trystero_mock()
  presence_input({ type: 'reset' })
  alice = { id: ALICE, name: 'Alice', classe: 'senshi', male: true, world_id: 'world-a' }
  set_mob_catalog_for_test({ bouloute: { appearance: 'Lamb', glb: 'hy_lamb' } })
})

describe('#2171 — a presence beat INVALIDATES a peer cache; chain state still answers what renders', () => {
  test("A's equip reaches B within ONE beat + ONE fetch — never the ~60s TTL (the latency gate)", async () => {
    // ── CLIENT A ────────────────────────────────────────────────────────────────────────────────────────────
    join_room(WORLD, ALICE)
    const emitter = new EventEmitter()
    const unwatch = watch_appearance_changes({
      events: emitter,
      character_of: () => alice,
      publish: () => use_party.getState()._publish_state(),
    })
    use_party.getState()._publish_state() // the boot beat: A owns no pet yet
    const boot_beat = last_beat()
    expect(boot_beat?.id).toBe(ALICE)

    alice = { ...alice, ...EQUIPPED } // the equip reconciles into A's roster row…
    emitter.emit('STATE_UPDATED') // …and lands as one state emission
    const equip_beat = last_beat()
    unwatch()
    expect(equip_beat.appearance_rev).not.toBe(boot_beat.appearance_rev) // the revision moved, exactly once
    expect(JSON.stringify(equip_beat)).not.toContain('pet_bouloute') // and it named nothing (#553)

    // ── CLIENT B ────────────────────────────────────────────────────────────────────────────────────────────
    become(BOB)
    let equipped_on_chain = false
    let fetches = 0
    const clock = 1_000 // FROZEN — nothing below can be passing on the TTL
    const bob = make_observer(
      async ({ ids }) => {
        fetches += 1
        return ids.map((id) => ({ id, ...(equipped_on_chain ? EQUIPPED : {}) }))
      },
      () => clock
    )

    receive_at_bob(boot_beat)
    await bob.tick()
    expect(fetches).toBe(1) // a freshly-seen peer resolves on its first wave, as it always did
    expect(bob.cache.pet_of(ALICE)).toEqual({ spawn: false, glb_url: null, key: null })

    // A's equip is now chain truth, and the beat announcing "something of mine changed" arrives.
    equipped_on_chain = true
    receive_at_bob(equip_beat)
    await bob.tick()

    // THE GATE: resolved off /v1, inside the TTL window, one beat after the equip.
    expect(fetches).toBe(2)
    expect(bob.cache.pet_of(ALICE)).toEqual({ spawn: true, glb_url: mob_url('hy_lamb'), key: 'pet_bouloute' })
  })

  test('a LYING beat renders NOTHING — a peer claiming a pet its /v1 row does not carry (the spoof gate)', async () => {
    join_room(WORLD, ALICE)
    use_party.getState()._publish_state()
    const honest_beat = last_beat()

    become(BOB)
    let fetches = 0
    const clock = 1_000
    // /v1 is the truth for this suite's whole life: Alice owns NO pet, ever.
    const bob = make_observer(
      async ({ ids }) => {
        fetches += 1
        return ids.map((id) => ({ id }))
      },
      () => clock
    )

    receive_at_bob(honest_beat)
    await bob.tick()
    expect(bob.cache.pet_of(ALICE)).toEqual({ spawn: false, glb_url: null, key: null })

    // THE LIE: a hostile client appends the very fields the renderer would need — an equipped pet identity —
    // and bumps the revision so the observer definitely looks again.
    receive_at_bob({ ...honest_beat, ...EQUIPPED, appearance_rev: 999 })
    await bob.tick()

    expect(fetches).toBe(2) // the lie bought its sender exactly one refetch…
    expect(bob.cache.pet_of(ALICE)).toEqual({ spawn: false, glb_url: null, key: null }) // …and nothing else
    // The claim did not even survive the fold: the peer table has no home for a peer-declared pet.
    expect(JSON.stringify([...presence_store.getState().peers.values()])).not.toContain('pet_bouloute')
    expect(JSON.stringify(bob.entry())).not.toContain('pet_bouloute')
  })

  test('an unequip mirrors it — the re-read answers "no pet" within the same one beat + one fetch', async () => {
    join_room(WORLD, ALICE)
    const emitter = new EventEmitter()
    alice = { ...alice, ...EQUIPPED }
    const unwatch = watch_appearance_changes({
      events: emitter,
      character_of: () => alice,
      publish: () => use_party.getState()._publish_state(),
    })
    use_party.getState()._publish_state()
    const equipped_beat = last_beat()
    alice = { id: ALICE, name: 'Alice', classe: 'senshi', male: true, world_id: 'world-a' } // unequipped
    emitter.emit('STATE_UPDATED')
    const unequip_beat = last_beat()
    unwatch()
    expect(unequip_beat.appearance_rev).not.toBe(equipped_beat.appearance_rev)

    become(BOB)
    let equipped_on_chain = true
    const clock = 1_000
    const bob = make_observer(
      async ({ ids }) => ids.map((id) => ({ id, ...(equipped_on_chain ? EQUIPPED : {}) })),
      () => clock
    )
    receive_at_bob(equipped_beat)
    await bob.tick()
    expect(bob.cache.pet_of(ALICE).spawn).toBe(true) // the follower is up…

    equipped_on_chain = false
    receive_at_bob(unequip_beat)
    await bob.tick()
    // …and the very next beat resolves it away, so remote_players.js's `else if (r.pet)` branch disposes it.
    expect(bob.cache.pet_of(ALICE)).toEqual({ spawn: false, glb_url: null, key: null })
    expect(remote_players_source).toContain('} else if (r.pet) {')
  })

  test('an unchanged appearance costs nothing — heartbeat re-emits never refetch a peer', async () => {
    join_room(WORLD, ALICE)
    use_party.getState()._publish_state()
    const beat = last_beat()

    become(BOB)
    let fetches = 0
    const clock = 1_000
    const bob = make_observer(
      async ({ ids }) => {
        fetches += 1
        return ids.map((id) => ({ id }))
      },
      () => clock
    )

    receive_at_bob(beat)
    await bob.tick()
    expect(fetches).toBe(1)
    for (let i = 0; i < 5; i++) {
      receive_at_bob(beat) // the transport re-announces the same state on every heartbeat/peer-join replay
      await bob.tick()
    }
    expect(fetches).toBe(1) // same appearance ⇒ same revision ⇒ nothing to re-read
  })

  test('the renderer reads its pet from the /v1 cache alone — the beat decides WHEN to ask, never WHAT to draw', () => {
    // The render branch's input is the cache verdict, not the observed-peer row…
    expect(remote_players_source).toContain('const desired_pet = peer_cache.pet_of(id)')
    // …the revision is used for exactly one thing, next to the refresh wave it makes due…
    expect(remote_players_source).toContain('peer_cache.invalidate(id)')
    expect(remote_players_source).toContain('const rev = render_row_of(state, id)?.appearance_rev ?? 0')
    // …and no appearance fact is ever read off a presence row (`entry` is the observed-peer row in that loop).
    expect(remote_players_source).not.toMatch(/entry\.pet|entry\.worn|entry\.veteran/)
  })
})
