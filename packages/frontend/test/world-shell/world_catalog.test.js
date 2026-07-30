// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ISSUE #1510 — the world join gate had TWO homes. The travel modal locked cards off `required_level`
// projected from the BUILD-TIME seed receipt while fast travel and the level-up card read the live
// `/v1/encyclopedia?kind=worlds` value. Raise a gate on chain without redeploying the client and the modal
// offered a world fast travel refused: the player read a MoveAbort instead of the honest lock.
//
// world_catalog.js is the one home. This pins its contract — live values, receipt LABEL only, a scoped
// request, and no cached non-answer — plus the structural half: no module may re-derive a chain VALUE off
// the receipt's world projection again (#304's own gate idiom, one directory up).
import { readFileSync } from 'node:fs'

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import * as rpc_client from '../../src/rpc/client'
import { T62_WORLDS } from '../../src/chain/deployment'

const get_encyclopedia = spyOn(rpc_client, 'get_encyclopedia')

const { load_world_catalog, _reset_for_test } = await import('../../src/world-shell/world_catalog.js')

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const live_row = (world_id, over = {}) => ({ world_id, seed: '1', biome: 'ash_steppe', required_level: 10, ...over })

beforeEach(() => {
  _reset_for_test()
  get_encyclopedia.mockReset()
})
afterEach(() => {
  _reset_for_test()
  get_encyclopedia.mockReset()
})
afterAll(() => {
  get_encyclopedia.mockRestore()
})

describe('load_world_catalog — the one home for the join gate', () => {
  test('required_level and biome are the LIVE values; only the label comes from the receipt', async () => {
    const [first] = T62_WORLDS
    get_encyclopedia.mockImplementation(async (kind) => {
      // A SCOPED request (2.9 KB), never the 3.0 MB all-kinds envelope — this is what made a live read
      // affordable on the always-mounted world HUD.
      expect(kind).toBe('worlds')
      return { worlds: [live_row(first.id, { required_level: 42, biome: 'glass_desert' })] }
    })

    expect(await load_world_catalog()).toEqual([
      { id: first.id, seed: '1', label: first.label, biome: 'glass_desert', required_level: 42 },
    ])
  })

  test('a live world the receipt does not label is honestly its own id, never a guessed name', async () => {
    get_encyclopedia.mockImplementation(async () => ({ worlds: [live_row('0xunlabelled')] }))
    const [world] = await load_world_catalog()
    expect(world.label).toBe('0xunlabelled')
  })

  test('the read is made once per session — the world config is static', async () => {
    const [first] = T62_WORLDS
    get_encyclopedia.mockImplementation(async () => ({ worlds: [live_row(first.id)] }))
    await load_world_catalog()
    await load_world_catalog()
    expect(get_encyclopedia).toHaveBeenCalledTimes(1)
  })

  // ABSENCE IS NOT EMPTINESS. A failure THROWS (each consumer owns its degradation — the level-up card omits
  // its row, the engine falls back to its default recipe, the modal says so) and neither a failure nor an
  // empty answer is memoized, so one bad read cannot blank travel for the whole session.
  test('a failed read throws and is never cached', async () => {
    get_encyclopedia.mockImplementation(async () => {
      throw new Error('read API unreachable')
    })
    await expect(load_world_catalog()).rejects.toThrow('read API unreachable')

    const [first] = T62_WORLDS
    get_encyclopedia.mockImplementation(async () => ({ worlds: [live_row(first.id)] }))
    expect(await load_world_catalog()).toHaveLength(1)
  })

  test('an empty answer is not cached either — the next read still asks', async () => {
    get_encyclopedia.mockImplementation(async () => ({ worlds: [] }))
    expect(await load_world_catalog()).toEqual([])

    const [first] = T62_WORLDS
    get_encyclopedia.mockImplementation(async () => ({ worlds: [live_row(first.id)] }))
    expect(await load_world_catalog()).toHaveLength(1)
    expect(get_encyclopedia).toHaveBeenCalledTimes(2)
  })
})

describe('the receipt owns the world ENUMERATION, never a chain-derived value', () => {
  test('T62_WORLDS projects id + label only', () => {
    for (const world of T62_WORLDS) expect(Object.keys(world).sort()).toEqual(['id', 'label'])
  })

  // The structural half of the #1510 gate: `required_level` and `biome` are read from the live view. A module
  // reaching back into the receipt's world projection for either one re-opens the second home.
  test('no consumer reads required_level or biome off the receipt projection', () => {
    expect(source('../../src/chain/deployment.ts')).not.toContain('world.requiredLevel')
    expect(source('../../src/game/screens/hud/world/WorldSwitcher.jsx')).not.toContain('T62_WORLDS')
    expect(source('../../src/world-shell/world_biome.js')).not.toContain('T62_WORLDS')
    expect(source('../../src/world-shell/fast_travel_effects.js')).not.toContain('T62_WORLDS')
  })
})
