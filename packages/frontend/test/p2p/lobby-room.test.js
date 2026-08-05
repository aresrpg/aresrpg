// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE TRANSPORT GATE (#1698) — lane 2 of docs/REALTIME.md, driven headless through the real module.
//
// Each suite below is one surface of the restoration, red-first:
//   1. THE ROOM IS THE WORLD — presence is room membership, pointed at OUR relay and nobody else's.
//   2. ONE DOOR — every received action folds through `presence_input`; nothing writes the store directly.
//   3. FRESHNESS — a stationary peer stays alive because the transport re-emits on the core's heartbeat
//      cadence; a genuinely silent one folds out on `tick`. Both constants have ONE home:
//      packages/world/src/presence.js (PEER_HEARTBEAT_MS / PEER_EXPIRY_MS).
//   4. CHAT round-trips through the room.
//   5. SAD PATHS — an unreachable relay says so on the atom the chip renders, and a recovery rebuilds the room.

import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test'
import { PEER_EXPIRY_MS, PEER_HEARTBEAT_MS, REJOIN_MAX_ATTEMPTS } from '@aresrpg/world/presence'

import { _reset_log_for_test, get_log_buffer } from '../../src/core/log.js'
// A first sighting makes the presence edge REQUEST a chain identity. This suite is about the transport, so the
// resolve answers offline — armed per-test because the helper's registration is process-wide (see its header).
import '../../src/test_helpers/expedition_sdk_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'
import {
  deliver,
  reset_trystero_mock,
  resolve_trystero_relay_connect,
  trystero_actions,
  trystero_relay_calls,
  trystero_relay_socket,
  trystero_room_configs,
  trystero_rooms,
  trystero_sent,
} from '../../src/test_helpers/trystero_mock.js'

// The mocks above must be REGISTERED before the transport binds `@trystero-p2p/*`: ESM links a static import
// graph before any of it evaluates, so the module under test is pulled in dynamically, after this line.
const { presence_store } = await import('../../src/world-shell/presence_adapter.js')
const {
  join_room,
  leave_room,
  publish_room_chat,
  publish_room_party_chat,
  publish_room_position,
  publish_room_state,
  set_room_party,
} = await import('../../src/p2p/lobby-room.js')

const WORLD = `0x${'a'.repeat(64)}`
const ME = `0x${'1'.repeat(64)}`
const PEER = `0x${'2'.repeat(64)}`

const state = () => presence_store.getState()
const sent = (name) => trystero_sent.filter((row) => row.name === name)
/** The live room (the last one built) — suites drive its peer lifecycle exactly as trystero would. */
const live_room = () => trystero_rooms[trystero_rooms.length - 1]

// THE WATCHDOGS, DRIVEN. The transport arms its heartbeat and health poll with the platform timers; capturing
// those two globals before the join hands the suite the real callbacks, so the self-heal is exercised as
// written (no test-only export, no seven-second idle) and the clock moves with setSystemTime.
const timers = { intervals: [], timeouts: [] }
const real = { setInterval: globalThis.setInterval, setTimeout: globalThis.setTimeout }
const fake_handle = () => ({ unref: () => {} })
function capture_timers() {
  timers.intervals = []
  timers.timeouts = []
  globalThis.setInterval = (fn, ms) => {
    timers.intervals.push({ fn, ms })
    return fake_handle()
  }
  globalThis.setTimeout = (fn, ms) => {
    timers.timeouts.push({ fn, ms })
    return fake_handle()
  }
}
const restore_timers = () => Object.assign(globalThis, real)

// The browser signals the transport listens to (`online`, `visibilitychange`) do not exist in a headless run,
// so the suite supplies the smallest real event host that the production registration path can bind to — the
// recovery is then driven exactly as a laptop waking up drives it.
function make_event_host(extra = {}) {
  const listeners = new Map()
  return {
    ...extra,
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type, fn) =>
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((listener) => listener !== fn)
      ),
    emit: (type) => (listeners.get(type) ?? []).forEach((fn) => fn()),
  }
}
const install_browser_signals = () => {
  globalThis.window = make_event_host()
  globalThis.document = make_event_host({ hidden: false })
}
const remove_browser_signals = () => {
  delete globalThis.window
  delete globalThis.document
}
/** Run the health/expiry poll exactly as its interval would. */
const poll = () => timers.intervals.find((t) => t.ms === LINK_HEALTH_POLL_MS)?.fn()
/** Run the pose re-emit exactly as its interval would. */
const heartbeat = () => timers.intervals.find((t) => t.ms === PEER_HEARTBEAT_MS)?.fn()
const LINK_HEALTH_POLL_MS = 3_000
const GRACE_MS = 8_000

