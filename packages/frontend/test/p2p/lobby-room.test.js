// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// RELAY POINTING — the one thing the 2026-07-27 fight stall proved we must never get wrong. Public relays
// rate-limited us; the cure was running our own, so this suite pins that the transport dials OUR relay and
// nothing else. Two independent teeth, because either alone can lie:
//   1. the dialled config equals exactly [RELAY_URL] — a fallback list would fail this;
//   2. the strategy's own baked-in PUBLIC broker defaults never reach a joinRoom config. trystero only honours
//      `relayConfig.urls` (#854: `relayUrls`/`relayRedundancy` are silently ignored, which is how five public
//      relays kept being dialled while the code "configured" ours), so a rename regression reopens exactly
//      that hole and this test is what notices.

import { afterEach, beforeEach, expect, test } from 'bun:test'

// bun's module registry is process-global: a second `mock.module('@trystero-p2p/mqtt')` factory here would
// race the shared one and lose (or win) depending on file order — the exact trap `test_helpers/env_mock.js`
// documents. So this suite drives the ONE shared transport mock and reads the configs it records.
import { reset_trystero_mock, trystero_room_configs as room_configs } from '../../src/test_helpers/trystero_mock.js'

// The published default list of the mqtt strategy — the exact hosts that must NEVER be dialled.
const PUBLIC_BROKER_DEFAULTS = [
  'wss://test.mosquitto.org:8081/mqtt',
  'wss://broker.emqx.io:8084/mqtt',
  'wss://public:public@public.cloud.shiftr.io',
  'wss://broker-cn.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
]

// Deliberately NOT `import { RELAY_URL } from '../../src/env'`: `test_helpers/env_mock.js` replaces that
// module process-wide for other suites, so whether the transport captured the real value or the mocked one
// depends on which file bun evaluated first. Asserting against a live import made this suite pass alone and
// fail in the full run. The SHIPPED default is a literal in the source, and source bytes cannot be mocked —
// so the "is it ours" tooth reads the file, and the config teeth below assert shape, not a captured value.
const RELAY_DEFAULT = /relay\.aresrpg\.world\/mqtt/
const env_source = await Bun.file(`${import.meta.dir}/../../src/env.ts`).text()

const { join_lobby, leave_lobby, sync_party_room } = await import('../../src/p2p/lobby-room.js')

beforeEach(() => {
  leave_lobby()
  reset_trystero_mock()
})

afterEach(() => {
  leave_lobby()
  sync_party_room(null)
  reset_trystero_mock()
})

test('one signaling room carries lobby and party actions over the shared direct peer channel', () => {
  join_lobby('0xcharacter', { x: 0, y: 0 })
  sync_party_room('0xparty')

  expect(room_configs).toHaveLength(1)
})

test('the transport dials exactly one relay, through the option trystero actually reads', () => {
  join_lobby('0xcharacter', { x: 0, y: 0 })

  const [config] = room_configs
  expect(Object.keys(config.relayConfig)).toEqual(['urls']) // no redundancy, no second knob — one relay, no list
  expect(config.relayConfig.urls).toHaveLength(1)
  // #854 — the option names trystero SILENTLY IGNORES. A regression to these is invisible at runtime and
  // restores the strategy's public broker defaults, which is the failure this whole restoration exists to end.
  expect(config.relayUrls).toBeUndefined()
  expect(config.relayRedundancy).toBeUndefined()
})

test('no public broker is reachable from the dialled configuration', () => {
  join_lobby('0xcharacter', { x: 0, y: 0 })

  const dialled = room_configs.flatMap((config) => config.relayConfig?.urls ?? [])
  expect(dialled).not.toHaveLength(0) // a config that dials nothing would pass the check below vacuously
  for (const url of dialled) expect(PUBLIC_BROKER_DEFAULTS).not.toContain(url)
})

test('the relay the built client defaults to is OURS — read off the shipped source, not a mockable import', () => {
  const [, production_default] = env_source.match(/RELAY_URL = derive_rpc_url\([\s\S]*?:\s*'([^']+)'/) ?? []
  expect(production_default).toMatch(RELAY_DEFAULT)
  for (const host of PUBLIC_BROKER_DEFAULTS) expect(env_source).not.toContain(host)
})

test('ICE offers a STUN server and, with no TURN configured, no credentialed third party', () => {
  join_lobby('0xcharacter', { x: 0, y: 0 })

  const [{ rtcConfig }] = room_configs
  const [stun] = rtcConfig.iceServers
  expect(rtcConfig.iceServers).toHaveLength(1) // STUN only — TURN credential minting does not exist yet
  expect(stun.urls[0]).toStartWith('stun:')
  expect(rtcConfig.iceServers.some((server) => server.credential)).toBe(false)
})

// The third tooth lives in the mechanical gate, not here: `scripts/check-constraints.sh`'s
// rendezvous-host gate scans every shipped source for the public relays/brokers/STUN hosts we have
// ever dialled. A test that re-scanned the tree would be a second home for the same law — and a
// slower one — so this suite proves the CONFIG and the gate proves the SOURCE.
