// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Lane M5 — the roster/bag spine ONE-PIPELINE merge core. Pure reducer, no mock.module (house convention).
// The three RED scenarios from the audit (row #3): XP regression, outside-writer lost update, enrichment
// clobber — each proven by the bug's shape (a blind spread / stale-captured array) then the fix.

import { test, expect, describe } from 'bun:test'
import { experience_to_level } from '@aresrpg/sdk/experience'

import { reduce_sui_data } from '../src/reduce.js'

const base = (over = {}) => ({ characters: [], items: [], xp_floor: {}, loaded: false, ...over })
const ids = (rows) => rows.map((r) => r.id)

describe('RED#1 — XP must never regress below a receipt-proven floor', () => {
  test('a stale /v1 snapshot after a fight settle keeps the floored XP', () => {
    const start = base({ characters: [{ id: 'c1', experience: 500, level: experience_to_level(500) }] })
    // fight settles: +500 xp receipt → experience 1000, floor raised to 1000
    const settled = reduce_sui_data(start, {
      kind: 'receipt_patch',
      op: 'fight_receipt',
      character_id: 'c1',
      xp_share: 500,
    })
    expect(settled.characters[0].experience).toBe(1000)
    expect(settled.xp_floor.c1).toBe(1000)
    // a lagging /v1 read still projects the pre-fight 500 — the blind spread WOULD regress it
    const after = reduce_sui_data(settled, {
      kind: 'snapshot',
      characters: [{ id: 'c1', experience: 500, level: experience_to_level(500) }],
    })
    expect(after.characters[0].experience).toBe(1000) // floored, not 500
    expect(after.characters[0].level).toBe(experience_to_level(1000))
  })

  test('a snapshot that HAS caught up (>= floor) adopts chain truth', () => {
    const start = base({ characters: [{ id: 'c1', experience: 1000 }], xp_floor: { c1: 1000 } })
    const after = reduce_sui_data(start, { kind: 'snapshot', characters: [{ id: 'c1', experience: 1200 }] })
    expect(after.characters[0].experience).toBe(1200) // above floor — adopted
  })
})

describe('RED#2 — an outside remove must not lose a concurrent snapshot add', () => {
  test('remove folds against the LATEST bag, preserving a newly-loaded item', () => {
    const start = base({
      items: [
        { id: 'A', amount: 1 },
        { id: 'B', amount: 1 },
      ],
    })
    // a background snapshot lands first, adding a freshly-indexed item C
    const loaded = reduce_sui_data(start, { kind: 'snapshot', items: [{ id: 'A' }, { id: 'B' }, { id: 'C' }] })
    expect(ids(loaded.items).sort()).toEqual(['A', 'B', 'C'])
    // equip removes A — as a delta it applies to [A,B,C], never a stale [A,B] captured before the snapshot
    const after = reduce_sui_data(loaded, { kind: 'receipt_patch', op: 'remove_items', ids: ['A'] })
    expect(ids(after.items).sort()).toEqual(['B', 'C']) // C survived (the lost-update is gone)
    expect(ids(after.items)).not.toContain('A')
  })

  test('the OLD blind spread of a stale-captured array LOSES C (documents the bug)', () => {
    const start = base({
      items: [
        { id: 'A', amount: 1 },
        { id: 'B', amount: 1 },
      ],
    })
    const loaded = reduce_sui_data(start, { kind: 'snapshot', items: [{ id: 'A' }, { id: 'B' }, { id: 'C' }] })
    // remove_bag_items USED to read the bag, compute [B], and dispatch that whole array as a blind merge —
    // if the snapshot reduced in between, its C was clobbered. The legacy (no-kind) path is that blind spread:
    const bug = reduce_sui_data(loaded, { items: [{ id: 'B', amount: 1 }] }) // pre-computed from stale [A,B]
    expect(ids(bug.items)).toEqual(['B']) // C LOST — exactly the race the delta fixes
  })
})

