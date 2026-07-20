// SEARCH-ZONE JUICE — the pure seams that carry the search feedback from press/chain → screen:
//   1) read_zone_searched: the on-chain ZoneSearched event → the banner's findings counts (the contract
//      coupling — pins the event type suffix + field names so a Move rename can't silently zero the banner).
//   2) zone_reveal_store / reveal_zone: the single-slot cinematic channel the banner renders (newer-wins).
//   3) search_flash_store / trigger_search_flash: the ON-PRESS border-flash trigger (SEARCH-PRESS JUICE) —
//      a bare incrementing id so a component can key a remount off it and replay a one-shot CSS animation.
import { test, expect } from 'bun:test'

import { read_zone_searched } from './zone_searched.js'
import { zone_reveal_store, reveal_zone, search_flash_store, trigger_search_flash } from './toast.js'

test('read_zone_searched decodes the ZoneSearched event (string u64s → numbers)', () => {
  const result = {
    events: [
      { type: '0xother::gathering::Gathered', parsedJson: { x: '1' } },
      {
        type: '0xabc123::zones::ZoneSearched',
        parsedJson: { world: '0xw', zx: '3', zy: '7', at_ms: '1700', mob_groups: '3', resource_nodes: '2' },
      },
    ],
  }
  expect(read_zone_searched(result)).toEqual({ zx: 3, zy: 7, mob_groups: 3, resource_nodes: 2 })
})

test('read_zone_searched degrades to zeros when the event is absent (never throws)', () => {
  expect(read_zone_searched({ events: [] })).toEqual({ zx: 0, zy: 0, mob_groups: 0, resource_nodes: 0 })
  expect(read_zone_searched(null)).toEqual({ zx: 0, zy: 0, mob_groups: 0, resource_nodes: 0 })
  expect(read_zone_searched(undefined)).toEqual({ zx: 0, zy: 0, mob_groups: 0, resource_nodes: 0 })
})

test('reveal_zone fills the store slot; a newer reveal wins (single-slot cinematic channel)', () => {
  let notifies = 0
  const unsub = zone_reveal_store.subscribe(() => notifies++)

  const id_a = reveal_zone({ zx: 1, zy: 2, mob_groups: 4, resource_nodes: 0 })
  expect(zone_reveal_store.get()).toMatchObject({ id: id_a, zx: 1, zy: 2, mob_groups: 4, resource_nodes: 0 })
  expect(notifies).toBe(1)

  const id_b = reveal_zone({ zx: 5, zy: 6, mob_groups: 1, resource_nodes: 3 })
  expect(id_b).not.toBe(id_a)
  expect(zone_reveal_store.get()).toMatchObject({ id: id_b, zx: 5, zy: 6, mob_groups: 1, resource_nodes: 3 })
  expect(notifies).toBe(2)

  unsub()
})

test('reveal_zone defaults missing counts to 0', () => {
  reveal_zone({ zx: 9, zy: 9 })
  expect(zone_reveal_store.get()).toMatchObject({ mob_groups: 0, resource_nodes: 0 })
})

test('trigger_search_flash increments the id + notifies on every call, even back-to-back', () => {
  let notifies = 0
  const unsub = search_flash_store.subscribe(() => notifies++)
  const before = search_flash_store.get()

  trigger_search_flash()
  const after_first = search_flash_store.get()
  expect(after_first).toBe(before + 1)
  expect(notifies).toBe(1)

  trigger_search_flash() // back-to-back press — must move again (a component keys its remount off this)
  expect(search_flash_store.get()).toBe(after_first + 1)
  expect(notifies).toBe(2)

  unsub()
})
