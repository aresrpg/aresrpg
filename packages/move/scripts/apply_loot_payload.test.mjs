// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync as read_file, readdirSync as read_dir, existsSync as exists } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import { expect, test } from 'bun:test'

import release from '../../sdk/src/deployment/release.json' with { type: 'json' }

import {
  MAX_CHANCE_BP,
  MAX_LOOT,
  MAX_MOBS_PER_PTB,
  build_batches,
  coverage_check,
  deployment_from_release,
  describe_loot_change,
  desired_loot_by_key,
  diff_mob_loot,
  loot_entries_equal,
  loot_rate_outliers,
  loot_spot_agreement,
  raw_chance_bp,
  read_template_loot,
  resolve_mode,
  seed_loot_entry,
  to_chance_bp,
} from './apply_loot_payload.mjs'

const script_dir = dirname(file_url_to_path(import.meta.url))
const repo_dir = resolve(script_dir, '..', '..', '..')
const id = (n) => `0x${String(n).padStart(64, '0')}`

const load_corpus = () => {
  const dirs = read_dir(join(repo_dir, 'seed', 'mainnet')).filter((name) => /^\d\d_/.test(name)).sort()
  return dirs.flatMap((dir) => {
    const p = join(repo_dir, 'seed', 'mainnet', dir, 'mobs.json')
    return exists(p) ? JSON.parse(read_file(p, 'utf8')) : []
  })
}
const seed_manifest = () => JSON.parse(read_file(join(script_dir, 'out', 'seed_manifest.json'), 'utf8'))

// a chain/desired loot entry
const entry = (over = {}) => ({ item_template: id(1), chance_bp: 5000, min_qty: 1, max_qty: 3, ...over })

// ── chance → basis points (the seeder's bp() mirror, seed_full_corpus:458) ─────────────────────────
test('to_chance_bp mirrors the seeder: 0..1 float → basis points, clamped to [0, 10000]', () => {
  expect(to_chance_bp(0.5)).toBe(5000)
  expect(to_chance_bp(0.72)).toBe(7200)
  expect(to_chance_bp(0.03)).toBe(300)
  expect(to_chance_bp(0.0002)).toBe(2) // rounds
  expect(to_chance_bp(1)).toBe(10000)
  expect(to_chance_bp(1.5)).toBe(10000) // clamp fires
  expect(to_chance_bp(0)).toBe(0)
})

test('raw_chance_bp is UNCLAMPED so the rate gate can see an out-of-range authored rate', () => {
  expect(raw_chance_bp(1.5)).toBe(15000) // the clamp hides this at 10000; the gate reads THIS
  expect(raw_chance_bp(-0.1)).toBe(-1000)
})

// ── seed_loot_entry: slug resolution + REFUSAL on an unminted slug ──────────────────────────────────
test('seed_loot_entry resolves a slug→id and builds the u16 tuple', () => {
  const e = seed_loot_entry({ item: 'fleece', chance: 0.5, min: 1, max: 3 }, { fleece: id(7) })
  expect(e).toMatchObject({ item_template: id(7), chance_bp: 5000, min_qty: 1, max_qty: 3, slug: 'fleece', chance: 0.5 })
})

test('seed_loot_entry THROWS with .unresolved on an unminted slug (never a silent skip)', () => {
  try {
    seed_loot_entry({ item: 'ghost_item', chance: 0.5 }, {})
    throw new Error('should have thrown')
  } catch (error) {
    expect(error.unresolved).toBe('ghost_item')
  }
})

test('seed_loot_entry defaults min/max to 1 (mirrors the seeder l.min ?? 1)', () => {
  const e = seed_loot_entry({ item: 'x', chance: 0.1 }, { x: id(1) })
  expect(e).toMatchObject({ min_qty: 1, max_qty: 1 })
})