describe('RED#3 — enrichment must not clobber a newer receipt fact', () => {
  test('a chain-direct cosmetics read keeps receipt XP/HP, merges only cosmetics/stats', () => {
    const start = base({
      characters: [
        {
          id: 'c1',
          experience: 1000,
          level: experience_to_level(1000),
          current_hp: 34,
          hp_updated_ms: 111,
          gear_vitality: 3,
          vitality: 12,
          equipment_stats: { vitality: -2 },
        },
      ],
      xp_floor: { c1: 1000 },
    })
    // read_character carries the IMMUTABLE base (genesis xp 0, full/last-chain hp 100) — must not win
    const after = reduce_sui_data(start, {
      kind: 'enrichment',
      character_id: 'c1',
      enrichment: {
        experience: 0,
        current_hp: 100,
        color_1: 5,
        vitality: 50,
        gear_vitality: 0,
        equipment_stats: null,
      },
    })
    const [c] = after.characters
    expect(c.experience).toBe(1000) // receipt XP preserved
    expect(c.current_hp).toBe(34) // receipt HP preserved
    expect(c.hp_updated_ms).toBe(111)
    expect(c.gear_vitality).toBe(3) // /v1 equipment fallback preserved over the legacy base-object zero
    expect(c.equipment_stats).toEqual({ vitality: -2 })
    expect(c.color_1).toBe(5) // cosmetics merged in
    expect(c.vitality).toBe(12) // /v1 allocated stat preserved over the immutable base-object zero
  })

  test('a never-fought character takes the chain HP (no receipt to protect)', () => {
    const start = base({ characters: [{ id: 'c1', experience: 0 }] })
    const after = reduce_sui_data(start, {
      kind: 'enrichment',
      character_id: 'c1',
      enrichment: { current_hp: 100, color_1: 3 },
    })
    expect(after.characters[0].current_hp).toBe(100)
  })
})

describe('op coverage', () => {
  test('add_items de-dupes by id', () => {
    const start = base({ items: [{ id: 'A' }] })
    const after = reduce_sui_data(start, { kind: 'receipt_patch', op: 'add_items', rows: [{ id: 'A' }, { id: 'B' }] })
    expect(ids(after.items).sort()).toEqual(['A', 'B'])
  })

  test('decrement_item drops a row at zero', () => {
    const start = base({ items: [{ id: 'A', amount: 2 }] })
    const one = reduce_sui_data(start, { kind: 'receipt_patch', op: 'decrement_item', id: 'A', units: 1 })
    expect(one.items[0].amount).toBe(1)
    const gone = reduce_sui_data(one, { kind: 'receipt_patch', op: 'decrement_item', id: 'A', units: 1 })
    expect(gone.items).toHaveLength(0)
  })

  test('an explicit remove also clears a settled-loot floor so no later snapshot resurrects it', () => {
    const loot = { id: '0xloot', amount: 1 }
    const settled = reduce_sui_data(base(), { kind: 'receipt_patch', op: 'settled_loot', rows: [loot] })
    const removed = reduce_sui_data(settled, { kind: 'receipt_patch', op: 'remove_items', ids: ['0xloot'] })
    const lagged = reduce_sui_data(removed, { kind: 'snapshot', items: [] })
    expect(lagged.items).toEqual([])
    expect(lagged.settled_item_floor).toEqual({})
  })

  test('a settled stack decrement updates its floor and clears it at zero', () => {
    const loot = { id: '0xloot', amount: 2 }
    const settled = reduce_sui_data(base(), { kind: 'receipt_patch', op: 'settled_loot', rows: [loot] })
    const one = reduce_sui_data(settled, { kind: 'receipt_patch', op: 'decrement_item', id: '0xloot', units: 1 })
    const lagged = reduce_sui_data(one, { kind: 'snapshot', items: [] })
    expect(lagged.items).toEqual([{ id: '0xloot', amount: 1 }])

    const gone = reduce_sui_data(lagged, {
      kind: 'receipt_patch',
      op: 'decrement_item',
      id: '0xloot',
      units: 1,
    })
    expect(gone.items).toEqual([])
    expect(gone.settled_item_floor).toEqual({})
  })

  test('set_ghost / clear_ghosts manage a single ghost row without touching real characters', () => {
    const start = base({ characters: [{ id: '0xreal', experience: 10 }] })
    const g1 = reduce_sui_data(start, { kind: 'receipt_patch', op: 'set_ghost', ghost: { id: 'ghost:Alice' } })
    expect(ids(g1.characters)).toEqual(['0xreal', 'ghost:Alice'])
    const g2 = reduce_sui_data(g1, { kind: 'receipt_patch', op: 'set_ghost', ghost: { id: 'ghost:Bob' } })
    expect(ids(g2.characters)).toEqual(['0xreal', 'ghost:Bob']) // old ghost replaced
    const cleared = reduce_sui_data(g2, { kind: 'receipt_patch', op: 'clear_ghosts' })
    expect(ids(cleared.characters)).toEqual(['0xreal'])
  })

  test('snapshot spreads flags and returns a distinct sui object', () => {
    const start = base()
    const after = reduce_sui_data(start, { kind: 'snapshot', loaded: true, load_error: null, characters: [] })
    expect(after.loaded).toBe(true)
    expect(after.kind).toBeUndefined() // the discriminator never leaks into state
    expect(after).not.toBe(start)
  })

  test('the legacy (no-kind) path still floors characters', () => {
    const start = base({ xp_floor: { c1: 900 } })
    const after = reduce_sui_data(start, { characters: [{ id: 'c1', experience: 500 }], loaded: true })
    expect(after.characters[0].experience).toBe(900) // floored even without a kind
    expect(after.loaded).toBe(true)
  })

  test('a no-op receipt returns the SAME sui ref (no React churn)', () => {
    const start = base({ items: [{ id: 'A' }] })
    const after = reduce_sui_data(start, { kind: 'receipt_patch', op: 'remove_items', ids: ['nope'] })
    expect(after).toBe(start)
  })
})