/** Fire the pending rejoin and let its async teardown → rebuild settle, exactly as the scheduler would. */
const run_pending_rejoin = async () => {
  timers.timeouts.pop()?.fn()
  await Bun.sleep(0)
}

/** Drive a dead relay through the WHOLE finite budget. Each rebuilt room earns a fresh connect grace, so the
 *  clock advances past it before every judgement — the retries are bounded in attempts, not in patience. */
async function spend_the_retry_budget() {
  for (let attempt = 0; attempt <= REJOIN_MAX_ATTEMPTS; attempt += 1) {
    setSystemTime(new Date(Date.now() + GRACE_MS + 1))
    poll()
    await run_pending_rejoin()
  }
}

beforeEach(() => {
  set_expedition_sdk_mock(() => Promise.reject(new Error('no SDK session in a headless transport suite')))
  leave_room() // an earlier suite may have left a room mounted on this module singleton
  reset_trystero_mock()
  capture_timers()
  install_browser_signals()
  join_room(WORLD, ME, { x: 0, y: 0 })
})
afterEach(() => {
  leave_room()
  restore_timers()
  remove_browser_signals()
  setSystemTime()
  reset_expedition_sdk_mock()
})

describe('the room IS the world — joining is the announcement', () => {
  it('keys the trystero room by world id, so a peer in my room is in my world by construction', () => {
    expect(trystero_room_configs).toHaveLength(1)
    expect(trystero_room_configs[0].room_id).toBe(WORLD)
  })

  it('dials ONE relay, ours, passed explicitly so the strategy never falls back to its public defaults', () => {
    const [{ config }] = trystero_room_configs
    // `relayConfig.urls` present ⇒ @trystero-p2p/core's getRelays returns it verbatim and the baked-in public
    // broker list is never consulted. One entry, no fallback: redundancy is pods behind the host, not a
    // fanout of strangers (and the field would be inert here anyway).
    expect(config.relayConfig.urls).toHaveLength(1)
    expect(config.relayConfig.urls[0]).toMatch(/^wss?:\/\//)
    expect(config.relayConfig.redundancy).toBeUndefined()
  })

  it('ships STUN-only ICE while nothing mints a TURN credential — never a fake username', () => {
    const { iceServers } = trystero_room_configs[0].config.rtcConfig
    expect(iceServers.length).toBeGreaterThanOrEqual(1)
    for (const server of iceServers) {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
      expect(urls.length).toBeGreaterThanOrEqual(1)
      for (const url of urls) expect(url).toStartWith('stun:')
    }
    // A credential nothing can mint would just fail at connect time — the absence is the honest state.
    expect(JSON.stringify(iceServers)).not.toContain('username')
    expect(JSON.stringify(iceServers)).not.toContain('credential')
  })

  // The room's action set is CLOSED, and this is the assertion that keeps it that way: a new action is a new
  // thing the ephemeral lane carries, and it must be argued for. `fstream` is the fight-turn PRESENTATION
  // overlay and nothing else — it carries no truth and folds nothing (proven in test/p2p/room-courtesy.test.js);
  // fight journals stay on chain→indexer→SSE, which is why no action here ever carries one.
  it('carries exactly five actions — and none of them is a fight journal', () => {
    expect([...trystero_actions.keys()].sort()).toEqual(['chat', 'fstream', 'pchat', 'pos', 'state'])
  })

  it('is idempotent for the same world+identity, and re-rooms on a world change', () => {
    join_room(WORLD, ME)
    expect(trystero_room_configs).toHaveLength(1)
    const other_world = `0x${'b'.repeat(64)}`
    join_room(other_world, ME)
    expect(trystero_room_configs).toHaveLength(2)
    expect(trystero_room_configs[1].room_id).toBe(other_world)
  })

  it('refuses to open a room for a session that names no world, rather than inventing a global one', () => {
    leave_room()
    reset_trystero_mock()
    join_room(null, ME)
    expect(trystero_room_configs).toHaveLength(0)
  })
})

describe('one door — received actions fold through presence_input, never into a store', () => {
  it('folds a peer pose into the ONE roster', () => {
    deliver('pos', { id: PEER, x: 12, y: 34, h: 64, yw: 1.5 })
    expect(state().peers.get(PEER)?.position).toMatchObject({ x: 12, z: 34, y: 64 })
  })

  it('folds a peer state (identity + party + declared mount) into the same row', () => {
    deliver('pos', { id: PEER, x: 1, y: 1 })
    deliver('state', { id: PEER, address: '0xalice', classe: 'senshi', party_id: '0xparty', mounted: true })
    expect(state().peers.get(PEER)).toMatchObject({ address: '0xalice', classe: 'senshi', mounted: true })
  })

  it('drops my own echo instead of rendering a ghost of myself', () => {
    deliver('pos', { id: ME, x: 99, y: 99 })
    expect(state().peers.has(ME)).toBe(false)
  })

  it('removes a peer that leaves the room — membership IS presence', () => {
    deliver('pos', { id: PEER, x: 1, y: 1 }, 'peer-socket-9')
    expect(state().peers.has(PEER)).toBe(true)
    live_room().disconnectPeer('peer-socket-9')
    expect(state().peers.has(PEER)).toBe(false)
  })

  it('replays my cell + state directly to a peer whose channel just opened (two stationary tabs see each other)', () => {
    publish_room_state({ address: '0xme', color_1: 1, color_2: 2, color_3: 3 })
    trystero_sent.length = 0
    live_room().connectPeer('peer-socket-2')
    expect(sent('pos').at(-1)).toMatchObject({ payload: { id: ME }, options: { target: 'peer-socket-2' } })
    expect(sent('state').at(-1)).toMatchObject({
      payload: { id: ME, address: '0xme' },
      options: { target: 'peer-socket-2' },
    })
  })
})

describe('freshness — the heartbeat is why a standing player stays visible', () => {
  it('re-emits my last cell on the core cadence, so a peer who never moves is still provably alive', () => {
    // THE FELT BUG. Under the courier a pose went out only on an actual cell change, so a player standing
    // still lapsed out of the server's TTL rows and vanished from every later joiner — "that person is in a
    // realm you can't reach" about someone standing in the same field. The cure is this re-emit.
    publish_room_position(ME, 5, 6)
    trystero_sent.length = 0
    heartbeat()
    expect(sent('pos').at(-1).payload).toMatchObject({ id: ME, x: 5, y: 6 })
    // It must out-pace the expiry it defends against, or the defence is theatre.
    expect(PEER_HEARTBEAT_MS).toBeLessThan(PEER_EXPIRY_MS)
  })

  it('re-emits nothing while spectating — a silent listener stays silent', () => {
    leave_room()
    reset_trystero_mock()
    capture_timers()
    join_room(WORLD, null)
    heartbeat()
    expect(sent('pos')).toHaveLength(0)
  })

  it('expires a peer silent past PEER_EXPIRY_MS on the next tick, and keeps one inside it', () => {
    const t0 = Date.now()
    state().input({ type: 'peer_pos', id: PEER, x: 1, y: 1 }, t0)
    state().input({ type: 'tick' }, t0 + PEER_EXPIRY_MS - 1)
    expect(state().peers.has(PEER)).toBe(true)
    state().input({ type: 'tick' }, t0 + PEER_EXPIRY_MS + 1)
    expect(state().peers.has(PEER)).toBe(false)
  })

  it('sizes the expiry above the background-tab throttle floor, not off the heartbeat cadence (#305)', () => {
    // A hidden tab's timers are clamped to ~1/min by the browser, so a live-but-backgrounded peer sends on a
    // >60s gap. An expiry sized off the 7s cadence would evict it every time.
    expect(PEER_EXPIRY_MS).toBeGreaterThan(60_000)
  })
})

describe('#2255 — rejected presence beats leave one rate-limited breadcrumb', () => {
  it('a rejected position beat answers false and leaves a trace without spamming one per beat', async () => {
    _reset_log_for_test()
    trystero_actions.get('pos').send = () => Promise.reject(new Error('position channel rejected'))

    expect(await publish_room_position(ME, 5, 6)).toBe(false)
    expect(await publish_room_position(ME, 6, 7)).toBe(false)

    const breadcrumbs = get_log_buffer().filter(
      ({ ns, message }) => ns === 'p2p' && message.includes('position send failed')
    )
    expect(breadcrumbs).toHaveLength(1)
    expect(breadcrumbs[0].message).toContain('position channel rejected')
  })

  it('a rejected state beat answers false and leaves a trace without spamming one per beat', async () => {
    _reset_log_for_test()
    trystero_actions.get('state').send = () => Promise.reject(new Error('state channel rejected'))

    expect(await publish_room_state({ address: '0xme', color_1: 1, color_2: 2, color_3: 3 })).toBe(false)
    expect(await publish_room_state({ address: '0xme', color_1: 4, color_2: 5, color_3: 6 })).toBe(false)

    const breadcrumbs = get_log_buffer().filter(
      ({ ns, message }) => ns === 'p2p' && message.includes('state send failed')
    )
    expect(breadcrumbs).toHaveLength(1)
    expect(breadcrumbs[0].message).toContain('state channel rejected')
  })
})

describe('chat round-trips through the room', () => {
  it('sends a world line on the shared channel and folds a received one through the presence door', () => {
    publish_room_chat(ME, 'Me', 'hello world', 'CHAT_GENERAL')
    expect(sent('chat').at(-1).payload).toMatchObject({ id: ME, message: 'hello world', channel: 'CHAT_GENERAL' })
    deliver('chat', { id: PEER, name: 'Alice', message: 'hi back', channel: 'CHAT_GENERAL' })
    expect(state().chat?.row).toMatchObject({ id: PEER, message: 'hi back' })
  })

  it('routes party chat on the SAME room — a party is a filter, never a second room', () => {
    set_room_party('0xparty')
    publish_room_party_chat(ME, 'Me', 'party only', 'CHAT_GROUP')
    expect(trystero_room_configs).toHaveLength(1)
    expect(sent('pchat').at(-1).payload).toMatchObject({ party_id: '0xparty', message: 'party only' })
  })

  it('drops a party line addressed to a party I am not in', () => {
    set_room_party('0xmine')
    const before = state().chat_seq
    deliver('pchat', { party_id: '0xtheirs', id: PEER, message: 'not for me', channel: 'CHAT_GROUP' })
    expect(state().chat_seq).toBe(before)
    deliver('pchat', { party_id: '0xmine', id: PEER, message: 'for me', channel: 'CHAT_GROUP' })
    expect(state().chat?.row.message).toBe('for me')
  })

  it('stays silent while solo rather than leaking a party line to the whole world', () => {
    set_room_party(null)
    publish_room_party_chat(ME, 'Me', 'nobody', 'CHAT_GROUP')
    expect(sent('pchat')).toHaveLength(0)
  })
})

describe('sad paths — an outage is stated, never silently idled', () => {
  it('reports the link as connected the moment a peer channel opens', () => {
    live_room().connectPeer('peer-socket-3')
    expect(state().link_status).toBe('connected')
  })

  it('never leaves the chip on a frozen "idle" while the link is actually being established', () => {
    // The #1641 lie: `link_status` with no writer read "idle" against a live link. Joining MUST move it.
    expect(state().link_status).not.toBe('idle')
  })

  it('holds its judgement inside the connect grace — fresh sockets are still shaking hands', () => {
    trystero_relay_socket.readyState = 3
    poll()
    expect(state().link_status).toBe('connecting')
  })

  it('reload with a healthy broker clears connecting when the MQTT connect resolves', () => {
    leave_room()
    reset_trystero_mock()
    capture_timers()
    trystero_relay_socket.readyState = 0 // a refreshed document starts while MQTT awaits CONNACK
    join_room(WORLD, ME, { x: 0, y: 0 })
    expect(state().link_status).toBe('connecting')

    resolve_trystero_relay_connect()
    setSystemTime(new Date(Date.now() + GRACE_MS + 1))
    poll()
    expect(live_room().getPeers()).toEqual({})
    expect(state().link_status).toBe('connected')
  })

  it('a late MQTT CONNACK clears the failure state on the next health observation', () => {
    trystero_relay_socket.readyState = 3
    setSystemTime(new Date(Date.now() + GRACE_MS + 1))
    poll()
    expect(state().link_status).toBe('reconnecting')

    resolve_trystero_relay_connect()
    poll()
    expect(state().link_status).toBe('connected')
  })

  it('holds its judgement inside the fresh-room grace rather than flashing degraded mid-handshake', () => {
    poll()
    expect(live_room().getPeers()).toEqual({})
    expect(state().link_status).not.toBe('degraded')
  })

  it('does not mistake the last peer leaving for relay failure', () => {
    setSystemTime(new Date(Date.now() + GRACE_MS + 1))
    poll()
    expect(state().link_status).toBe('connected')
    live_room().connectPeer('peer-socket-9')
    expect(state().link_status).toBe('connected')
    live_room().disconnectPeer('peer-socket-9')
    poll()
    expect(state().link_status).toBe('connected')
  })

  it('says DOWN loudly when our relay is unreachable — and gives up with a REASON, not a forever spinner', async () => {
    trystero_relay_socket.readyState = 3 // the broker is gone, and no direct channel exists to carry us
    await spend_the_retry_budget()
    expect(state().link_status).toBe('failed')
    // A dead chip must carry its reason: the player reads an outage, not a three-word mood.
    expect(state().link_error).toContain('relay')
    expect(trystero_relay_calls.pause).toBe(1) // and we stop hammering a broker that is not there
  })

  it('emits one structured ares-error when the watchdog marks the relay failed', async () => {
    const console_errors = []
    const original_console_error = console.error
    console.error = (...args) => console_errors.push(args)
    try {
      trystero_relay_socket.readyState = 3
      await spend_the_retry_budget()
    } finally {
      console.error = original_console_error
    }

    const watchdog_errors = console_errors.filter(
      ([prefix, , , , context]) => prefix === '[ares-error]' && context?.action === 'lobby_room_watchdog'
    )
    expect(watchdog_errors).toHaveLength(1)
    expect(watchdog_errors[0][1]).toBeInstanceOf(Error)
    expect(watchdog_errors[0][1].message).toContain('relay')
    expect(watchdog_errors[0][4]).toMatchObject({
      area: 'p2p',
      action: 'lobby_room_watchdog',
      world: WORLD,
    })
  })

  it("recovers on the browser's own online signal — a rejoin re-derives the room, no refresh", async () => {
    trystero_relay_socket.readyState = 3
    await spend_the_retry_budget()
    expect(state().link_status).toBe('failed')

    trystero_relay_socket.readyState = 1 // the broker is back
    const rooms_before = trystero_room_configs.length
    globalThis.window.emit('online')
    expect(state().link_status).toBe('connecting')
    await Bun.sleep(0) // the rejoin awaits the old room's teardown before rebuilding
    expect(trystero_room_configs.length).toBe(rooms_before + 1)
    expect(trystero_room_configs.at(-1).room_id).toBe(WORLD) // the SAME world, re-derived
    expect(trystero_relay_calls.resume).toBeGreaterThan(1)
  })

  it('keeps the game channel alive when the relay drops mid-session — the relay only introduces us', () => {
    live_room().connectPeer('peer-socket-7')
    trystero_relay_socket.readyState = 3
    setSystemTime(new Date(Date.now() + GRACE_MS + 1))
    poll()
    expect(state().link_status).toBe('connected')
  })
})

// #1815 — THE SEND'S OWN VERDICT. A line the transport never carried used to vanish into `.catch(() => {})`
// while the composition edge echoed it as delivered, so the sender read their own words in an empty room. The
// publishers now answer with DATA (never a throw), and chat_send.js turns a `false` into honest copy.
describe('#1815 — a send that carried nobody answers false, never silence', () => {
  it('refuses when there is no room at all — the line reached nobody and says so', async () => {
    leave_room() // the beforeEach joined; tear it down so no action exists to carry the line
    expect(await publish_room_chat(ME, 'Alice', 'anyone there?', 'CHAT_GENERAL')).toBe(false)
    expect(sent('chat')).toHaveLength(0)
  })

  it('a joined room carries the line and answers true', async () => {
    expect(await publish_room_chat(ME, 'Alice', 'hello world', 'CHAT_GENERAL')).toBe(true)
    expect(sent('chat')).toHaveLength(1)
    expect(sent('chat')[0].payload).toMatchObject({ id: ME, message: 'hello world' })
  })

  it('a PARTY line sent while solo is a refusal, not a silent no-op', async () => {
    set_room_party(null)
    expect(await publish_room_party_chat(ME, 'Alice', 'regroup', 'CHAT_GROUP')).toBe(false)
    expect(sent('pchat')).toHaveLength(0)
  })

  it('a party line inside a party carries and answers true', async () => {
    set_room_party(`0x${'d'.repeat(64)}`)
    expect(await publish_room_party_chat(ME, 'Alice', 'regroup', 'CHAT_GROUP')).toBe(true)
    expect(sent('pchat')).toHaveLength(1)
    set_room_party(null)
  })
})
