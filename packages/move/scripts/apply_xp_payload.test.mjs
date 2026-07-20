// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync as read_file } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import { expect, test } from 'bun:test'

import release from '../../sdk/src/deployment/release.json' with { type: 'json' }

import {
  RES_SHIFT,
  MAX_CALLS_PER_PTB,
  MAX_RESIST_MAGNITUDE,
  STAT_FIELDS,
  build_batches,
  coverage_check,
  deployment_from_release,
  desired_state_by_key,
  diff_mob_state,
  field_histogram,
  read_template_state,
  resistance_outliers,
  resolve_mode,
  seed_stats_to_centered,
  state_field_diff,
} from './apply_xp_payload.mjs'

const script_dir = dirname(file_url_to_path(import.meta.url))
const repo_dir = resolve(script_dir, '..', '..', '..')
const id = (n) => `0x${String(n).padStart(64, '0')}`

// A full chain/desired stats block from the 11 canonical fields (appended stats = 0, as every template carries).
const stats = (over = {}) => {
  const base = Object.fromEntries(STAT_FIELDS.map((f) => [f, f.endsWith('_resistance') ? RES_SHIFT : 0]))
  return { ...base, ...over }
}
const state = (over = {}) => ({ base_hp: 30, ap: 6, mp: 3, stats: stats(), xp_reward: 10, ...over })

// ── seed→stats mapping: the CORRECTION (reads both schemas, centers resistances) ──────────────────
test('seed_stats_to_centered reads BOTH resistance schemas and centers them (the seeder-bug correction)', () => {
  // camelCase (majority) — the exact keys the original seeder DROPPED
  expect(seed_stats_to_centered({ str: 4, earthRes: 20, airRes: -10 })).toMatchObject({
    strength: 4,
    earth_resistance: RES_SHIFT + 20, // 32788 — NOT neutral 32768 (the regression the fix kills)
    air_resistance: RES_SHIFT - 10, // 32758 — a weakness survives centering
    fire_resistance: RES_SHIFT,
  })
  // snake_case (minority) resolves to the same field
  expect(seed_stats_to_centered({ fire_resistance: 15 }).fire_resistance).toBe(RES_SHIFT + 15)
  // attribute aliases
  expect(seed_stats_to_centered({ int: 7, raw: 3, crit: 5 })).toMatchObject({ intelligence: 7, raw_damage: 3, critical_hit: 5 })
})

test('seed_stats_to_centered refuses a resistance that underflows the centering', () => {
  expect(() => seed_stats_to_centered({ earthRes: -40000 })).toThrow(/underflow/)
})

// ── desired_state_by_key: dedup + invalid bucketing ───────────────────────────────────────────────
test('desired_state_by_key builds the 5-tuple, first-wins dedup, buckets invalid xp', () => {
  const { desired, invalid, duplicates } = desired_state_by_key([
    { key: 'rat', hp: 15, ap: 4, mp: 3, xp: 5, stats: { str: 4 } },
    { key: 'rat', hp: 15, ap: 4, mp: 3, xp: 5, stats: { str: 4 } }, // identical dup — silently dropped
    { key: 'bad', hp: 10, ap: 6, mp: 3, xp: 0 }, // xp must be > 0
  ])
  expect(desired.rat).toMatchObject({ base_hp: 15, ap: 4, mp: 3, xp_reward: 5 })
  expect(desired.rat.stats.strength).toBe(4)
  expect(invalid.map((r) => r.key)).toEqual(['bad'])
  expect(duplicates).toEqual([])
})

test('desired_state_by_key surfaces a divergent duplicate (never merges it)', () => {
  const { duplicates } = desired_state_by_key([
    { key: 'rat', hp: 15, ap: 4, mp: 3, xp: 5 },
    { key: 'rat', hp: 15, ap: 4, mp: 3, xp: 9 }, // same key, different xp
  ])
  expect(duplicates).toHaveLength(1)
  expect(duplicates[0].key).toBe('rat')
})

// ── read_template_state: full read + silent-loss guard ────────────────────────────────────────────
test('read_template_state reads the full tunable state', () => {
  const json = { base_hp: '15', ap: '4', mp: '3', xp_reward: '2', stats: { ...stats({ strength: 4 }) } }
  expect(read_template_state(json)).toMatchObject({ base_hp: 15, ap: 4, mp: 3, xp_reward: 2 })
})

