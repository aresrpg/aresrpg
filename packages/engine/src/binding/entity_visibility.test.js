// Seam 4 gate — the registry hides/shows sets by id via .visible, preserving objects (no despawn), and
// reconciles entities registered mid-filter.

import { test, expect, describe } from 'bun:test'

import { create_entity_visibility } from './entity_visibility.js'

/** A minimal three-Object3D stand-in — only `.visible` is touched. */
const obj = (extra = {}) => ({ visible: true, ...extra })

describe('binding/entity_visibility', () => {
  test('predicate filter hides the non-matching set without removing objects', () => {
    const reg = create_entity_visibility()
    const a = obj({ tag: 'a' })
    const b = obj({ tag: 'b' })
    const c = obj({ tag: 'c' })
    reg.register('a', a)
    reg.register('b', b)
    reg.register('c', c)

    // phase out b + c (a fight claims them) — only a stays visible.
    const fight = new Set(['b', 'c'])
    reg.set_visibility_filter((id) => !fight.has(id))
    expect([a.visible, b.visible, c.visible]).toEqual([true, false, false])
    // objects are still tracked (state preserved — no despawn).
    expect(reg.size()).toBe(3)
    expect(reg.has('b')).toBe(true)

    // clearing the filter brings them all back — same objects, just re-shown.
    reg.clear_filter()
    expect([a.visible, b.visible, c.visible]).toEqual([true, true, true])
  })

  test('id allowlist shows only the listed ids', () => {
    const reg = create_entity_visibility()
    const a = obj()
    const b = obj()
    reg.register('a', a)
    reg.register('b', b)
    reg.set_visibility_filter(['a']) // spectate: only 'a' visible
    expect([a.visible, b.visible]).toEqual([true, false])
  })

  test('an entity registered DURING a filter is reconciled immediately', () => {
    const reg = create_entity_visibility()
    const fight = new Set(['ghost'])
    reg.set_visibility_filter((id) => !fight.has(id))
    const ghost = obj()
    reg.register('ghost', ghost) // spawned mid-phase-out
    expect(ghost.visible).toBe(false)
    const bystander = obj()
    reg.register('bystander', bystander)
    expect(bystander.visible).toBe(true)
  })

  test('re-registering an id replaces the object and reconciles it', () => {
    const reg = create_entity_visibility()
    reg.set_visibility_filter(['keep'])
    const first = obj()
    reg.register('x', first)
    expect(first.visible).toBe(false)
    const second = obj()
    reg.register('x', second)
    expect(reg.size()).toBe(1)
    expect(second.visible).toBe(false)
  })

  test('unregister restores visibility and stops tracking', () => {
    const reg = create_entity_visibility()
    const a = obj()
    reg.register('a', a)
    reg.set_visibility_filter(() => false) // hide everything
    expect(a.visible).toBe(false)
    reg.unregister('a')
    expect(a.visible).toBe(true) // restored on leaving the registry
    expect(reg.has('a')).toBe(false)
  })

  test('null filter shows everything; dispose restores + clears', () => {
    const reg = create_entity_visibility()
    const a = obj()
    const b = obj()
    reg.register('a', a)
    reg.register('b', b)
    reg.set_visibility_filter(() => false)
    reg.set_visibility_filter(null)
    expect([a.visible, b.visible]).toEqual([true, true])
    reg.set_visibility_filter(() => false)
    reg.dispose()
    expect([a.visible, b.visible]).toEqual([true, true])
    expect(reg.size()).toBe(0)
  })
})
