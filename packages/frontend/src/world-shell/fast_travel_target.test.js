// FAST-TRAVEL TARGET resolution — proves the pure `resolve_route`: /v1 world truth (never p2p), the anchor-vs-
// live coordinate rule, and the raw gate facts (required_level, catalog membership) the reducer folds. RpcCharacter-
// shaped fixtures inline (the rpc/fixtures idiom), so the routing law is pinned without a live indexer.
import { describe, expect, test } from 'bun:test'

import { resolve_route } from './fast_travel_target.js'

// A minimal RpcCharacter (packages/frontend/src/rpc/views.ts RpcCharacter): { world, level, position:{x,z} }.
const char = (over = {}) => ({ id: 'C', world: 'W_MINE', level: 30, position: { x: 100, z: 200 }, ...over })
const catalog = new Set(['W_MINE', 'W_FAR'])
const gates = new Map([
  ['W_MINE', 1],
  ['W_FAR', 20],
])

describe('resolve_route — /v1 world is the only routing truth', () => {
  test('same world with a live peer pos → live coordinate, live flag', () => {
    const out = resolve_route({
      target_doc: char({ world: 'W_MINE', position: { x: 1, z: 2 } }),
      my_doc: char({ world: 'W_MINE' }),
      required_level_by_world: gates,
      catalog_ids: catalog,
      live_pos: { x: 55, z: 66 },
    })
    expect(out.ok).toBe(true)
    expect(out.facts).toMatchObject({ world_id: 'W_MINE', x: 55, z: 66, live: true, my_world_id: 'W_MINE' })
  })

  test('ROUTING LAW: a mismatched /v1 world wins over a live p2p pos (never same-world, live NOT used)', () => {
    const out = resolve_route({
      target_doc: char({ world: 'W_FAR', position: { x: 9, z: 9 } }),
      my_doc: char({ world: 'W_MINE' }),
      required_level_by_world: gates,
      catalog_ids: catalog,
      live_pos: { x: 55, z: 66 }, // a world-blind p2p ghost — must be ignored across worlds
    })
    expect(out.ok).toBe(true)
    expect(out.facts.world_id).toBe('W_FAR') // the /v1 doc, never my world
    expect(out.facts.live).toBe(false) // cross-world → the live coord is discarded, anchor used
    expect(out.facts).toMatchObject({ x: 9, z: 9 })
  })

  test('surfaces the level gate + catalog facts for the reducer', () => {
    const out = resolve_route({
      target_doc: char({ world: 'W_FAR', position: { x: 3, z: 4 } }),
      my_doc: char({ world: 'W_MINE', level: 12 }),
      required_level_by_world: gates,
      catalog_ids: catalog,
      live_pos: null,
    })
    expect(out.facts).toMatchObject({ world_id: 'W_FAR', my_level: 12, required_level: 20, catalog_has_world: true })
  })

  test('a world absent from the catalog reports catalog_has_world=false (dungeon/unknown → the reducer refuses)', () => {
    const out = resolve_route({
      target_doc: char({ world: 'W_DUNGEON', position: { x: 1, z: 1 } }),
      my_doc: char({ world: 'W_MINE' }),
      required_level_by_world: gates,
      catalog_ids: catalog,
      live_pos: null,
    })
    expect(out.facts.catalog_has_world).toBe(false)
    expect(out.facts.required_level).toBeNull()
  })

  test('same world, no live peer → falls back to the /v1 anchor (honest, possibly lagged)', () => {
    const out = resolve_route({
      target_doc: char({ world: 'W_MINE', position: { x: 42, z: 43 } }),
      my_doc: char({ world: 'W_MINE' }),
      required_level_by_world: gates,
      catalog_ids: catalog,
      live_pos: null,
    })
    expect(out.facts).toMatchObject({ x: 42, z: 43, live: false })
  })

  test('a target with no world at all → refused (nowhere to go)', () => {
    const out = resolve_route({
      target_doc: char({ world: null, position: null }),
      my_doc: char(),
      required_level_by_world: gates,
      catalog_ids: catalog,
      live_pos: null,
    })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('fast_travel.realm_unreachable')
  })

  test('accepts a plain-object required_level map too (not only a Map)', () => {
    const out = resolve_route({
      target_doc: char({ world: 'W_FAR', position: { x: 0, z: 0 } }),
      my_doc: char({ world: 'W_MINE' }),
      required_level_by_world: { W_FAR: 25 },
      catalog_ids: catalog,
      live_pos: null,
    })
    expect(out.facts.required_level).toBe(25)
  })
})
