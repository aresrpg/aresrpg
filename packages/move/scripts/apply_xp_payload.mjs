// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// apply_xp_payload.mjs — apply the retuned mob STAT surface (base_hp, ap, mp, the centered Stats block, xp_reward)
// to every live MobTemplate IN PLACE via the additive `aresrpg::mob_template::set_stats` setter ("set_stats
// which takes everything for the mob, xp hp ap mp resistance"). No burn/remint — the
// template ids never change, so world mob-tables and drop refs stay valid. DRY is the default; LIVE=1 signs.
//
//   NETWORK=testnet node packages/move/scripts/apply_xp_payload.mjs            # dry-run (keyless reads only)
//   NETWORK=testnet LIVE=1 node packages/move/scripts/apply_xp_payload.mjs     # execute (CLI keystore signer)
//
// SHAPE mirrors apply_mob_distance_payload.mjs (release-derived deployment, per-batch PTBs, no-retry runner) and
// the FALLBACK lane's client-injected pure helpers (mob_xp_reauthor_plan.mjs on lane/mob-reauthor: to_xp /
// seed_xp_by_key / diff_mob_xp / fetch_chain_xp). That lane is xp-ONLY (reads/diffs only xp_reward); this setter
// covers FIVE fields, so its read+diff layer is a strict SUPERSET rebuilt here (not imported — a cross-lane path
// import would collide when both land). When lane/mob-reauthor merges, the xp-only plan is a subset of this one.
//
// THE SEED→STATS MAPPING (the correction — cite both sides):
//   • seed keys  : seed/mainnet/<world>/mobs.json `stats` uses camelCase resistances `fireRes|waterRes|earthRes|
//                  airRes` (majority) with a snake_case minority `*_resistance`; attributes `str|int|chance|
//                  agility|raw|crit|range`.
//   • struct     : foundation `spell::Stats` fields `fire_resistance|…|air_resistance` (mob convention: stored
//                  CENTERED at 32768 — a weakness is <32768), `strength|intelligence|…`.
//   • the ORIGINAL seeder (seed_full_corpus.mjs `mobStats`, ~L425) read ONLY the snake_case resistance keys, so
//     every camelCase-resistance mob was minted NEUTRAL (all four = 32768). This mapping reads BOTH schemas, so
//     `set_stats` CORRECTS those dropped resistances corpus-wide (verified on-chain 2026-07-20: chain neutral,
//     seed authored). `vitality`/`wisdom` in the seed are NOT projected — `new_stats` has no slot (identical to
//     mint); mob combat reads base_hp/ap/mp directly, so this matches on-chain (both 0) and never inflates a diff.
import { readFileSync as read_file, readdirSync as read_dir, existsSync as exists } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import { Transaction } from '@mysten/sui/transactions'

import release from '../../sdk/src/deployment/release.json' with { type: 'json' }

import { getClient as get_client } from './ceremony_lib.mjs'
import {
  MOB_RESISTANCE_FIELDS as RESISTANCE_FIELDS,
  MOB_STAT_FIELDS as STAT_FIELDS,
  normalize_seed_mob_stats,
} from './seed_mob_stats.mjs'

export { RESISTANCE_FIELDS, STAT_FIELDS }

const script_dir = dirname(file_url_to_path(import.meta.url))
const repo_dir = resolve(script_dir, '..', '..', '..')
const read_json = (file_path) => JSON.parse(read_file(file_path, 'utf8'))

// ── constants ───────────────────────────────────────────────────────────────────────────────────
export const RES_SHIFT = 32768 // foundation spell::RES_SHIFT — mob resistances stored centered
export const MAX_RESIST_MAGNITUDE = 60 // the SPEC §7.4 / S4-2 real-time cap (ruled 50 → 60 on 2026-07-23) —
// combat clamps at foundation `spell::apply_resistance`, which is the ONE home of this number; this constant
// mirrors it and must be re-derived from that function whenever the ruling moves (cite the SYMBOL, never a
// line number — two citations here have already rotted). The DECENTERED magnitude a restored resistance
// decodes to (centered − RES_SHIFT; a weakness floors to 0) must not exceed it (law ④).
export const MAX_CALLS_PER_PTB = 30 // ≤30 set_stats calls per batch (each expands to new_stats + set_stats)
export const GAS_BUDGET_MIST = 50_000_000 // fixed 0.05 SUI/PTB: the post-upgrade target isn't
// simulatable pre-ceremony, and Sui charges ACTUAL — a high fixed budget is safe, only a LOW one burns (D747 shape).
export const READ_PAGE = 50