// ── desired_loot_by_key: cap, dedup, unresolved bucketing ──────────────────────────────────────────
test('desired_loot_by_key builds the per-mob vector, slices to MAX_LOOT, first-wins dedup', () => {
  const items = Object.fromEntries(Array.from({ length: 20 }, (_, n) => [`i${n}`, id(n + 1)]))
  const rows = [
    { key: 'rat', loot: Array.from({ length: 20 }, (_, n) => ({ item: `i${n}`, chance: 0.1, min: 1, max: 1 })) },
    { key: 'rat', loot: [{ item: 'i0', chance: 0.1, min: 1, max: 1 }] }, // dup key — first wins
  ]
  const { desired, duplicates, unresolved, invalid } = desired_loot_by_key(rows, items)
  expect(desired.rat).toHaveLength(MAX_LOOT) // 20 sliced to 16
  expect(duplicates).toHaveLength(1) // second rat diverges → surfaced, never merged
  expect(unresolved).toEqual([])
  expect(invalid).toEqual([])
})

test('desired_loot_by_key buckets a mob with an unminted loot slug as unresolved (whole mob, no partial)', () => {
  const { desired, unresolved } = desired_loot_by_key(
    [{ key: 'gob', loot: [{ item: 'real', chance: 0.5 }, { item: 'phantom', chance: 0.1 }] }],
    { real: id(1) },
  )
  expect(desired.gob).toBeUndefined() // never a partial desired — the whole mob refuses
  expect(unresolved).toEqual([{ key: 'gob', slug: 'phantom' }])
})

// ── read_template_loot: flat + nested + null guards ────────────────────────────────────────────────
test('read_template_loot reads the flat gRPC loot vector', () => {
  const json = { loot: [{ item_template: id(3), chance_bp: '3500', min_qty: '1', max_qty: '2' }] }
  expect(read_template_loot(json)).toEqual([{ item_template: id(3), chance_bp: 3500, min_qty: 1, max_qty: 2 }])
})

test('read_template_loot honors the .fields nesting fallback', () => {
  const json = { fields: { loot: { fields: [{ fields: { item_template: id(3), chance_bp: 300, min_qty: 1, max_qty: 1 } }] } } }
  expect(read_template_loot(json)).toEqual([{ item_template: id(3), chance_bp: 300, min_qty: 1, max_qty: 1 }])
})

test('read_template_loot returns [] for an empty loot table and null for a malformed entry', () => {
  expect(read_template_loot({ loot: [] })).toEqual([])
  expect(read_template_loot({ loot: [{ chance_bp: 5000, min_qty: 1, max_qty: 1 }] })).toBeNull() // no item_template
  expect(read_template_loot({})).toBeNull() // no loot field
  expect(read_template_loot(null)).toBeNull()
})

// ── the diff: a rate change and a FILL both land in `changed`; idempotent rerun ─────────────────────
test('diff_mob_loot: a chance_bp change lands in `changed`', () => {
  const manifest_mobs = { rat: { id: id(1) } }
  const desired_by_key = { rat: [entry({ chance_bp: 7200, chance: 0.72 })] }
  const chain_by_id = { [id(1)]: [{ item_template: id(1), chance_bp: 3500, min_qty: 1, max_qty: 3 }] } // mint-time 3500
  const out = diff_mob_loot({ manifest_mobs, desired_by_key, chain_by_id })
  expect(out.changed).toHaveLength(1)
  expect(out.changed[0]).toMatchObject({ key: 'rat', from_count: 1, to_count: 1 })
  expect(out.unchanged).toHaveLength(0)
})

test('diff_mob_loot: a NEW entry (the fill class — chain shorter than seed) lands in `changed`', () => {
  const manifest_mobs = { wooling: { id: id(1) } }
  const desired_by_key = { wooling: [entry({ item_template: id(1) }), entry({ item_template: id(2), chance_bp: 5000, chance: 0.5, slug: 'fleece' })] }
  const chain_by_id = { [id(1)]: [{ item_template: id(1), chance_bp: 5000, min_qty: 1, max_qty: 3 }] } // fleece absent on chain
  const out = diff_mob_loot({ manifest_mobs, desired_by_key, chain_by_id })
  expect(out.changed).toHaveLength(1)
  expect(out.changed[0]).toMatchObject({ from_count: 1, to_count: 2 }) // the fill appears
})

test('diff_mob_loot is idempotent — chain == desired ⇒ 0 changed', () => {
  const manifest_mobs = { rat: { id: id(1) } }
  const e = [entry()]
  const out = diff_mob_loot({ manifest_mobs, desired_by_key: { rat: e }, chain_by_id: { [id(1)]: [{ ...entry() }] } })
  expect(out.changed).toEqual([])
  expect(out.unchanged).toHaveLength(1)
})

