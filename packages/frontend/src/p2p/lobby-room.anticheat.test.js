// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ANTI-CHEAT WIRING VERIFICATION — a CENSUS of what packages/world/src/presence.js's
// CHEATER-PLAUSIBILITY DROP actually catches on the inbound WebRTC peer-state path, driven through the REAL
// lobby-room.js wiring (the lobby-room mock idiom — trystero mocked, the app's own pos_action/state_action
// .onMessage fired exactly as a received Trystero data message would trigger it). No server exists to
// validate anyone (see presence.js header) — this suite proves what the CLIENT-SIDE self-regulation actually
// does today, greens and gaps both. Six rows: valid movement / teleport /
// bounds-NaN-absurd / malformed schema / spoofed identity mid-session / rapid-fire spam.

import { test, expect } from 'bun:test'

import '../test_helpers/expedition_sdk_mock.js'
import { presence_store } from '../world-shell/presence_adapter.js'
import { reset_trystero_mock, trystero_actions as actions } from '../test_helpers/trystero_mock.js'

const { join_lobby, leave_lobby } = await import('./lobby-room.js')

const fire_pos = (/** @type {any} */ p, /** @type {string} */ peer_id = `peer-${p.id}`) =>
  actions.get('pos').onMessage(p, { peerId: peer_id })
const fire_state = (/** @type {any} */ p, /** @type {string} */ peer_id = `peer-${p.id}`) =>
  actions.get('state').onMessage(p, { peerId: peer_id })
const peer = (/** @type {string} */ id) => presence_store.getState().peers.get(id)

const boot = () => {
  leave_lobby()
  reset_trystero_mock()
  presence_store.getState().input({ type: 'reset' })
  join_lobby('0xMINE', { x: 0, y: 0 })
}

/** Runs `fn` with Date.now() pinned to an advancing fake clock (`advance(ms)` moves it forward) — the ONLY way
 *  to control `now` through the REAL path, since lobby-room's onMessage never passes an explicit `now`
 *  (it always defaults to Date.now() at receipt time — this IS the wiring: proves `now` is receiver-clocked,
 *  never attacker-supplied). Always restores the real Date.now, even on throw. */
const with_fake_clock = (/** @type {(advance: (ms:number) => void) => void} */ fn) => {
  const real_now = Date.now
  let t = 1_000_000
  Date.now = () => t
  try {
    fn((ms) => {
      t += ms
    })
  } finally {
    Date.now = real_now
  }
}

// ─── ROW 1 — valid movement: baseline accepted ───
test('ROW 1 valid movement: a plausible-pace update is accepted', () => {
  with_fake_clock((advance) => {
    boot()
    fire_pos({ id: '0xVALID', x: 0, y: 0 })
    advance(250) // 250ms later — a real throttled tick (client sends on cell-change, ~166ms+ apart)
    fire_pos({ id: '0xVALID', x: 1, y: 0 }) // 1 tile / 0.25s = 4 tiles/s = documented normal roam speed
    expect(peer('0xVALID')?.cell).toMatchObject({ x: 1, y: 0 }) // ACCEPTED
  })
})

// ─── ROW 2 — teleport: dropped ───
test('ROW 2 teleport: an impossible single-jump speed is dropped, cell frozen at last accepted', () => {
  with_fake_clock((advance) => {
    boot()
    fire_pos({ id: '0xTELE', x: 0, y: 0 })
    advance(1000) // 1s later
    fire_pos({ id: '0xTELE', x: 100, y: 0 }) // 100 tiles/s >> 15 cap
    expect(peer('0xTELE')?.cell).toMatchObject({ x: 0, y: 0 }) // DROPPED — frozen
  })
})

// ─── ROW 3 — out-of-bounds / NaN / absurd coordinates ───
test('ROW 3a NaN/Infinity coordinates are dropped (never spawn a peer)', () => {
  boot()
  fire_pos({ id: '0xNAN', x: NaN, y: 0 })
  expect(peer('0xNAN')).toBeUndefined() // DROPPED (Number.isFinite gate in the fold)
  fire_pos({ id: '0xINF', x: Infinity, y: 0 })
  expect(peer('0xINF')).toBeUndefined() // DROPPED
})

test('ROW 3b GAP→FIXED: absurd-but-finite coordinates on a FIRST sighting are dropped (no prior cell to speed-check against, so a sanity bound is the only backstop)', () => {
  boot()
  fire_pos({ id: '0xABSURD', x: 1e9, y: 1e9 })
  expect(peer('0xABSURD')).toBeUndefined() // DROPPED
  fire_pos({ id: '0xABSURD2', x: -1e9, y: 0 })
  expect(peer('0xABSURD2')).toBeUndefined() // DROPPED — negative direction too
  // a coordinate anywhere in the actual designed world (SPEC §4: 500,000×500,000, half=250,000) still spawns.
  fire_pos({ id: '0xFAR_BUT_SANE', x: 240_000, y: -240_000 })
  expect(peer('0xFAR_BUT_SANE')?.cell).toMatchObject({ x: 240_000, y: -240_000 })
})