describe('BACKLOG 18 — character DELETE receipt must never be resurrected by a stale snapshot', () => {
  test('remove_character drops the row NOW and tombstones the id', () => {
    const start = base({ characters: [{ id: 'c1' }, { id: 'c2' }] })
    const after = reduce_sui_data(start, { kind: 'receipt_patch', op: 'remove_character', id: 'c1' })
    expect(ids(after.characters)).toEqual(['c2'])
    expect(after.deleted_ids).toEqual({ c1: true })
  })

  test('an indexer-lagging /v1 snapshot cannot resurrect a burned character', () => {
    const start = base({ characters: [{ id: 'c1' }, { id: 'c2' }] })
    const deleted = reduce_sui_data(start, { kind: 'receipt_patch', op: 'remove_character', id: 'c1' })
    // the lagging read still projects c1 — the pre-tombstone spread WOULD re-add it
    const after = reduce_sui_data(deleted, { kind: 'snapshot', characters: [{ id: 'c1' }, { id: 'c2' }] })
    expect(ids(after.characters)).toEqual(['c2'])
  })

  test('the legacy (no-kind) merge honours the tombstone too', () => {
    const start = base({ deleted_ids: { c1: true }, characters: [] })
    const after = reduce_sui_data(start, { characters: [{ id: 'c1' }, { id: 'c3' }], loaded: true })
    expect(ids(after.characters)).toEqual(['c3'])
  })

  test('a caught-up snapshot (id already gone) passes through untouched', () => {
    const start = base({ deleted_ids: { c1: true }, characters: [{ id: 'c2' }] })
    const rows = [{ id: 'c2' }, { id: 'c3' }]
    const after = reduce_sui_data(start, { kind: 'snapshot', characters: rows })
    expect(after.characters).toBe(rows) // referentially stable — no tombstone hit, no rebuild
  })

  test('remove_character without an id is a no-op (same ref)', () => {
    const start = base({ characters: [{ id: 'c1' }] })
    expect(reduce_sui_data(start, { kind: 'receipt_patch', op: 'remove_character' })).toBe(start)
  })
})

