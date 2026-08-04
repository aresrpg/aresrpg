// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ROW #2158 RED — "fast travel takes seconds to start on a tx-free hop", against D51 (no interaction over 1s).
//
// The measurement is DRIVEN through the real path, not a model of it: the shipped read plan
// (`read_route_facts`) calling the shipped `get_characters`/`load_world_catalog` over the shipped rpc client and
// its ONE world-poll scheduler. Only two things are simulated, and both are simulated honestly:
//   • the network — a fixed RTT per request (RTT_MS), so the number this test prints is queue + serialization,
//     never bandwidth noise;
//   • the clock — virtual timers, so the scheduler's own WORLD_POLL_STAGGER_MS cadence is exact and the verdict
//     is deterministic (a DoD that flakes is theater).
// The click is staged the way a player's click actually lands: in a live world, where the recurring /v1 polls
// have already started their kinds and a few of them are sitting in the scheduler's FIFO.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { _reset_rpc_client_for_test, get_characters, rpc_get } from '../../src/rpc/client'
import { WORLD_POLL_STAGGER_MS } from '../../src/rpc/world_poll_scheduler'
import { _reset_for_test as reset_world_catalog, load_world_catalog } from '../../src/world-shell/world_catalog.js'
import { read_route_facts } from '../../src/world-shell/fast_travel_target.js'
import { create_mount_glb_cache } from '../../src/game/mount_glb_cache.js'
import {
  FT_MEASURE_NAMES,
  finish_fast_travel_timing,
  mark_ft_model_ready,
  mark_ft_route_resolved,
  start_fast_travel_timing,
} from '../../src/core/fast_travel_timing.js'

const RTT_MS = 120 // one /v1 round trip against the read API — the honest floor a click cannot go below
const ME = '0xme'
const TARGET = '0xtarget'
const WORLD = 'w1'
const D51_BUDGET_MS = 1000 // no interaction over 1s
const WARM_BUDGET_MS = 300 // the tx-free hop's warm bar (#2158)

const real_set_timeout = globalThis.setTimeout
const real_clear_timeout = globalThis.clearTimeout
const real_fetch = globalThis.fetch
const real_date_now = Date.now

// ── virtual clock ──────────────────────────────────────────────────────────────────────────────────────────
let now = 1_000_000
let next_id = 0
/** @type {Map<number, { at:number, fn:Function }>} */
let timers = new Map()

const install_clock = () => {
  now = 1_000_000
  next_id = 0
  timers = new Map()
  Date.now = () => now
  globalThis.setTimeout = /** @type {any} */ (
    (fn, delay) => {
      const id = ++next_id
      timers.set(id, { at: now + Number(delay ?? 0), fn })
      return id
    }
  )
  globalThis.clearTimeout = /** @type {any} */ ((id) => timers.delete(id))
}

/** Yield the real macrotask queue so in-flight promise chains (including Response.json) settle. */
const settle = () => new Promise((resolve) => real_set_timeout(resolve, 0))

const earliest = () =>
  [...timers.entries()].reduce((best, entry) => (!best || entry[1].at < best[1].at ? entry : best), null)

/** Run `work` on the virtual clock and report how many virtual milliseconds the player waited. */
async function measure(work) {
  const started_at = now
  let done = false
  const promise = work().then(
    (value) => {
      done = true
      return value
    },
    (error) => {
      done = true
      throw error
    }
  )
  void promise.catch(() => undefined)
  for (let guard = 0; guard < 5000 && !done; guard += 1) {
    await settle()
    if (done) break
    const due = earliest()
    if (!due) break // nothing pending and nothing settled — a deadlock, surfaced by the assertion below
    const [id, timer] = due
    timers.delete(id)
    now = Math.max(now, timer.at)
    timer.fn()
  }
  return { value: await promise, elapsed_ms: now - started_at }
}

// ── the read API, at a fixed round trip ────────────────────────────────────────────────────────────────────
let requests = []

const body_for = (url) => {
  const { pathname, searchParams } = new URL(url)
  if (pathname === '/v1/characters') {
    const owner = searchParams.get('owner')
    const ids = (searchParams.get('ids') ?? '').split(',').filter(Boolean)
    const doc = (id) => ({ id, owner: '0xowner', world: WORLD, level: 40, position: { x: 12, z: 34 } })
    return { characters: owner ? [doc(TARGET)] : ids.map(doc) }
  }
  if (pathname === '/v1/encyclopedia') return { worlds: [{ world_id: WORLD, seed: 's', required_level: 1 }] }
  return { zones: [], parties: [], fights: [] }
}