// The 11 fields new_stats zeroes (§5h/D149/D172 appends). A template only ever carries these = 0 (mint uses
// new_stats; nothing buffs a template), so set_stats via new_stats preserves them. A NON-ZERO one on chain would
// be silently lost → we refuse (read_failed) rather than zero it.
export const STAT_APPENDED = [
  'percent_damage', 'physical_damage', 'wisdom', 'flat_resist', 'neutral_resistance',
  'ap_dodge', 'mp_dodge', 'heal', 'ap_bonus', 'mp_bonus', 'vitality',
]

const is_id = (value) => /^0x[0-9a-f]{64}$/i.test(value ?? '')

// ── pure helpers (exported, side-effect-free — fixture-tested) ────────────────────────────────────

/** gRPC json u64 arrives as number|string; seed values are numbers. Normalize to a non-negative safe int (throw
 * on invalid — a caller decides whether that is an invalid seed row or an unreadable object). */
export function to_u64(value) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0)
    throw new Error(`u64 ${JSON.stringify(value)} is not a non-negative safe integer`)
  return number
}

/** A seed `stats` object → the 11 canonical centered `Stats` fields. The shared full-seed boundary collapses
 * historical aliases into the chain's single snake_case vocabulary; this correction plan consumes that same
 * payload. Throws if a field cannot be represented as u64. */
export const seed_stats_to_centered = (stats) => {
  const normalized = normalize_seed_mob_stats(stats, RES_SHIFT)
  return Object.fromEntries(STAT_FIELDS.map((field) => [field, to_u64(normalized[field])]))
}

/** seed mob rows → key → desired 5-tuple {base_hp, ap, mp, stats(11 centered), xp_reward}. First-wins on dup keys
 * (corpus-dedupe parity with mob_distance/seed_full_corpus); a dup with a DIFFERENT desired is surfaced, never
 * merged. Mirrors seed_full_corpus defaults (hp??30, ap??6, mp??3) and `mob_xp_required` (xp>0, no fallback). */
export function desired_state_by_key(mob_rows) {
  const desired = {}
  const invalid = []
  const duplicates = []
  for (const row of mob_rows ?? []) {
    const key = row?.key ?? null
    if (!key) { invalid.push({ key, why: 'row missing key' }); continue }
    let state
    try {
      const xp_reward = to_u64(row.xp)
      if (xp_reward <= 0) { invalid.push({ key, why: 'xp must be > 0 (no linear-20 fallback)' }); continue }
      state = {
        base_hp: to_u64(row.hp ?? 30),
        ap: to_u64(row.ap ?? 6),
        mp: to_u64(row.mp ?? 3),
        stats: seed_stats_to_centered(row.stats),
        xp_reward,
      }
    } catch (error) { invalid.push({ key, why: error.message }); continue }
    if (key in desired) {
      if (JSON.stringify(desired[key]) !== JSON.stringify(state))
        duplicates.push({ key, kept: desired[key], ignored: state })
      continue
    }
    desired[key] = state
  }
  return { desired, invalid, duplicates }
}

/** Read the full tunable state off a mob-template gRPC json (fields top-level; `.fields` fallback). Returns null
 * on absent/malformed base fields OR a NON-ZERO appended stat (unpreservable via new_stats → never silently
 * zero it; the caller buckets null as read_failed and refuses to touch it). */
export function read_template_state(template_json) {
  if (!template_json || typeof template_json !== 'object') return null
  const fields = template_json.fields ?? template_json
  const raw_stats = fields.stats?.fields ?? fields.stats
  if (fields.base_hp == null || fields.ap == null || fields.mp == null || fields.xp_reward == null || raw_stats == null)
    return null
  try {
    for (const field of STAT_APPENDED) if (to_u64(raw_stats[field] ?? 0) !== 0) return null
    const stats = {}
    for (const field of STAT_FIELDS) stats[field] = to_u64(raw_stats[field])
    return {
      base_hp: to_u64(fields.base_hp),
      ap: to_u64(fields.ap),
      mp: to_u64(fields.mp),
      stats,
      xp_reward: to_u64(fields.xp_reward),
    }
  } catch { return null }
}

/** The changed FIELDS between a chain state and a desired state — [] when byte-identical. `stats` counts as one
 * field (the whole block is re-sent atomically); a stats diff also records which elements moved (for the report). */
export function state_field_diff(current, desired) {
  const fields = []
  for (const field of ['base_hp', 'ap', 'mp', 'xp_reward'])
    if (current[field] !== desired[field]) fields.push(field)
  const stat_changes = STAT_FIELDS.filter((f) => current.stats[f] !== desired.stats[f])
  if (stat_changes.length) fields.push('stats')
  return { fields, stat_changes }
}