test('diff_mob_loot buckets unreadable chain (read_failed), and splits missing_seed vs unresolved', () => {
  const manifest_mobs = { unreadable: { id: id(1) }, orphan: { id: id(2) }, phantom_loot: { id: id(3) }, bad_id: { id: '0xnope' } }
  const out = diff_mob_loot({
    manifest_mobs,
    desired_by_key: {}, // none built
    chain_by_id: { [id(1)]: null, [id(2)]: [], [id(3)]: [] },
    unresolved_keys: new Set(['phantom_loot']),
  })
  expect(out.read_failed.map((r) => r.key).sort()).toEqual(['bad_id', 'unreadable'])
  expect(out.missing_seed.map((r) => r.key)).toEqual(['orphan'])
  expect(out.unresolved.map((r) => r.key)).toEqual(['phantom_loot'])
})

test('loot_entries_equal is position-wise and length-sensitive', () => {
  expect(loot_entries_equal([entry()], [entry()])).toBe(true)
  expect(loot_entries_equal([entry()], [entry({ chance_bp: 1 })])).toBe(false)
  expect(loot_entries_equal([entry()], [entry(), entry()])).toBe(false)
})

test('describe_loot_change narrates NEW / rate-move / removed by slug', () => {
  const slug_by_id = { [id(1)]: 'crude_branch', [id(2)]: 'wooling_fleece', [id(3)]: 'stale' }
  const current = [{ item_template: id(1), chance_bp: 3500, min_qty: 1, max_qty: 2 }, { item_template: id(3), chance_bp: 100, min_qty: 1, max_qty: 1 }]
  const desired = [entry({ item_template: id(1), chance_bp: 7200, min_qty: 1, max_qty: 2 }), entry({ item_template: id(2), chance_bp: 5000 })]
  expect(describe_loot_change(current, desired, slug_by_id)).toEqual(['crude_branch 3500→7200', 'wooling_fleece +NEW@5000', 'stale -removed'])
})

// ── batching ──────────────────────────────────────────────────────────────────────────────────────
test('build_batches chunks at ≤MAX_MOBS_PER_PTB', () => {
  const changed = Array.from({ length: 45 }, (_, n) => ({ key: `m${n}`, id: id(n), desired: [entry()] }))
  const batches = build_batches(changed)
  expect(batches.map((b) => b.calls.length)).toEqual([20, 20, 5])
  expect(batches.every((b) => b.calls.length <= MAX_MOBS_PER_PTB)).toBe(true)
})

// ── THE COVERAGE TOOTH ─────────────────────────────────────────────────────────────────────────────
test('coverage_check passes when every ruled row is planned', () => {
  expect(coverage_check({ ruled: ['a', 'b'], planned: ['a', 'b'] })).toMatchObject({ ok: true, covered_pct: 100, uncovered: [] })
})

test('coverage_check REFUSES a dropped ruled row and zero-planned-against-nonzero-ruled', () => {
  expect(coverage_check({ ruled: ['a', 'b', 'c'], planned: ['a', 'c'] })).toMatchObject({ ok: false, uncovered: ['b'] })
  expect(coverage_check({ ruled: ['a'], planned: [] })).toMatchObject({ ok: false, covered_pct: 0 })
})

// ── THE RATE/QTY GATE (seat rider ①) ────────────────────────────────────────────────────────────────
test('loot_rate_outliers FLAGS a >100% (raw>10000) rate, a 0% rate, and min>max', () => {
  const changed = [
    { key: 'a', id: id(1), desired: [entry({ chance: 1.5 })] }, // raw 15000 > cap
    { key: 'b', id: id(1), desired: [entry({ chance: 0 })] }, // 0% — meaningless
    { key: 'c', id: id(1), desired: [entry({ chance: 0.5, min_qty: 5, max_qty: 2 })] }, // min>max
  ]
  const out = loot_rate_outliers(changed)
  expect(out.map((o) => o.key).sort()).toEqual(['a', 'b', 'c'])
})