const install_fetch = () => {
  requests = []
  globalThis.fetch = /** @type {any} */ (
    async (url) => {
      requests.push(String(url))
      await new Promise((resolve) => setTimeout(resolve, RTT_MS)) // virtual RTT
      return new Response(JSON.stringify(body_for(String(url))), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
  )
}

/** A live world: the recurring polls have started their kinds, and a few sit in the FIFO when the player clicks. */
async function stage_live_world() {
  await measure(() =>
    Promise.all([
      rpc_get('/v1/zones', { world: WORLD, x: 0, z: 0 }),
      rpc_get('/v1/parties', { address: '0xowner' }),
      rpc_get('/v1/fights', { world: WORLD }),
      get_characters({ ids: ['0xwarm'] }),
    ])
  )
  now += 60_000 // the polls' next tick — nothing of this warm-up is left in the client's 3s cache
  void rpc_get('/v1/zones', { world: WORLD, x: 1, z: 0 })
  void rpc_get('/v1/parties', { address: '0xowner' })
  void rpc_get('/v1/fights', { world: WORLD })
}

const click_fast_travel = () =>
  read_route_facts({
    target: { character_id: TARGET, address: null, live: false },
    traveler_id: ME,
    deps: { read_characters: get_characters, read_worlds: load_world_catalog, peer_pos_of: () => null },
  })

beforeEach(() => {
  install_clock()
  install_fetch()
  _reset_rpc_client_for_test()
  reset_world_catalog()
})

afterEach(() => {
  globalThis.setTimeout = real_set_timeout
  globalThis.clearTimeout = real_clear_timeout
  globalThis.fetch = real_fetch
  Date.now = real_date_now
  _reset_rpc_client_for_test()
  reset_world_catalog()
})

describe('#2158 — the click→flight read plan under D51', () => {
  test('a same-world travel click resolves its route inside the warm bar', async () => {
    await stage_live_world()
    const { value, elapsed_ms } = await measure(click_fast_travel)

    expect(value.ok).toBe(true)
    expect(value.facts.world_id).toBe(WORLD)
    // The dominant leg is the read plan's SHAPE: serialized /v1 reads queue behind the background poll FIFO,
    // each one paying its own WORLD_POLL_STAGGER_MS slot. Parallel + interactive, the whole plan is one RTT.
    expect(elapsed_ms).toBeLessThanOrEqual(WARM_BUDGET_MS)
    expect(elapsed_ms).toBeLessThan(D51_BUDGET_MS)
    expect(elapsed_ms).toBeLessThan(WORLD_POLL_STAGGER_MS)
  })

  test('the route reads leave together — no character read waits on another', async () => {
    await stage_live_world()
    const starts = []
    const timed_read = (query, signal, fresh) => {
      starts.push(now)
      return get_characters(query, signal, fresh)
    }
    await measure(() =>
      read_route_facts({
        target: { character_id: TARGET, address: null, live: false },
        traveler_id: ME,
        deps: { read_characters: timed_read, read_worlds: load_world_catalog, peer_pos_of: () => null },
      })
    )
    expect(starts.length).toBe(2) // the target's document and the traveler's own
    expect(starts[1] - starts[0]).toBe(0) // issued on the same tick, never one-after-the-other
  })
})

describe('#2158 — the warm dragon costs the click nothing', () => {
  const GLB_LOAD_MS = 900 // a cold fetch+parse of the ~1.15MB dragon
  const URL_KEY = 'https://cdn.test/mob/ln.glb'

  const staged_cache = () => {
    let loads = 0
    const cache = create_mount_glb_cache(async () => {
      loads += 1
      await new Promise((resolve) => setTimeout(resolve, GLB_LOAD_MS))
      return { scene: {} }
    })
    return { cache, loads: () => loads }
  }

  test('POSITIVE CONTROL — an unwarmed cache makes the click pay the whole GLB', async () => {
    const { cache, loads } = staged_cache()
    const { elapsed_ms } = await measure(() => cache.for_spawn(URL_KEY))
    expect(elapsed_ms).toBe(GLB_LOAD_MS)
    expect(loads()).toBe(1)
  })

  test('preloaded at world-HUD boot, the click-time spawn is pure assembly', async () => {
    const { cache, loads } = staged_cache()
    await measure(() => cache.preload(URL_KEY)) // world-HUD boot warms the one flight mount
    const { elapsed_ms } = await measure(() => cache.for_spawn(URL_KEY, { warm_only: true }))
    expect(elapsed_ms).toBe(0) // zero model-fetch wait inside the click
    expect(loads()).toBe(1) // and no second fetch — the click never touches the network for the model
  })

  test('the trace reports the model leg at zero when the preload did its job', async () => {
    Date.now = real_date_now // the User Timing clock is performance.now, not the virtual one
    start_fast_travel_timing(ME)
    mark_ft_route_resolved(ME)
    mark_ft_model_ready(ME)
    const durations = finish_fast_travel_timing(ME)

    expect(Object.keys(durations)).toEqual(Object.keys(FT_MEASURE_NAMES))
    expect(durations.model_wait).toBeLessThan(5)
    expect(durations.total).not.toBeNull()
  })

  test('a follower catching up can neither start nor finish the player s trace', async () => {
    Date.now = real_date_now
    start_fast_travel_timing(ME)
    mark_ft_route_resolved('0xfollower')
    mark_ft_model_ready('0xfollower')
    expect(finish_fast_travel_timing('0xfollower')).toBeNull()
    expect(finish_fast_travel_timing(ME)).not.toBeNull()
  })
})