test('read_template_state returns null on a NON-ZERO appended stat (never silently zero it)', () => {
  const json = { base_hp: 15, ap: 4, mp: 3, xp_reward: 2, stats: { ...stats(), vitality: 5 } }
  expect(read_template_state(json)).toBeNull()
})

// ── the diff: resistance-only change applies, others byte-identical; idempotent rerun ─────────────
test('diff_mob_state: a resistance-only change lands in `changed` with the rest byte-identical', () => {
  const manifest_mobs = { rat: { id: id(1) } }
  const desired_by_key = { rat: state({ stats: stats({ earth_resistance: RES_SHIFT + 20 }) }) }
  const chain_by_id = { [id(1)]: state() } // chain neutral (the dropped resistance)
  const out = diff_mob_state({ manifest_mobs, desired_by_key, chain_by_id })
  expect(out.changed).toHaveLength(1)
  expect(out.changed[0].fields).toEqual(['stats'])
  expect(out.changed[0].stat_changes).toEqual(['earth_resistance'])
  expect(out.changed[0].desired.base_hp).toBe(30) // unchanged field carried byte-identical
  expect(out.unchanged).toHaveLength(0)
})

test('diff_mob_state is idempotent — chain == desired ⇒ 0 changed', () => {
  const manifest_mobs = { rat: { id: id(1) } }
  const s = state({ xp_reward: 5, stats: stats({ earth_resistance: RES_SHIFT + 20 }) })
  const out = diff_mob_state({ manifest_mobs, desired_by_key: { rat: s }, chain_by_id: { [id(1)]: s } })
  expect(out.changed).toEqual([])
  expect(out.unchanged).toHaveLength(1)
})

test('diff_mob_state buckets unreadable chain (read_failed) and manifest-only keys (missing_seed)', () => {
  const manifest_mobs = { unreadable: { id: id(1) }, orphan: { id: id(2) }, bad_id: { id: '0xnope' } }
  const out = diff_mob_state({
    manifest_mobs,
    desired_by_key: { unreadable: state(), orphan: undefined },
    chain_by_id: { [id(1)]: null, [id(2)]: state() },
  })
  expect(out.read_failed.map((r) => r.key).sort()).toEqual(['bad_id', 'unreadable'])
  expect(out.missing_seed.map((r) => r.key)).toEqual(['orphan'])
})

test('state_field_diff counts stats as ONE field but records the moved elements', () => {
  const d = state_field_diff(state(), state({ base_hp: 40, stats: stats({ fire_resistance: RES_SHIFT + 5 }) }))
  expect(d.fields.sort()).toEqual(['base_hp', 'stats'])
  expect(d.stat_changes).toEqual(['fire_resistance'])
})

// ── batching ──────────────────────────────────────────────────────────────────────────────────────
test('build_batches chunks at ≤30 calls/PTB', () => {
  const changed = Array.from({ length: 65 }, (_, n) => ({ key: `m${n}`, id: id(n), desired: state() }))
  const batches = build_batches(changed)
  expect(batches.map((b) => b.calls.length)).toEqual([30, 30, 5])
  expect(batches.every((b) => b.calls.length <= MAX_CALLS_PER_PTB)).toBe(true)
})

// ── THE COVERAGE TOOTH (the seat rider) ──────────────────────────────────────────────────────────
test('coverage_check passes when every ruled row is planned', () => {
  const c = coverage_check({ ruled: ['a', 'b', 'c'], planned: ['a', 'b', 'c'] })
  expect(c).toMatchObject({ ok: true, ruled_count: 3, planned_count: 3, covered_pct: 100, uncovered: [] })
})

test('coverage_check REFUSES a dropped ruled row (the vanish class)', () => {
  const c = coverage_check({ ruled: ['a', 'b', 'c'], planned: ['a', 'c'] })
  expect(c.ok).toBe(false)
  expect(c.uncovered).toEqual(['b'])
})

test('coverage_check REFUSES zero-planned against nonzero-ruled (374-rows-vanish class)', () => {
  const c = coverage_check({ ruled: ['a', 'b'], planned: [] })
  expect(c.ok).toBe(false)
  expect(c.covered_pct).toBe(0)
})

test('field_histogram splits the two-set headline (xp vs stats)', () => {
  const changed = [
    { fields: ['xp_reward'] },
    { fields: ['stats'] },
    { fields: ['xp_reward', 'stats'] },
  ]
  expect(field_histogram(changed)).toMatchObject({ xp_reward: 2, stats: 2, base_hp: 0 })
})

