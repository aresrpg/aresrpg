// MOB-XP REAUTHOR — the SHARED diff/read truth, fixture-proven (no chain). Owner re-aim 2026-07-20: this lane is
// the FALLBACK; the primary xp path is an additive `mob_template::set_xp_reward` setter (parallel lane). BOTH
// paths consume `diff_mob_xp` — so this pure core is the one place the changed-set is defined, and its buckets
// (changed / unchanged / read_failed / missing_seed) are the LIVE gate the driver and the setter apply script
// both read. The real DRY run against testnet is the lead's (sandbox parity note mirrors box_reauthor.test).

import { describe, expect, test } from 'bun:test'

import {
  diff_mob_xp,
  read_template_xp,
  seed_xp_by_key,
  unminted_seed_keys,
} from './mob_xp_reauthor_plan.mjs'

const id = (char) => `0x${String(char).repeat(64).slice(0, 64)}`

describe('diff_mob_xp — the shared changed-set both paths consume', () => {
  const manifest_mobs = {
    alpha: { id: id('a') }, // chain 2 ≠ seed 5 → changed
    bravo: { id: id('b') }, // chain 10 == seed 10 → unchanged
    charlie: { id: id('c') }, // chain null → read_failed (never touch what you couldn't read)
    delta: { id: 'not-an-id' }, // invalid manifest id → read_failed
    echo: { id: id('e') }, // no seed row → missing_seed (data inconsistency)
  }
  const seed_xp = { alpha: 5, bravo: 10, charlie: 7, foxtrot: 3 }
  const chain_xp = { [id('a')]: 2, [id('b')]: 10, [id('c')]: null, [id('e')]: 40 }

  test('buckets chain-vs-seed xp into changed / unchanged / read_failed / missing_seed', () => {
    const plan = diff_mob_xp({ manifest_mobs, seed_xp, chain_xp })
    expect(plan.changed).toEqual([{ key: 'alpha', id: id('a'), from: 2, to: 5 }])
    expect(plan.unchanged).toEqual([{ key: 'bravo', id: id('b'), xp: 10 }])
    expect(plan.read_failed.map((row) => row.key).sort()).toEqual([
      'charlie',
      'delta',
    ])
    expect(plan.missing_seed.map((row) => row.key)).toEqual(['echo'])
    expect(plan.total).toBe(5)
  })

  test('a post-run rerun (chain xp adopted the seed xp) is a zero-change plan (idempotent)', () => {
    const healed = { [id('a')]: 5, [id('b')]: 10, [id('c')]: 7, [id('e')]: 40 }
    const only_seeded = {
      alpha: { id: id('a') },
      bravo: { id: id('b') },
      charlie: { id: id('c') },
    }
    const plan = diff_mob_xp({
      manifest_mobs: only_seeded,
      seed_xp,
      chain_xp: healed,
    })
    expect(plan.changed).toEqual([])
    expect(plan.unchanged.map((row) => row.key)).toEqual([
      'alpha',
      'bravo',
      'charlie',
    ])
  })

  test('--limit trims the SORTED manifest key set deterministically (canary batch)', () => {
    const plan = diff_mob_xp({ manifest_mobs, seed_xp, chain_xp, limit: 2 })
    expect(plan.total).toBe(2) // alpha, bravo
    expect(plan.changed.map((row) => row.key)).toEqual(['alpha'])
    expect(plan.unchanged.map((row) => row.key)).toEqual(['bravo'])
  })
})

describe('seed_xp_by_key — retuned xp per mob key (mirrors seed_full_corpus mob_xp_required)', () => {
  test('keeps xp>0 rows, flags xp<=0 / missing-key / non-integer, dedupes first-wins', () => {
    const { xp, invalid, duplicates } = seed_xp_by_key([
      { key: 'a', xp: 5 },
      { key: 'b', xp: 0 }, // xp must be > 0
      { key: 'c' }, // xp missing → NaN
      { key: null, xp: 9 }, // no key
      { key: 'a', xp: 5 }, // dup, same value → silently ignored
      { key: 'd', xp: 8 },
      { key: 'd', xp: 99 }, // dup, DIFFERENT value → surfaced, never merged
    ])
    expect(xp).toEqual({ a: 5, d: 8 })
    expect(invalid.map((row) => row.key)).toEqual(['b', 'c', null])
    expect(duplicates).toEqual([{ key: 'd', kept: 8, ignored: 99 }])
  })
})

describe('read_template_xp — xp_reward off a mob-template gRPC json', () => {
  test('coerces u64-number and u64-string, honors .fields, nulls absent/malformed/negative', () => {
    expect(read_template_xp({ xp_reward: 5 })).toBe(5)
    expect(read_template_xp({ xp_reward: '20' })).toBe(20)
    expect(read_template_xp({ fields: { xp_reward: 7 } })).toBe(7)
    expect(read_template_xp({})).toBe(null)
    expect(read_template_xp(null)).toBe(null)
    expect(read_template_xp({ xp_reward: 'abc' })).toBe(null)
    expect(read_template_xp({ xp_reward: -3 })).toBe(null)
  })
})

describe('unminted_seed_keys — seed mobs with no minted template (info only)', () => {
  test('lists seed keys absent from the manifest', () => {
    expect(unminted_seed_keys({ a: { id: id('a') } }, { a: 5, z: 3 })).toEqual([
      'z',
    ])
  })
})