describe('equip_worn — a signed equip tx re-projects the worn cosmetic slots (cape-swap regression)', () => {
  const green = { item_id: '0xgreen', template_id: '0xtpl_green', category: 'cloak' }
  const blue = { item_id: '0xblue', template_id: '0xtpl_blue', category: 'cloak' }

  test('set replaces the slot on nested worn AND the flat category mirror', () => {
    const start = base({ characters: [{ id: 'c1', worn: { cloak: green }, cloak: green }] })
    const after = reduce_sui_data(start, {
      kind: 'receipt_patch',
      op: 'equip_worn',
      character_id: 'c1',
      set: { cloak: blue },
    })
    expect(after.characters[0].worn).toEqual({ cloak: blue })
    expect(after.characters[0].cloak).toEqual(blue)
  })

  test('clear empties the slot (nested deleted, flat nulled) so the rig un-dresses', () => {
    const start = base({ characters: [{ id: 'c1', worn: { cloak: green }, cloak: green }] })
    const after = reduce_sui_data(start, {
      kind: 'receipt_patch',
      op: 'equip_worn',
      character_id: 'c1',
      clear: ['cloak'],
    })
    expect(after.characters[0].worn).toEqual({})
    expect(after.characters[0].cloak).toBe(null)
  })

  test('a character without a worn map gains one (chain-direct-only row)', () => {
    const start = base({ characters: [{ id: 'c1' }] })
    const after = reduce_sui_data(start, {
      kind: 'receipt_patch',
      op: 'equip_worn',
      character_id: 'c1',
      set: { hat: { item_id: '0xhat', template_id: '0xtpl_hat', category: 'hat' } },
    })
    expect(after.characters[0].worn.hat.item_id).toBe('0xhat')
  })

  test('unknown character / no effective change are no-ops (same ref)', () => {
    const start = base({ characters: [{ id: 'c1', worn: { cloak: green }, cloak: green }] })
    expect(
      reduce_sui_data(start, { kind: 'receipt_patch', op: 'equip_worn', character_id: 'ghost', set: { cloak: blue } })
    ).toBe(start)
    expect(
      reduce_sui_data(start, { kind: 'receipt_patch', op: 'equip_worn', character_id: 'c1', set: { cloak: green } })
    ).toBe(start)
    expect(
      reduce_sui_data(start, { kind: 'receipt_patch', op: 'equip_worn', character_id: 'c1', clear: ['hat'] })
    ).toBe(start)
  })

  test('untouched sibling characters keep their reference', () => {
    const other = { id: 'c2', worn: {} }
    const start = base({ characters: [{ id: 'c1', worn: { cloak: green }, cloak: green }, other] })
    const after = reduce_sui_data(start, {
      kind: 'receipt_patch',
      op: 'equip_worn',
      character_id: 'c1',
      set: { cloak: blue },
    })
    expect(after.characters[1]).toBe(other)
  })
})

