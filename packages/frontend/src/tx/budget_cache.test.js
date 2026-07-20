// PER-FIGHT BUDGET CACHE (latency lever 1) — proves the shape key ignores per-act args but pins the fight,
// that a remembered budget is reused (hit) until invalidated, and that the GAS_CEILING refuse stays ARMED on a
// cached value. The cache is what lets a turn's 2nd/3rd leg skip the ~0.5s dry-run round-trip.
import { afterEach, describe, expect, test } from 'bun:test'

import { GAS_CEILING_MIST } from '../game/core/gas_guard.js'

import { budget_cache_key, cached_budget, remember_budget, forget_budget, clear_budget_cache } from './budget_cache.js'

// A fake built PTB exposing the exact `getData()` shape @mysten/sui 2.20 emits (verified against a live build):
// MoveCall commands + inputs tagged UnresolvedObject / Object.SharedObject / Pure.
const fake_tx = ({ targets = ['0xpkg::actions::act_move'], objects = ['0xfight', '0xclock'], pures = 0 } = {}) => ({
  getData: () => ({
    commands: targets.map((t) => {
      const [pkg, module, fn] = t.split('::')
      return { $kind: 'MoveCall', MoveCall: { package: pkg, module, function: fn } }
    }),
    inputs: [
      ...objects.map((objectId, i) =>
        i % 2 === 0
          ? { $kind: 'UnresolvedObject', UnresolvedObject: { objectId } }
          : { $kind: 'Object', Object: { $kind: 'SharedObject', SharedObject: { objectId } } }
      ),
      ...Array.from({ length: pures }, (_, i) => ({ $kind: 'Pure', Pure: { bytes: `p${i}` } })),
    ],
  }),
})

afterEach(() => clear_budget_cache())

describe('budget_cache_key — shape identity', () => {
  test('SAME target + SAME fight objects but DIFFERENT pure args (cell/target) ⇒ SAME key (the reuse property)', () => {
    const a = budget_cache_key(fake_tx({ pures: 2 })) // e.g. act_move to cell 10
    const b = budget_cache_key(fake_tx({ pures: 5 })) // e.g. act_move to cell 99 (more/other pure inputs)
    expect(a).toBe(b)
    expect(a).not.toBeNull()
  })

  test('a DIFFERENT fight object ⇒ a DIFFERENT key (never reuse across fights)', () => {
    const f1 = budget_cache_key(fake_tx({ objects: ['0xfightA', '0xclock'] }))
    const f2 = budget_cache_key(fake_tx({ objects: ['0xfightB', '0xclock'] }))
    expect(f1).not.toBe(f2)
  })

  test('a DIFFERENT move-call target (act_move vs act_pass) ⇒ a DIFFERENT key', () => {
    const mv = budget_cache_key(fake_tx({ targets: ['0xpkg::actions::act_move'] }))
    const ps = budget_cache_key(fake_tx({ targets: ['0xpkg::actions::act_pass'] }))
    expect(mv).not.toBe(ps)
  })

  test('object order does not matter (ids are sorted)', () => {
    const a = budget_cache_key(fake_tx({ objects: ['0xaaa', '0xbbb'] }))
    const b = budget_cache_key(fake_tx({ objects: ['0xbbb', '0xaaa'] }))
    expect(a).toBe(b)
  })

  test('an un-inspectable tx (no getData) ⇒ null (⇒ caller dry-runs, never caches)', () => {
    expect(budget_cache_key({ setGasBudget() {} })).toBeNull()
  })

  test('a tx with no move-call ⇒ null', () => {
    expect(budget_cache_key(fake_tx({ targets: [] }))).toBeNull()
  })
})

describe('cache lifecycle — hit / miss / invalidate / fight-scope', () => {
  const key = 'k'
  const under = GAS_CEILING_MIST - 1n // a net cost safely under the ceiling

  test('MISS then HIT: unknown key → null; after remember → returns the pinned budget', () => {
    expect(cached_budget(key)).toBeNull() // miss ⇒ the caller will dry-run
    remember_budget(key, 4_500_000n, under)
    expect(cached_budget(key)).toBe(4_500_000n) // hit ⇒ the caller skips the dry-run
  })

  test('CEILING STAYS ARMED: a cached value now over the ceiling is DROPPED, never reused', () => {
    remember_budget(key, 9_000_000n, GAS_CEILING_MIST + 1n)
    expect(cached_budget(key)).toBeNull() // dropped → forces a fresh dry-run (which would refuse loudly)
    expect(cached_budget(key)).toBeNull() // and it is gone
  })

  test('forget_budget invalidates ONE shape (a guard refusal on that shape)', () => {
    remember_budget(key, 4_500_000n, under)
    forget_budget(key)
    expect(cached_budget(key)).toBeNull()
  })

  test('clear_budget_cache wipes EVERY shape (fight boundary / executed failure)', () => {
    remember_budget('a', 1n, under)
    remember_budget('b', 2n, under)
    clear_budget_cache()
    expect(cached_budget('a')).toBeNull()
    expect(cached_budget('b')).toBeNull()
  })

  test('a null key never caches and never throws', () => {
    expect(cached_budget(null)).toBeNull()
    remember_budget(null, 1n, under) // no-op
    forget_budget(null) // no-op
    expect(cached_budget(null)).toBeNull()
  })
})
