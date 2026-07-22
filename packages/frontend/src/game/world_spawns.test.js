// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Route-away regression: the projected GROUP / LV / +XP mob card layer is appended to <body>, outside the
// persistent world host. Pausing the world on a fullscreen meta route must hide that layer synchronously,
// and returning to `/` must wait for one fresh projection frame before exposing it again.

import { readFileSync } from 'node:fs'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import { _reset_log_for_test, get_log_buffer } from '../core/log.js'
import { SENSHI_MALE_GLB_AVAILABLE } from '../test_helpers/glb_fixture.js'

const world_spawns_source = readFileSync(new URL('./world_spawns.js', import.meta.url), 'utf8')
const dungeon_actions_source = readFileSync(new URL('../world-shell/dungeon_actions.js', import.meta.url), 'utf8')

const saved_globals = new Map()
const remember = (key) => saved_globals.set(key, globalThis[key])
const restore = (key) => {
  const value = saved_globals.get(key)
  if (value === undefined) delete globalThis[key]
  else globalThis[key] = value
}

const fake_target = () => {
  const listeners = new Map()
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(listener)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) ?? []) listener(event)
      return true
    },
  }
}

const fake_element = () => ({
  style: {},
  dataset: {},
  childElementCount: 0,
  append() {},
  appendChild() {
    this.childElementCount += 1
  },
  querySelector: () => null,
  remove() {},
})

let create_world_spawns
let layers
let frames
let next_frame