describe('#1127 — a Character mint receipt seeds the roster through the reducer door', () => {
  const prior_character = { id: '0xprior', name: 'Prior', experience: 100 }
  const minted_character = { id: '0xminted', name: 'Minted', experience: 0, level: 1 }

  test('the typed receipt input replaces the submit ghost and paints the real object immediately', () => {
    const ghost = { id: 'ghost:Minted', name: 'Minted', ghost: true }
    const start = base({
      characters: [prior_character, ghost],
      minted_character_floor: {},
      load_error: 'stale read error',
    })

    const after = reduce_sui_data(start, {
      kind: 'receipt_patch',
      op: 'mint_character',
      row: minted_character,
    })

    expect(ids(after.characters)).toEqual(['0xprior', '0xminted'])
    expect(after.characters[0]).toBe(prior_character)
    expect(after.characters[1]).toBe(minted_character)
    expect(after.minted_character_floor).toEqual({ '0xminted': minted_character })
    expect(after.loaded).toBe(true)
    expect(after.load_error).toBeNull()
    expect(after.has_claimed_free_character).toBe(true)
  })

  test('an index-lagged snapshot cannot erase the receipt-proven row; chain presence later takes authority', () => {
    const minted = reduce_sui_data(base({ characters: [prior_character], minted_character_floor: {} }), {
      kind: 'receipt_patch',
      op: 'mint_character',
      row: minted_character,
    })

    const lagged_prior = { ...prior_character, experience: 150 }
    const lagged = reduce_sui_data(minted, {
      kind: 'snapshot',
      characters: [lagged_prior],
    })
    expect(ids(lagged.characters)).toEqual(['0xprior', '0xminted'])
    expect(lagged.characters[0]).toBe(lagged_prior)
    expect(lagged.characters[1]).toBe(minted_character)
    expect(lagged.minted_character_floor).toEqual({ '0xminted': minted_character })

    const authoritative_mint = { ...minted_character, world_id: '0xworld', experience: 25 }
    const caught_up = reduce_sui_data(lagged, {
      kind: 'snapshot',
      characters: [lagged_prior, authoritative_mint],
    })
    expect(caught_up.characters.filter(({ id }) => id === '0xminted')).toEqual([authoritative_mint])
    expect(caught_up.characters[1]).toBe(authoritative_mint)
    expect(caught_up.minted_character_floor).toEqual({})
  })

  test('a later delete receipt clears the mint floor so no stale snapshot can resurrect the character', () => {
    const minted = reduce_sui_data(base({ minted_character_floor: {} }), {
      kind: 'receipt_patch',
      op: 'mint_character',
      row: minted_character,
    })
    expect(ids(minted.characters)).toEqual(['0xminted'])
    const deleted = reduce_sui_data(minted, {
      kind: 'receipt_patch',
      op: 'remove_character',
      id: minted_character.id,
    })
    const lagged = reduce_sui_data(deleted, { kind: 'snapshot', characters: [] })

    expect(lagged.characters).toEqual([])
    expect(lagged.minted_character_floor).toEqual({})
  })
})

// --- #1495: the acquisition sweep's merge receipt ------------------------------------------------------------
describe('merge_stacks — a chain-proven stack merge folds against the LATEST bag', () => {
  const stack = (id, amount) => ({ id, template_id: 't', item_category: 'consumable', amount, stackable: true })

  test('sources are deleted on-chain: they leave the bag and the target carries the summed total', () => {
    const start = base({ items: [stack('0xa', 1), stack('0xb', 1), stack('0xc', 1), stack('0xother', 5)] })
    const merged = reduce_sui_data(start, {
      kind: 'receipt_patch',
      op: 'merge_stacks',
      merges: [
        { into: '0xa', from: '0xb', total: 2 },
        { into: '0xa', from: '0xc', total: 3 },
      ],
    })
    expect(ids(merged.items)).toEqual(['0xa', '0xother'])
    expect(merged.items[0].amount).toBe(3)
    expect(merged.items[1]).toBe(start.items[3]) // untouched rows keep their reference
  })

  test('the settled-loot floor mirrors the same fact — a lagging snapshot cannot resurrect a merged source', () => {
    const start = base({
      items: [stack('0xa', 1), stack('0xb', 1)],
      settled_item_floor: { '0xa': stack('0xa', 1), '0xb': stack('0xb', 1) },
    })
    const merged = reduce_sui_data(start, {
      kind: 'receipt_patch',
      op: 'merge_stacks',
      merges: [{ into: '0xa', from: '0xb', total: 2 }],
    })
    expect(Object.keys(merged.settled_item_floor)).toEqual(['0xa'])
    expect(merged.settled_item_floor['0xa'].amount).toBe(2)
    const lagged = reduce_sui_data(merged, { kind: 'snapshot', items: [stack('0xa', 1)] })
    expect(ids(lagged.items)).toEqual(['0xa'])
  })

  test('an empty or unknown merge set is a no-op by reference', () => {
    const start = base({ items: [stack('0xa', 1)] })
    expect(reduce_sui_data(start, { kind: 'receipt_patch', op: 'merge_stacks', merges: [] })).toBe(start)
  })
})