// ── LAW ④: the 50% resistance cap gate (spell.move:280) ───────────────────────────────────────────
const changed_row = (over) => ({ key: 'm', id: id(1), desired: state({ stats: stats(over) }) })

test('resistance_outliers FLAGS a restored resistance whose decentered magnitude exceeds the cap', () => {
  const out = resistance_outliers([changed_row({ earth_resistance: RES_SHIFT + 60 })])
  expect(out).toEqual([{ key: 'm', id: id(1), field: 'earth_resistance', magnitude: 60, cap: MAX_RESIST_MAGNITUDE }])
})

test('resistance_outliers PASSES a value exactly at the cap and a weakness (floors to 0)', () => {
  const at_cap = changed_row({ fire_resistance: RES_SHIFT + MAX_RESIST_MAGNITUDE }) // 50 == cap, not > cap
  const weakness = changed_row({ air_resistance: RES_SHIFT - 25 }) // decenters to 0
  expect(resistance_outliers([at_cap, weakness])).toEqual([])
})

test('the real corpus surfaces its over-cap authoring outlier (ramrage earthRes 55 > 50 — NEEDS-RULING)', () => {
  const dirs = require('node:fs')
    .readdirSync(join(repo_dir, 'seed', 'mainnet'))
    .filter((name) => /^\d\d_/.test(name))
  const rows = dirs.flatMap((dir) => {
    const p = join(repo_dir, 'seed', 'mainnet', dir, 'mobs.json')
    return require('node:fs').existsSync(p) ? JSON.parse(read_file(p, 'utf8')) : []
  })
  const { desired } = desired_state_by_key(rows)
  const corpus_changed = Object.entries(desired).map(([key, d]) => ({ key, id: id(1), desired: d }))
  const out = resistance_outliers(corpus_changed)
  // The mechanical assert turns "should be clean" into PROOF: exactly one authored value breaks the cap today.
  expect(out.map(({ key, field, magnitude }) => `${key}:${field}=${magnitude}`)).toEqual(['ramrage:earth_resistance=55'])
})

// ── mode + deployment ─────────────────────────────────────────────────────────────────────────────
test('resolve_mode: DRY default, LIVE=1 opens execution, LIVE≠1 throws', () => {
  expect(resolve_mode({})).toEqual({ live: false })
  expect(resolve_mode({ LIVE: '1' })).toEqual({ live: true })
  expect(() => resolve_mode({ LIVE: '0' })).toThrow(/exactly 1/)
})

test('deployment_from_release resolves latest ?? origin for both packages', () => {
  const d = deployment_from_release(release, 'testnet')
  expect(d.call_package).toBe(release.networks.testnet.packages.aresrpg.latest)
  expect(d.foundation_package).toBe(release.networks.testnet.packages.foundation.latest)
  expect(d.admin).toBe(release.networks.testnet.packages.aresrpg.admin)
  expect(d.version).toBe(release.networks.testnet.shared.VERSION.id)
})

test('deployment_from_release throws on a missing network', () => {
  expect(() => deployment_from_release(release, 'nope')).toThrow(/invalid/)
})

// ── real corpus guard ─────────────────────────────────────────────────────────────────────────────
test('the real mob corpus derives a valid xp>0 desired-tuple for every seeded key', () => {
  const seed_manifest = JSON.parse(
    read_file(join(script_dir, 'out', 'seed_manifest.json'), 'utf8'),
  )
  const dirs = require('node:fs')
    .readdirSync(join(repo_dir, 'seed', 'mainnet'))
    .filter((name) => /^\d\d_/.test(name))
  const rows = dirs.flatMap((dir) => {
    const p = join(repo_dir, 'seed', 'mainnet', dir, 'mobs.json')
    return require('node:fs').existsSync(p) ? JSON.parse(read_file(p, 'utf8')) : []
  })
  const { desired, invalid } = desired_state_by_key(rows)
  expect(invalid).toEqual([]) // every authored mob has xp>0 (mob_xp_derive ran)
  // every minted manifest mob resolves to a desired tuple (no missing_seed against the live corpus)
  const missing = Object.keys(seed_manifest.mobs ?? {}).filter((key) => !(key in desired))
  expect(missing).toEqual([])
})