/** The pure 5-field diff both the DRY report and the LIVE plan consume. Buckets mirror the fallback lane:
 *   changed      any field differs → {key, id, fields, stat_changes, from, to, desired}  (the ceremony work set)
 *   unchanged    byte-identical                                                          (rerun ⇒ all here = idempotent)
 *   read_failed  invalid id / unreadable / non-zero appended stat                        (LIVE blocker)
 *   missing_seed manifest key absent from the seed                                       (LIVE blocker)
 * Keys are taken SORTED off the manifest so `limit` (a canary) trims deterministically. */
export function diff_mob_state({ manifest_mobs, desired_by_key, chain_by_id, limit = null }) {
  const all_keys = Object.keys(manifest_mobs ?? {}).sort()
  const keys = limit == null ? all_keys : all_keys.slice(0, Math.max(0, limit))
  const changed = []
  const unchanged = []
  const read_failed = []
  const missing_seed = []
  for (const key of keys) {
    const id = manifest_mobs[key]?.id
    if (!is_id(id)) { read_failed.push({ key, id: id ?? null, why: 'invalid manifest id' }); continue }
    const current = chain_by_id?.[id]
    if (current == null) { read_failed.push({ key, id, why: 'template state unreadable on chain' }); continue }
    const desired = desired_by_key?.[key]
    if (!desired) { missing_seed.push({ key, id }); continue }
    const { fields, stat_changes } = state_field_diff(current, desired)
    if (!fields.length) { unchanged.push({ key, id }); continue }
    const from = {}
    const to = {}
    for (const field of fields) {
      if (field === 'stats') {
        from.stats = Object.fromEntries(stat_changes.map((f) => [f, current.stats[f]]))
        to.stats = Object.fromEntries(stat_changes.map((f) => [f, desired.stats[f]]))
      } else { from[field] = current[field]; to[field] = desired[field] }
    }
    changed.push({ key, id, fields, stat_changes, from, to, desired })
  }
  return { total: keys.length, changed, unchanged, read_failed, missing_seed }
}

/** Chunk the changed set into ≤max_calls-per-PTB batches (each carries {key, id, desired}). */
export function build_batches(changed, max_calls = MAX_CALLS_PER_PTB) {
  const batches = []
  for (let index = 0; index < changed.length; index += max_calls) {
    const rows = changed.slice(index, index + max_calls)
    batches.push({
      label: `mob_stats:${index / max_calls + 1}`,
      calls: rows.map(({ key, id, desired }) => ({ key, id, desired })),
    })
  }
  return batches
}

/** THE COVERAGE TOOTH (seat rider 2026-07-20). Ruled = the changed-set keys; planned = keys that reached a batch.
 * ANY ruled key not planned — or zero planned against nonzero ruled — is the exact "374 rows vanished invisibly"
 * class: return ok=false + the uncovered list so the caller REFUSES loudly (never a silent zero-drift). */
export function coverage_check({ ruled, planned }) {
  const planned_set = new Set(planned)
  const uncovered = ruled.filter((key) => !planned_set.has(key))
  const covered_pct = ruled.length === 0 ? 100 : Math.round(((ruled.length - uncovered.length) / ruled.length) * 100)
  return {
    ruled_count: ruled.length,
    planned_count: planned.length,
    covered_pct,
    uncovered,
    ok: uncovered.length === 0 && !(ruled.length > 0 && planned.length === 0),
  }
}

/** Per-field ruled counts for the DRY report (the two-set headline: xp set + resistance/stats set). */
export function field_histogram(changed) {
  const hist = { base_hp: 0, ap: 0, mp: 0, xp_reward: 0, stats: 0 }
  for (const row of changed) for (const field of row.fields) hist[field] += 1
  return hist
}

/** LAW ④ CAP GATE. Every RESTORED resistance (the desired value each planned set_stats writes) must decode to a
 * magnitude ≤ MAX_RESIST_MAGNITUDE — the SPEC §7.4 / foundation `spell::apply_resistance` real-time cap. Decenter each of
 * the 4 elementals (centered − RES_SHIFT; a weakness < RES_SHIFT floors to 0, exactly as `apply_resistance`
 * reads it) and collect any that exceed the cap. A NON-EMPTY return is a NEEDS-RULING refusal — never silently
 * applied (a value over the cap is meaningless in combat AND an authoring error the ceremony must not bake in). */
export function resistance_outliers(changed, cap = MAX_RESIST_MAGNITUDE) {
  const outliers = []
  for (const row of changed ?? [])
    for (const field of RESISTANCE_FIELDS) {
      const centered = row.desired.stats[field]
      const magnitude = centered >= RES_SHIFT ? centered - RES_SHIFT : 0
      if (magnitude > cap) outliers.push({ key: row.key, id: row.id, field, magnitude, cap })
    }
  return outliers
}