test('ROW 3c GAP→FIXED: non-finite h/yw (secondary movement fields) never inject NaN/Infinity into position', () => {
  boot()
  fire_pos({ id: '0xHNAN', x: 0, y: 0, h: NaN })
  expect(peer('0xHNAN')?.position.y).toBe(0) // coerced to the documented "unknown" fallback, x/y still accepted
  fire_pos({ id: '0xHINF', x: 0, y: 0, h: Infinity })
  expect(peer('0xHINF')?.position.y).toBe(0)
  fire_pos({ id: '0xYWNAN', x: 0, y: 0, yw: NaN })
  expect(peer('0xYWNAN')?.target_yaw).toBeUndefined() // falls back exactly as an omitted yw would
})

// ─── ROW 4 — malformed schema (extra/missing fields) ───
test('ROW 4a peer_pos: missing id / non-number x-y are dropped at the transport door', () => {
  boot()
  fire_pos({ x: 1, y: 1 }) // no id
  expect(presence_store.getState().peers.size).toBe(0)
  fire_pos({ id: '0xSTR', x: '5', y: '5' }) // numeric STRINGS, not numbers — typeof gate
  expect(peer('0xSTR')).toBeUndefined()
})

test('ROW 4b peer_pos: extra junk fields never pollute the peer entry; missing optional fields default safely', () => {
  boot()
  fire_pos({ id: '0xJUNK', x: 2, y: 3, __proto__: 'x', admin: true, gold: 999999 })
  const p = peer('0xJUNK')
  expect(p?.cell).toMatchObject({ x: 2, y: 3 })
  expect(p).not.toHaveProperty('admin')
  expect(p).not.toHaveProperty('gold')
})

test('ROW 4c peer_state: missing id dropped at the transport door; hostile/malformed fields coerce to safe defaults', () => {
  boot()
  fire_state({ address: '0xnobody' }) // no id
  expect(presence_store.getState().peers.size).toBe(0)
  // `worn` rides the wire from a stale pre-ruling client — COSMETICS TRANSPORT: worn
  // cosmetics resolve from /v1 now, presence never parses this field at all, so it's inert junk like `admin`/
  // `gold` in ROW 4b (never pollutes the peer entry, whatever shape a hostile or outdated sender sends).
  fire_state({ id: '0xCOERCE', address: 12345, color_1: 'not-a-number', worn: 'hostile string' })
  const p = peer('0xCOERCE')
  expect(p?.address).toBe('12345') // String() coercion — never crashes
  expect(p).not.toHaveProperty('worn')
  console.log('ROW 4c verdict: peer_state color_1 from a non-numeric string →', p?.color_1)
})

// ─── ROW 5 — spoofed identity mid-session (census: identity is NOT a fixable class in this lane) ───
test('ROW 5a the SAME webrtc connection can broadcast as two different character_ids (no peerId↔id binding)', () => {
  boot()
  fire_pos({ id: '0xALICE', x: 0, y: 0 }, 'attacker-conn')
  fire_pos({ id: '0xBOB', x: 0, y: 0 }, 'attacker-conn') // SAME peerId, different claimed identity
  expect(peer('0xALICE')).toBeDefined()
  expect(peer('0xBOB')).toBeDefined() // both accepted as distinct peers — census, not asserting a fix
})

test('ROW 5b a DIFFERENT connection can hijack an already-live character_id within speed-check bounds', () => {
  with_fake_clock((advance) => {
    boot()
    fire_pos({ id: '0xVICTIM', x: 0, y: 0 }, 'victim-conn') // the real victim announces
    advance(250)
    // an unrelated connection ('attacker-conn') sends a plausible-pace update AS the victim's character_id
    fire_pos({ id: '0xVICTIM', x: 1, y: 0 }, 'attacker-conn')
    // census verdict below — the fold has zero notion of peerId, only the claimed `id`
    console.log('ROW 5b verdict: cross-connection hijack of 0xVICTIM →', peer('0xVICTIM')?.cell)
  })
})

// ─── ROW 6 — rapid-fire state spam (census: rate handling is NOT teleport/bounds/schema — declare, don't fix) ───
test('ROW 6 many small hops, each within a single receiver tick, chained rapidly — census', () => {
  with_fake_clock((advance) => {
    boot()
    fire_pos({ id: '0xSPAM', x: 0, y: 0 })
    let accepted_hops = 0
    for (let i = 0; i < 50; i++) {
      advance(1) // 1ms real time between hops — far under the speed-check's internal floor
      const x = (i + 1) * 0.7 // each hop individually well under the per-tick cap
      fire_pos({ id: '0xSPAM', x, y: 0 })
      if (peer('0xSPAM')?.cell.x === x) accepted_hops++
    }
    const final = peer('0xSPAM')?.cell
    console.log(
      `ROW 6 verdict: ${accepted_hops}/50 hops accepted · final x=${final?.x} · aggregate distance in 50ms real time`
    )
  })
})