beforeAll(async () => {
  for (const key of ['window', 'location', 'document', 'navigator']) remember(key)
  const import_window = {
    ...fake_target(),
    location: { href: 'http://localhost/', origin: 'http://localhost', search: '' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  }
  globalThis.window = import_window
  globalThis.location = import_window.location
  globalThis.document = {}
  globalThis.navigator = {}
  try {
    // MISSING-ARTIFACT (#117): world_spawns.js imports spawn_rigs.js, which imports create_mob_model from
    // @aresrpg/engine3/player (character_controller.js) — unconditionally re-exporting create_character_avatar,
    // which static-imports the absent-by-design senshi_male.glb (test_helpers/glb_fixture.js; full chain in
    // packages/engine/src/test_helpers/glb_fixture.js). Caught here (not left to crash beforeAll) so the two
    // source-shape tests below — which only grep world_spawns_source, no import needed — keep running for real.
    if (SENSHI_MALE_GLB_AVAILABLE) ({ create_world_spawns } = await import('./world_spawns.js'))
  } finally {
    for (const key of ['window', 'location', 'document', 'navigator']) restore(key)
  }
})

beforeEach(() => {
  for (const key of [
    'window',
    'location',
    'document',
    'fetch',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'setInterval',
    'clearInterval',
  ])
    remember(key)

  layers = []
  frames = new Map()
  next_frame = 1
  const window_ = {
    ...fake_target(),
    innerWidth: 1280,
    innerHeight: 720,
    location: { href: 'http://localhost/', origin: 'http://localhost', search: '' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  }
  globalThis.window = window_
  globalThis.location = window_.location
  globalThis.document = {
    hidden: true,
    pointerLockElement: null,
    body: { appendChild: (element) => layers.push(element) },
    createElement: fake_element,
    querySelector: () => null,
    getElementsByTagName: () => [],
  }
  globalThis.fetch = async () => new Response('{}', { status: 200 })
  globalThis.requestAnimationFrame = (callback) => {
    const id = next_frame++
    frames.set(id, callback)
    return id
  }
  globalThis.cancelAnimationFrame = (id) => frames.delete(id)
  globalThis.setInterval = () => 1
  globalThis.clearInterval = () => {}
})

afterEach(() => {
  for (const key of [
    'window',
    'location',
    'document',
    'fetch',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'setInterval',
    'clearInterval',
  ])
    restore(key)
})

afterAll(() => saved_globals.clear())

describe('world spawn mob-card layer route gate', () => {
  test('prepares the owned party before a group fight snapshots its on-chain party gate', () => {
    const prepare_at = world_spawns_source.indexOf(
      'const owned_party_ready = await use_party.getState().ensure_owned_party()'
    )
    const refuse_at = world_spawns_source.indexOf('if (!owned_party_ready)', prepare_at)
    const party_at = world_spawns_source.indexOf(
      'const party_id = is_public ? null : use_party.getState().party_id',
      refuse_at
    )
    const create_at = world_spawns_source.indexOf('return create_world_fight', party_at)

    expect(prepare_at).toBeGreaterThan(-1)
    expect(refuse_at).toBeGreaterThan(prepare_at)
    expect(party_at).toBeGreaterThan(refuse_at)
    expect(create_at).toBeGreaterThan(party_at)
  })

  test('a PUBLIC fight skips the owned-party pre-form — the discarded-tx guard wraps the ensure call', () => {
    // engage() is an un-exported closure, so this seam is locked by source shape; the driven tx-count proof of the
    // is_public gating lives in world_fight_party_public.test.js (enter_world_fight). A PUBLIC fight discards the
    // party id at the party_id line, so pre-forming an owned party here is a wasted on-chain create tx.
    const guard_at = world_spawns_source.indexOf('if (!request.payload.is_public)')
    const prepare_at = world_spawns_source.indexOf(
      'const owned_party_ready = await use_party.getState().ensure_owned_party()'
    )
    expect(guard_at).toBeGreaterThan(-1) // the guard exists
    expect(guard_at).toBeLessThan(prepare_at) // …and precedes (wraps) the ensure_owned_party call
  })

  test('the world lane routes submission and presentation through the ordering seam', () => {
    const feedback_at = world_spawns_source.indexOf(
      "const submitted = as_one_toast(i18n.t('fights.action_engage'), () =>"
    )
    const seam_at = world_spawns_source.indexOf('start_fight_engage({', feedback_at)
    const submit_at = world_spawns_source.indexOf('submit: async () => {', seam_at)
    const create_at = world_spawns_source.indexOf('return create_world_fight', submit_at)
    const present_at = world_spawns_source.indexOf('present: () => {', create_at)
    const swing_at = world_spawns_source.indexOf("context.events.emit('fight_entry/engage'", present_at)
    const receipt_at = world_spawns_source.indexOf('const { fight_id } = await submitted', swing_at)

    expect(feedback_at, 'intent feedback wraps the full preflight/compose/submit task').toBeGreaterThan(-1)
    expect(seam_at).toBeGreaterThan(feedback_at)
    expect(submit_at).toBeGreaterThan(seam_at)
    expect(create_at).toBeGreaterThan(submit_at)
    expect(present_at).toBeGreaterThan(create_at)
    expect(swing_at).toBeGreaterThan(present_at)
    expect(receipt_at).toBeGreaterThan(swing_at)
  })

  test('the aggregate engage toast paints before it invokes the preflight task', () => {
    const aggregate_at = dungeon_actions_source.indexOf('export async function as_one_toast')
    const aggregate_end = dungeon_actions_source.indexOf('// TOAST COPY LAW', aggregate_at)
    const aggregate_body = dungeon_actions_source.slice(aggregate_at, aggregate_end)

    expect(aggregate_at).toBeGreaterThan(-1)
    expect(aggregate_body).toContain('.promise(fn, {')
    expect(aggregate_body).not.toContain('.promise(fn(), {')
  })

  test.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('a non-world screen hides the body layer until a fresh world frame', () => {
    const canvas = { ...fake_target(), getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) }
    const controls = create_world_spawns({
      engine: { sample_block: () => 0, get_camera: () => null },
      canvas,
      get_player_pos: () => [0, 0, 0],
    })
    const layer = layers.at(-1)
    expect(layer).toBeDefined()

    const active_pathname = '/marketplace'
    controls.set_paused(active_pathname !== '/')
    expect(layer.style.display, 'the body-appended mob tooltip must hide off the world route').toBe('none')

    controls.set_hidden(false)
    expect(layer.style.display, 'another visibility release cannot revive it on a meta page').toBe('none')

    controls.set_paused(false)
    expect(layer.style.display, 'route return waits for a fresh projection, never stale pixels').toBe('none')
    const fresh_frame = [...frames.values()].at(-1)
    fresh_frame(performance.now())
    expect(layer.style.display).toBe('')

    controls.dispose()
  })

  test.skipIf(!SENSHI_MALE_GLB_AVAILABLE)(
    'the once-a-minute telemetry line goes through the house debug gate, never a raw console line',
    () => {
    // Regression ("annoying logs"): the [world-spawns] telemetry line used to be a bare console.info,
    // printing on EVERY player's console for the whole session regardless of debug state. game_log (core/log.js)
    // is the ONE house gate — console output only under DEV/`?debug=1`/localStorage.ares_debug — while still
    // ring-buffering the line so a crash report keeps the breadcrumb even when the console stayed silent.
    _reset_log_for_test()
    const info_spy = mock(() => undefined)
    const original_info = console.info
    console.info = info_spy
    const canvas = { ...fake_target(), getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) }
    const controls = create_world_spawns({
      engine: { sample_block: () => 0, get_camera: () => null },
      canvas,
      get_player_pos: () => [0, 0, 0],
    })
    try {
      const first_frame = [...frames.values()].at(-1)
      first_frame(70000) // > TELEMETRY_MS (60000) on the very first frame — the throttle fires immediately
    } finally {
      controls.dispose()
      console.info = original_info
    }
    // debug is off in this headless test env (no window/DEV/?debug=1/localStorage) — the house gate stays silent.
    expect(info_spy, 'telemetry must never reach a real player console without a debug flag').not.toHaveBeenCalled()
    // …but the line was still emitted — captured for crash-report breadcrumbs, not silently dropped.
    const entry = get_log_buffer().find((e) => e.ns === 'world-spawns')
    expect(entry?.message).toMatch(/^telemetry: groups=\d+\/32 rigs=\d+ nodes=\d+\/48 heap=\S+ entries=\d+$/)
  })

  test.skipIf(!SENSHI_MALE_GLB_AVAILABLE)(
    'leg ① — a group a live fight already claimed is refused LOCALLY before any claim_intent/compose/submit',
    () => {
    // Regression (2026-07-19): a second account was able to attack a group the first account had already
    // attacked — the attack failed on-chain, but it should have been refused locally before submit. The engage-group gate reads CHAIN/RPC truth
    // (visible_fights → group_engage_blocked), NEVER local session state — so the alt account (which knew nothing
    // of account 1's fight) is caught. engage() is an un-exported closure, so this seam is locked by source shape
    // (the file's own convention): the refuse must PRECEDE claim_intent (the optimistic hide + tx_request) AND
    // create_world_fight, else a doomed gas-burning tx composes.
    const helper_at = world_spawns_source.indexOf('group_engage_blocked(context.get_state().visible_fights')
    const gate_at = world_spawns_source.indexOf('if (group_has_live_fight(e)) {')
    const claim_intent_at = world_spawns_source.indexOf("spawns_input({ type: 'claim_intent'", gate_at)
    const create_at = world_spawns_source.indexOf('return create_world_fight', gate_at)
    expect(helper_at, 'the decision reads rpc truth (visible_fights), not session state').toBeGreaterThan(-1)
    expect(gate_at, 'engage() carries the local refuse gate').toBeGreaterThan(-1)
    expect(claim_intent_at, 'the refuse precedes the optimistic claim_intent').toBeGreaterThan(gate_at)
    expect(create_at, 'the refuse precedes the compose+submit (create_world_fight)').toBeGreaterThan(gate_at)
  })
})