export function resolve_mode(environment) {
  if (environment.LIVE != null && environment.LIVE !== '1') throw new Error('LIVE must be exactly 1 when set')
  return { live: environment.LIVE === '1' }
}

/** Release-derived call targets. `latest ?? origin` for BOTH packages: set_stats resolves through aresrpg's
 * post-upgrade LATEST (mirrors mob_distance `aresrpg.latest`; the `?? origin` fallback mirrors shop's gifting
 * resolution), and the Stats value is built at foundation's LATEST (new_stats lives there). */
export function deployment_from_release(release_config, network) {
  const network_release = release_config.networks?.[network]
  const ares = network_release?.packages?.aresrpg
  const foundation = network_release?.packages?.foundation
  const deployment = {
    call_package: ares?.latest ?? ares?.origin,
    foundation_package: foundation?.latest ?? foundation?.origin,
    admin: ares?.admin,
    version: network_release?.shared?.VERSION?.id,
    network,
  }
  for (const [field, value] of Object.entries(deployment))
    if (field !== 'network' && !is_id(value))
      throw new Error(`release.json has invalid ${field} id (network=${network})`)
  return deployment
}

// ── impure edges ──────────────────────────────────────────────────────────────────────────────────

/** Every seed/mainnet/<world>/mobs.json flattened in sorted-world order (dedup is first-wins in desired_state). */
export function load_mob_rows(seed_dir) {
  const rows = []
  for (const dir of read_dir(seed_dir).filter((name) => /^\d\d_/.test(name)).sort()) {
    const mobs_path = join(seed_dir, dir, 'mobs.json')
    if (exists(mobs_path)) rows.push(...read_json(mobs_path))
  }
  return rows
}

/** Batched gRPC read of the full tunable state for a list of template ids (client INJECTED). id → state|null. */
export async function fetch_chain_state(client, ids, page_size = READ_PAGE) {
  const state = {}
  for (let index = 0; index < ids.length; index += page_size) {
    const page = ids.slice(index, index + page_size)
    const { objects } = await client.getObjects({ objectIds: page, include: { json: true } })
    objects.forEach((object, page_index) => {
      state[page[page_index]] = object instanceof Error ? null : read_template_state(object?.json ?? null)
    })
  }
  return state
}

/** One set_stats command: build the centered Stats at foundation LATEST, then set it on the shared template. */
function set_stats_command(tx, deployment, call) {
  const stats_arg = tx.moveCall({
    target: `${deployment.foundation_package}::spell::new_stats`,
    arguments: STAT_FIELDS.map((field) => tx.pure.u64(BigInt(call.desired.stats[field]))),
  })
  tx.moveCall({
    target: `${deployment.call_package}::mob_template::set_stats`,
    arguments: [
      tx.object(deployment.admin),
      tx.object(deployment.version),
      tx.object(call.id),
      tx.pure.u64(BigInt(call.desired.base_hp)),
      tx.pure.u64(BigInt(call.desired.ap)),
      tx.pure.u64(BigInt(call.desired.mp)),
      stats_arg,
      tx.pure.u64(BigInt(call.desired.xp_reward)),
    ],
  })
}

export function batch_tx(deployment, batch) {
  const tx = new Transaction()
  for (const call of batch.calls) set_stats_command(tx, deployment, call)
  return tx
}

function sample_line(row) {
  const parts = row.fields.map((field) =>
    field === 'stats'
      ? row.stat_changes.map((f) => `${f} ${row.from.stats[f]}→${row.to.stats[f]}`).join(' ')
      : `${field} ${row.from[field]}→${row.to[field]}`,
  )
  return `  ${row.key} [${row.id.slice(0, 10)}…] ${parts.join(' · ')}`
}