test('loot_rate_outliers PASSES a clean entry (rate at the cap, min≤max)', () => {
  expect(loot_rate_outliers([{ key: 'ok', id: id(1), desired: [entry({ chance: 1, min_qty: 1, max_qty: 3 })] }])).toEqual([])
})

// ── SPOT-AGREEMENT (seat rider ②) ────────────────────────────────────────────────────────────────────
test('loot_spot_agreement re-derives bp from the raw chance and agrees on a faithful mapping', () => {
  const changed = [{ key: 'wooling', id: id(1), desired: [entry({ slug: 'wooling_fleece', chance: 0.5, chance_bp: 5000 })] }]
  const rows = loot_spot_agreement(changed, ['wooling'])
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ slug: 'wooling_fleece', chance: 0.5, planned_bp: 5000, expect_bp: 5000, agree: true })
})

test('loot_spot_agreement catches a mapping bug (planned_bp diverges from the re-derived expect_bp)', () => {
  const changed = [{ key: 'bug', id: id(1), desired: [entry({ slug: 's', chance: 0.5, chance_bp: 9999 })] }] // planted wrong
  expect(loot_spot_agreement(changed, ['bug'])[0].agree).toBe(false)
})

// ── mode + deployment ─────────────────────────────────────────────────────────────────────────────
test('resolve_mode: DRY default, LIVE=1 opens execution, LIVE≠1 throws', () => {
  expect(resolve_mode({})).toEqual({ live: false })
  expect(resolve_mode({ LIVE: '1' })).toEqual({ live: true })
  expect(() => resolve_mode({ LIVE: '0' })).toThrow(/exactly 1/)
})

test('deployment_from_release resolves aresrpg (set_loot) + engine (new_loot_entry) + the ORIGIN type tag', () => {
  const d = deployment_from_release(release, 'testnet')
  expect(d.call_package).toBe(release.networks.testnet.packages.aresrpg.latest)
  expect(d.fight_package).toBe(release.networks.testnet.packages.engine.latest)
  expect(d.fight_type_package).toBe(release.networks.testnet.packages.engine.origin) // types canonicalize to origin
  expect(d.admin).toBe(release.networks.testnet.packages.aresrpg.admin)
  expect(d.version).toBe(release.networks.testnet.shared.VERSION.id)
})

test('deployment_from_release throws on a missing network', () => {
  expect(() => deployment_from_release(release, 'nope')).toThrow(/invalid/)
})

// ── real corpus guards ──────────────────────────────────────────────────────────────────────────────
test('the real mob corpus resolves EVERY loot slug against the manifest (0 unresolved, 0 invalid)', () => {
  const { desired, unresolved, invalid, duplicates } = desired_loot_by_key(load_corpus(), seed_manifest().items ?? {})
  expect(unresolved).toEqual([]) // every authored loot item was minted (no re-baked gap)
  expect(invalid).toEqual([])
  expect(duplicates).toEqual([])
  // every minted manifest mob resolves to a desired loot vector
  const missing = Object.keys(seed_manifest().mobs ?? {}).filter((key) => !(key in desired))
  expect(missing).toEqual([])
})

test('the real corpus carries the wool-floor: wooling loot has the fleece FILL @5000 and crude_branch @7200', () => {
  const { desired } = desired_loot_by_key(load_corpus(), seed_manifest().items ?? {})
  const by_slug = Object.fromEntries(desired.wooling.map((e) => [e.slug, e]))
  expect(by_slug.wooling_fleece.chance_bp).toBe(5000) // 0.5 → 5000 (the wool floor)
  expect(by_slug.crude_branch.chance_bp).toBe(7200) // 0.72 → 7200
})

test('the whole real corpus passes the rate/qty gate (no over-cap / 0% / min>max authored loot)', () => {
  const { desired } = desired_loot_by_key(load_corpus(), seed_manifest().items ?? {})
  const changed = Object.entries(desired).map(([key, entries]) => ({ key, id: id(1), desired: entries }))
  expect(loot_rate_outliers(changed)).toEqual([])
})

test('sanity: the constants match the on-chain law', () => {
  expect(MAX_LOOT).toBe(16)
  expect(MAX_CHANCE_BP).toBe(10000)
})
