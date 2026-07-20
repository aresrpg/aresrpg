// The ring owns eviction; the store is a bounded, insertion-ordered resident map.

import { test, expect, describe } from 'bun:test'

import { create_chunk_store, coord_key } from './store.js'
import { create_chunk_record } from './format.js'

/** @param {number} cx @param {number} cy @param {number} cz */
const rec = (cx, cy, cz) => create_chunk_record(cx, cy, cz)

describe('chunk store', () => {
  test('resident reads preserve plain-map insertion order', () => {
    const store = create_chunk_store({ capacity: 3 })
    store.put(rec(0, 0, 0))
    store.put(rec(1, 0, 0))
    store.put(rec(2, 0, 0))
    store.get(0, 0, 0)
    expect([...store.values()].map((chunk) => chunk.cx)).toEqual([0, 1, 2])
  })

  test('capacity is a fail-loud invariant and never silently deletes resident output', () => {
    const store = create_chunk_store({ capacity: 2 })
    store.put(rec(0, 0, 0))
    store.put(rec(1, 0, 0))
    expect(() => store.put(rec(2, 0, 0))).toThrow(/capacity/)
    expect([...store.values()].map((chunk) => chunk.cx)).toEqual([0, 1])
  })

  test('capacity is required', () => {
    // @ts-expect-error deliberate construction failure
    expect(() => create_chunk_store({})).toThrow(/capacity/)
    expect(() => create_chunk_store({ capacity: 0 })).toThrow(/capacity/)
    expect(() => create_chunk_store({ capacity: 1.5 })).toThrow(/capacity/)
  })

  test('under capacity resolves resident records', () => {
    const store = create_chunk_store({ capacity: 4 })
    store.put(rec(0, 0, 0))
    store.put(rec(1, 0, 0))
    expect(store.size()).toBe(2)
    expect(store.has(0, 0, 0)).toBe(true)
    expect(store.get(1, 0, 0)?.cx).toBe(1)
    expect(store.get(9, 9, 9)).toBeUndefined()
  })

  test('explicit evict() removes one record and is idempotent on a missing key', () => {
    const store = create_chunk_store({ capacity: 4 })
    store.put(rec(5, 0, 0))
    expect(store.evict(5, 0, 0)).toBe(true)
    expect(store.evict(5, 0, 0)).toBe(false) // already gone
    expect(store.size()).toBe(0)
  })

  test('re-put replaces in place without growing or reordering', () => {
    const store = create_chunk_store({ capacity: 2 })
    store.put(rec(0, 0, 0))
    store.put(rec(1, 0, 0))
    store.put(rec(0, 0, 0))
    expect(store.size()).toBe(2)
    expect([...store.values()].map((chunk) => chunk.cx)).toEqual([0, 1])
    expect(coord_key(2, 0, 0)).toBe('2,0,0')
  })
})