async function main() {
  const mode = resolve_mode(process.env)
  const network = process.env.NETWORK ?? 'testnet'
  const seed_manifest = read_json(join(script_dir, 'out', 'seed_manifest.json'))
  const manifest_mobs = seed_manifest.mobs ?? {}
  const { desired, invalid, duplicates } = desired_state_by_key(load_mob_rows(join(repo_dir, 'seed', 'mainnet')))
  const deployment = deployment_from_release(release, network)

  const ids = Object.keys(manifest_mobs).sort().map((key) => manifest_mobs[key]?.id).filter(is_id)
  const client = get_client(network)
  const chain_by_id = await fetch_chain_state(client, ids)
  const limit = process.env.LIMIT ? Number(process.env.LIMIT) : null
  const diff = diff_mob_state({ manifest_mobs, desired_by_key: desired, chain_by_id, limit })

  const batches = build_batches(diff.changed)
  const planned = batches.flatMap((batch) => batch.calls.map((call) => call.key))
  const coverage = coverage_check({ ruled: diff.changed.map((row) => row.key), planned })
  const hist = field_histogram(diff.changed)
  const outliers = resistance_outliers(diff.changed)

  console.log(`=== MOB STAT PAYLOAD | ${mode.live ? 'LIVE' : 'DRY-RUN'} | network=${network} ===`)
  console.log(`package=${deployment.call_package} foundation=${deployment.foundation_package}`)
  console.log(
    `census: ${diff.total} manifest mobs · ${diff.changed.length} changed · ${diff.unchanged.length} unchanged · ` +
      `${diff.read_failed.length} read_failed · ${diff.missing_seed.length} missing_seed · ` +
      `${invalid.length} invalid_seed · ${duplicates.length} dup_seed`,
  )
  console.log(
    `fields (mobs differing per field): xp=${hist.xp_reward} hp=${hist.base_hp} ap=${hist.ap} mp=${hist.mp} stats=${hist.stats}`,
  )
  console.log(`coverage-report: ruled=${coverage.ruled_count} planned=${coverage.planned_count} covered=${coverage.covered_pct}%`)
  console.log(
    `resistance-cap: ≤${MAX_RESIST_MAGNITUDE} decentered magnitude (spell::apply_resistance) · outliers=${outliers.length}`,
  )
  console.log(`batches: ${batches.length} (≤${MAX_CALLS_PER_PTB}/PTB) · fixed gas=${GAS_BUDGET_MIST} MIST/PTB`)
  console.log('samples (old→new):')
  for (const row of diff.changed.slice(0, 5)) console.log(sample_line(row))

  // THE COVERAGE TOOTH + integrity blockers — LOUD refusal, never a silent zero-drift or a partial-read LIVE run.
  if (!coverage.ok)
    throw new Error(
      `COVERAGE GAP — ${coverage.uncovered.length} ruled row(s) not planned: ${coverage.uncovered.slice(0, 20).join(', ')}` +
        (coverage.ruled_count > 0 && coverage.planned_count === 0 ? ' (ZERO planned against nonzero ruled)' : ''),
    )
  if (outliers.length) {
    console.error(
      `\nNEEDS-RULING — ${outliers.length} restored resistance(s) exceed the ${MAX_RESIST_MAGNITUDE}% cap (spell::apply_resistance):`,
    )
    for (const o of outliers) console.error(`  ${o.key} [${o.id.slice(0, 10)}…] ${o.field} magnitude=${o.magnitude} > ${o.cap}`)
    throw new Error(
      `${outliers.length} over-cap resistance(s) — refusing to apply an out-of-SPEC value (fix the seed to ≤${MAX_RESIST_MAGNITUDE} or rule it). NEVER silently applied.`,
    )
  }
  const blockers = [...diff.read_failed, ...diff.missing_seed, ...invalid, ...duplicates]
  if (blockers.length)
    throw new Error(
      `INTEGRITY BLOCKERS — ${diff.read_failed.length} read_failed, ${diff.missing_seed.length} missing_seed, ` +
        `${invalid.length} invalid_seed, ${duplicates.length} dup_seed. First: ${JSON.stringify(blockers.slice(0, 5))}`,
    )

  if (!batches.length) { console.log('=== ALREADY CONVERGED (0 changes) ==='); return }
  if (!mode.live) { console.log('=== DRY-RUN COMPLETE (nothing signed) ==='); return }

  const { getSigner } = await import('./ceremony_lib.mjs')
  const { run } = await import('./ceremony_lib.mjs')
  const signer = getSigner()
  console.log(`signer ${signer.getPublicKey().toSuiAddress()} (CLI keystore)`)
  for (const batch of batches) {
    const tx = batch_tx(deployment, batch)
    tx.setGasBudget(GAS_BUDGET_MIST) // fixed budget — run(derive:false) signs with it, throws on executed failure
    await run(client, signer, batch.label, tx, { derive: false })
  }
  console.log('=== MOB STAT PAYLOAD APPLIED ===')
}

const is_main = process.argv[1] && resolve(process.argv[1]) === file_url_to_path(import.meta.url)
if (is_main)
  main().catch((error) => {
    console.error(`\nMOB STAT PAYLOAD STOPPED: ${error.message}`)
    console.error('No automatic retry was attempted (a digest = gas burned — the tx-retry-burn law).')
    process.exitCode = 1
  })
