// apply_loot_payload.mjs — apply the seed-authored LOOT TABLE to every live MobTemplate IN PLACE via the
// additive `aresrpg::mob_template::set_loot` setter (ceremony-1's 988 loot edits AND
// the wool-floor NEVER reached chain — `MobTemplate.loot` still serves MINT-TIME rates; no setter existed).
// No burn/remint — the template ids never change, so world mob-tables and drop refs stay valid. DRY is the
// default; LIVE=1 signs.
//
//   NETWORK=testnet node packages/move/scripts/apply_loot_payload.mjs            # dry-run (keyless reads only)
//   NETWORK=testnet LIVE=1 node packages/move/scripts/apply_loot_payload.mjs     # execute (CLI keystore signer)
//
// SIBLING to apply_xp_payload.mjs (the STAT surface: hp/ap/mp/Stats/xp). Kept a SEPARATE script — not a leg of
// the xp one — because (a) loot is command-DENSE (each set_loot expands to ≤16 new_loot_entry + a makeMoveVec +
// set_loot ≈ 18 PTB commands, vs set_stats' 2), so it batches at a different width; (b) folding both into one
// file breaches the 600-LoC cap and couples loot's fate to a just-shipped stat script. ONE ceremony RUN covers
// both by sequencing the two scripts (the lead: stats leg, then loot leg). They share only ceremony_lib.mjs
// (client/signer/run) — the read+diff+gate layer is rebuilt here (house pattern: ceremony scripts are peers,
// not libs of each other; a cross-script import collides on shared export names).
//
// THE SEED→LOOT MAPPING (mirrors seed_full_corpus.mjs PHASE 5, cite both sides):
//   • seed rows   : seed/mainnet/<world>/mobs.json `loot` = [{ item(slug), chance(0..1 float), min, max }, …].
//   • constructor : aresrpg_fight::mob::new_loot_entry(item_template: ID, chance_bp: u16, min_qty: u16,
//                   max_qty: u16) — `set_loot` receives `vector<MobLootEntry>`, mint's exact input shape.
//   • slug→id     : seed_manifest.json `items` map (slug → minted template id) — the SAME map seed_full_corpus
//                   resolved loot through (`OUT.items[l.item]`, seed_full_corpus.mjs:910). An unresolvable slug
//                   is a REFUSAL (an item the mob's loot references that was never minted = the class that
//                   minted wrong) — NEVER a silent skip (the seeder skipped at mint; a re-author must not).
//   • chance→bp   : `bp(rate) = min(10000, max(0, round(rate*10000)))` (seed_full_corpus.mjs:458) — 0.5→5000.
//   • cap         : `.slice(0, 16)` then resolve (MAX_LOOT = 16, mob_template.move / mob.move) — seeder:836.
//   • the chain does NOT validate rate/qty (new_loot_entry/mint assert ONLY the ≤16 count) — so a rate/qty
//     sanity gate lives HERE (0<bp≤10000, min≥1, min≤max): an out-of-spec authored value is a NEEDS-RULING
//     refusal, never silently applied (the resistance_outliers precedent in apply_xp_payload.mjs).
import { readFileSync as read_file, readdirSync as read_dir, existsSync as exists } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import { Transaction } from '@mysten/sui/transactions'

import release from '../../sdk/src/deployment/release.json' with { type: 'json' }

import { getClient as get_client } from './ceremony_lib.mjs'

const script_dir = dirname(file_url_to_path(import.meta.url))
const repo_dir = resolve(script_dir, '..', '..', '..')
const read_json = (file_path) => JSON.parse(read_file(file_path, 'utf8'))

// ── constants ───────────────────────────────────────────────────────────────────────────────────
export const MAX_LOOT = 16 // §17.14 loot entries per mob template (mob_template.move / mob.move MAX_LOOT)
export const MAX_CHANCE_BP = 10000 // 100% in basis points — the seeder's bp() clamp ceiling (seed_full_corpus:459)
export const MAX_U16 = 65535
export const MAX_MOBS_PER_PTB = 20 // ≤20 set_loot/PTB: each expands to ≤16 new_loot_entry + makeMoveVec + set_loot
// ≈18 cmds → ≤360 cmds/PTB, wide margin under Sui's 1024-command PTB cap (apply_xp's 30 set_stats = 60 cmds; loot
// is ~9× denser per call, so the width drops from 30 to 20 to keep the same safety headroom).
export const GAS_BUDGET_MIST = 50_000_000 // fixed 0.05 SUI/PTB (D747 shape — the post-upgrade target isn't
// simulatable pre-ceremony; Sui charges ACTUAL, so a high fixed budget is safe, only a LOW one burns).
export const READ_PAGE = 50

const is_id = (value) => /^0x[0-9a-f]{64}$/i.test(value ?? '')
const lc_id = (value) => String(value ?? '').toLowerCase()

// ── pure helpers (exported, side-effect-free — fixture-tested) ────────────────────────────────────

/** A non-negative safe int in [0, MAX_U16] (u16 domain) or throw — a caller decides invalid-seed vs unreadable. */
export function to_u16(value, what = 'u16') {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0 || number > MAX_U16)
    throw new Error(`${what} ${JSON.stringify(value)} is not an integer in [0, ${MAX_U16}]`)
  return number
}

/** UNCLAMPED basis points: round(rate*10000). Kept separate from the clamped plan value so the rate gate can
 * SEE an out-of-range authored rate (e.g. 1.5 → 15000) instead of the clamp hiding it at 10000. */
export function raw_chance_bp(chance) {
  return Math.round((chance ?? 0) * 10000)
}

/** The PLANNED basis points — the seeder's exact bp() (clamp to [0, 10000]), so `desired` byte-matches what a
 * re-mint would build. seed_full_corpus.mjs:458-459. */
export function to_chance_bp(chance) {
  return Math.min(MAX_CHANCE_BP, Math.max(0, raw_chance_bp(chance)))
}

/** One seed loot row → a desired entry {item_template, chance_bp, min_qty, max_qty, slug, chance}. Throws with a
 * typed reason on an unresolvable slug (caller buckets it as `unresolved`) or a non-u16 qty (invalid). `chance`
 * (the raw seed float) rides along for the spot-agreement table. */
export function seed_loot_entry(row, items_map) {
  const slug = row?.item ?? null
  const id = slug == null ? null : items_map?.[slug]
  if (!is_id(id)) { const e = new Error(`unminted loot item '${slug}'`); e.unresolved = slug; throw e }
  return {
    item_template: lc_id(id),
    chance_bp: to_chance_bp(row.chance),
    min_qty: to_u16(row.min ?? 1, 'min_qty'),
    max_qty: to_u16(row.max ?? 1, 'max_qty'),
    slug,
    chance: row.chance ?? 0,
  }
}

/** seed mob rows → key → desired loot vector (≤16 resolved entries, seed order — the exact vector a re-mint
 * builds). First-wins on dup keys (corpus-dedupe parity with seed_full_corpus); a dup with a DIFFERENT desired
 * is surfaced, never merged. An unresolvable slug puts the WHOLE mob in `unresolved` (no partial desired — a
 * silent drop is the class that minted wrong). A non-u16 qty puts it in `invalid`. */
export function desired_loot_by_key(mob_rows, items_map) {
  const desired = {}
  const unresolved = []
  const invalid = []
  const duplicates = []
  for (const row of mob_rows ?? []) {
    const key = row?.key ?? null
    if (!key) { invalid.push({ key, why: 'row missing key' }); continue }
    let entries
    try {
      entries = (row.loot ?? []).slice(0, MAX_LOOT).map((l) => seed_loot_entry(l, items_map))
    } catch (error) {
      if (error.unresolved != null) unresolved.push({ key, slug: error.unresolved })
      else invalid.push({ key, why: error.message })
      continue
    }
    if (key in desired) {
      if (JSON.stringify(desired[key]) !== JSON.stringify(entries))
        duplicates.push({ key, kept: desired[key], ignored: entries })
      continue
    }
    desired[key] = entries
  }
  return { desired, unresolved, invalid, duplicates }
}

/** Read the loot vector off a mob-template gRPC json → [{item_template(lc), chance_bp, min_qty, max_qty}] | null.
 * Fields are top-level (`.fields` fallback); each entry likewise (`el.fields ?? el`). null on absent/malformed
 * (the caller buckets null as read_failed and refuses to touch it — never a blind overwrite of an unreadable row). */
export function read_template_loot(template_json) {
  if (!template_json || typeof template_json !== 'object') return null
  const fields = template_json.fields ?? template_json
  const rows = fields.loot?.fields ?? fields.loot
  if (!Array.isArray(rows)) return null
  try {
    return rows.map((entry) => {
      const f = entry?.fields ?? entry
      if (f == null || typeof f !== 'object') throw new Error('malformed loot entry')
      if (!is_id(f.item_template)) throw new Error('loot entry missing item_template id')
      return {
        item_template: lc_id(f.item_template),
        chance_bp: to_u16(f.chance_bp, 'chance_bp'),
        min_qty: to_u16(f.min_qty, 'min_qty'),
        max_qty: to_u16(f.max_qty, 'max_qty'),
      }
    })
  } catch { return null }
}

/** Whether two loot vectors are byte-identical: same length AND each position's {id, bp, min, max} equal. Loot is
 * a VECTOR (order-bearing) — the mint built it in seed order, so a position-wise compare is the on-chain truth. */
export function loot_entries_equal(current, desired) {
  if (current.length !== desired.length) return false
  return current.every((c, index) => {
    const d = desired[index]
    return c.item_template === d.item_template && c.chance_bp === d.chance_bp &&
      c.min_qty === d.min_qty && c.max_qty === d.max_qty
  })
}

/** A readable per-mob change description (for the DRY sample line): +NEW / removed / bp·qty moves, by slug. */
export function describe_loot_change(current, desired, slug_by_id) {
  const name = (id) => slug_by_id?.[id] ?? `${id.slice(0, 10)}…`
  const cur_by_id = new Map(current.map((e) => [e.item_template, e]))
  const des_by_id = new Map(desired.map((e) => [e.item_template, e]))
  const parts = []
  for (const d of desired) {
    const c = cur_by_id.get(d.item_template)
    if (!c) parts.push(`${name(d.item_template)} +NEW@${d.chance_bp}`)
    else if (c.chance_bp !== d.chance_bp) parts.push(`${name(d.item_template)} ${c.chance_bp}→${d.chance_bp}`)
    else if (c.min_qty !== d.min_qty || c.max_qty !== d.max_qty)
      parts.push(`${name(d.item_template)} qty ${c.min_qty}-${c.max_qty}→${d.min_qty}-${d.max_qty}`)
  }
  for (const c of current) if (!des_by_id.has(c.item_template)) parts.push(`${name(c.item_template)} -removed`)
  return parts
}

/** The pure diff both the DRY report and the LIVE plan consume. Buckets mirror apply_xp_payload:
 *   changed      loot vector differs → {key, id, desired, current, from_count, to_count}   (the work set)
 *   unchanged    byte-identical                                                            (rerun ⇒ idempotent)
 *   read_failed  invalid id / unreadable loot vector                                       (LIVE blocker)
 *   missing_seed manifest key absent from the seed (and NOT an unresolved-slug key)         (LIVE blocker)
 *   unresolved   manifest key whose seed loot references an unminted item                   (LIVE blocker)
 * Keys taken SORTED off the manifest so `limit` (a canary) trims deterministically. */
export function diff_mob_loot({ manifest_mobs, desired_by_key, chain_by_id, unresolved_keys = new Set(), limit = null }) {
  const all_keys = Object.keys(manifest_mobs ?? {}).sort()
  const keys = limit == null ? all_keys : all_keys.slice(0, Math.max(0, limit))
  const changed = []
  const unchanged = []
  const read_failed = []
  const missing_seed = []
  const unresolved = []
  for (const key of keys) {
    const id = manifest_mobs[key]?.id
    if (!is_id(id)) { read_failed.push({ key, id: id ?? null, why: 'invalid manifest id' }); continue }
    const current = chain_by_id?.[id]
    if (current == null) { read_failed.push({ key, id, why: 'loot vector unreadable on chain' }); continue }
    const desired = desired_by_key?.[key]
    if (!desired) {
      if (unresolved_keys.has(key)) unresolved.push({ key, id })
      else missing_seed.push({ key, id })
      continue
    }
    if (loot_entries_equal(current, desired)) { unchanged.push({ key, id }); continue }
    changed.push({ key, id, desired, current, from_count: current.length, to_count: desired.length })
  }
  return { total: keys.length, changed, unchanged, read_failed, missing_seed, unresolved }
}

/** Chunk the changed set into ≤max-mobs-per-PTB batches (each call carries {key, id, desired}). */
export function build_batches(changed, max_mobs = MAX_MOBS_PER_PTB) {
  const batches = []
  for (let index = 0; index < changed.length; index += max_mobs) {
    const rows = changed.slice(index, index + max_mobs)
    batches.push({
      label: `mob_loot:${index / max_mobs + 1}`,
      calls: rows.map(({ key, id, desired }) => ({ key, id, desired })),
    })
  }
  return batches
}

/** THE COVERAGE TOOTH (seat rider 2026-07-20). Ruled = the changed-set keys; planned = keys that reached a batch.
 * ANY ruled key not planned — or zero planned against nonzero ruled — is the "374 rows vanished invisibly" class:
 * ok=false + the uncovered list so the caller REFUSES loudly (never a silent zero-drift). */
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

/** THE RATE/QTY GATE (seat rider ① + the mirror-the-law class). Every PLANNED loot entry must satisfy
 * 0 < chance_bp ≤ 10000 (a 0% or clamped-from->100% rate is meaningless in combat AND an authoring error) and
 * 1 ≤ min_qty ≤ max_qty. Checks the RAW (unclamped) bp so a >1 seed rate surfaces instead of hiding at the clamp.
 * A NON-EMPTY return is a NEEDS-RULING refusal — never silently applied. */
export function loot_rate_outliers(changed) {
  const outliers = []
  for (const row of changed ?? [])
    for (const entry of row.desired) {
      const raw_bp = raw_chance_bp(entry.chance)
      if (!(raw_bp > 0 && raw_bp <= MAX_CHANCE_BP))
        outliers.push({ key: row.key, id: row.id, slug: entry.slug, why: `chance_bp ${raw_bp} out of (0, ${MAX_CHANCE_BP}]` })
      else if (!(entry.min_qty >= 1 && entry.min_qty <= entry.max_qty))
        outliers.push({ key: row.key, id: row.id, slug: entry.slug, why: `qty ${entry.min_qty}-${entry.max_qty} (need 1 ≤ min ≤ max)` })
    }
  return outliers
}

/** SPOT-AGREEMENT (seat rider ②). For the sampled planned mobs, RE-DERIVE each entry's basis points from the raw
 * seed chance and assert it matches the planned chance_bp (a mapping-bug tripwire — desired is built from seed,
 * so a disagreement means a transform bug). Returns table rows the DRY prints so the gate reads AGREEMENT, not
 * adjectives. `sample_keys` is honored in order; wooling is threaded in by the caller. */
export function loot_spot_agreement(changed, sample_keys) {
  const by_key = new Map(changed.map((row) => [row.key, row]))
  const rows = []
  for (const key of sample_keys) {
    const row = by_key.get(key)
    if (!row) continue
    for (const entry of row.desired) {
      const expect_bp = to_chance_bp(entry.chance)
      rows.push({
        key,
        slug: entry.slug,
        chance: entry.chance,
        planned_bp: entry.chance_bp,
        expect_bp,
        min_qty: entry.min_qty,
        max_qty: entry.max_qty,
        agree: entry.chance_bp === expect_bp,
      })
    }
  }
  return rows
}

export function resolve_mode(environment) {
  if (environment.LIVE != null && environment.LIVE !== '1') throw new Error('LIVE must be exactly 1 when set')
  return { live: environment.LIVE === '1' }
}

/** Release-derived call targets. set_loot resolves through aresrpg's post-upgrade LATEST; the entries are built
 * with `aresrpg_fight::mob::new_loot_entry` at the ENGINE package's LATEST (release.json keys the fight package
 * as `engine`; ceremony_lib.mjs:835 `M.fight = M.engine`). The MobLootEntry TYPE TAG for makeMoveVec uses the
 * engine ORIGIN — types canonicalize to their defining (first-published) id, never the upgraded one
 * (seed_full_corpus.mjs:80 `T.loot = FIGHT.pkg`, TYPE TAGS stay on the origin). `latest ?? origin` for the call
 * targets mirrors the seeder's CALL() resolution. */
export function deployment_from_release(release_config, network) {
  const network_release = release_config.networks?.[network]
  const ares = network_release?.packages?.aresrpg
  const engine = network_release?.packages?.engine
  const deployment = {
    call_package: ares?.latest ?? ares?.origin,
    fight_package: engine?.latest ?? engine?.origin,
    fight_type_package: engine?.origin,
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

/** Every seed/mainnet/<world>/mobs.json flattened in sorted-world order (dedup is first-wins in desired_loot). */
export function load_mob_rows(seed_dir) {
  const rows = []
  for (const dir of read_dir(seed_dir).filter((name) => /^\d\d_/.test(name)).sort()) {
    const mobs_path = join(seed_dir, dir, 'mobs.json')
    if (exists(mobs_path)) rows.push(...read_json(mobs_path))
  }
  return rows
}

/** Batched gRPC read of the loot vector for a list of template ids (client INJECTED). id → entries|null. */
export async function fetch_chain_loot(client, ids, page_size = READ_PAGE) {
  const state = {}
  for (let index = 0; index < ids.length; index += page_size) {
    const page = ids.slice(index, index + page_size)
    const { objects } = await client.getObjects({ objectIds: page, include: { json: true } })
    objects.forEach((object, page_index) => {
      state[page[page_index]] = object instanceof Error ? null : read_template_loot(object?.json ?? null)
    })
  }
  return state
}

/** One set_loot command: build each MobLootEntry at the engine LATEST, collect into a typed MoveVec (engine
 * ORIGIN type tag), then set it on the shared template. An empty desired = a MoveVec of zero elements (clears loot). */
function set_loot_command(tx, deployment, call) {
  const elements = call.desired.map((entry) =>
    tx.moveCall({
      target: `${deployment.fight_package}::mob::new_loot_entry`,
      arguments: [
        tx.pure.id(entry.item_template),
        tx.pure.u16(entry.chance_bp),
        tx.pure.u16(entry.min_qty),
        tx.pure.u16(entry.max_qty),
      ],
    }),
  )
  const loot_vec = tx.makeMoveVec({ type: `${deployment.fight_type_package}::mob::MobLootEntry`, elements })
  tx.moveCall({
    target: `${deployment.call_package}::mob_template::set_loot`,
    arguments: [tx.object(deployment.admin), tx.object(deployment.version), tx.object(call.id), loot_vec],
  })
}

export function batch_tx(deployment, batch) {
  const tx = new Transaction()
  for (const call of batch.calls) set_loot_command(tx, deployment, call)
  return tx
}

function sample_line(row, slug_by_id) {
  return `  ${row.key} [${row.id.slice(0, 10)}…] ${row.from_count}→${row.to_count} entries · ` +
    describe_loot_change(row.current, row.desired, slug_by_id).join(' · ')
}

function print_spot_table(rows) {
  console.log('spot-agreement (seed chance → planned chance_bp, re-derived VERBATIM):')
  console.log('  key                slug                  chance    bp      qty      agree')
  for (const r of rows)
    console.log(
      `  ${r.key.padEnd(18)} ${String(r.slug).padEnd(21)} ${String(r.chance).padEnd(9)} ` +
        `${String(r.planned_bp).padEnd(7)} ${`${r.min_qty}-${r.max_qty}`.padEnd(8)} ${r.agree ? '✓' : '✗ MISMATCH'}`,
    )
}

async function main() {
  const mode = resolve_mode(process.env)
  const network = process.env.NETWORK ?? 'testnet'
  const seed_manifest = read_json(join(script_dir, 'out', 'seed_manifest.json'))
  const manifest_mobs = seed_manifest.mobs ?? {}
  const items_map = seed_manifest.items ?? {}
  const slug_by_id = Object.fromEntries(Object.entries(items_map).map(([slug, id]) => [lc_id(id), slug]))
  const { desired, unresolved, invalid, duplicates } = desired_loot_by_key(load_mob_rows(join(repo_dir, 'seed', 'mainnet')), items_map)
  const deployment = deployment_from_release(release, network)

  const ids = Object.keys(manifest_mobs).sort().map((key) => manifest_mobs[key]?.id).filter(is_id)
  const client = get_client(network)
  const chain_by_id = await fetch_chain_loot(client, ids)
  const limit = process.env.LIMIT ? Number(process.env.LIMIT) : null
  const unresolved_keys = new Set(unresolved.map((row) => row.key))
  const diff = diff_mob_loot({ manifest_mobs, desired_by_key: desired, chain_by_id, unresolved_keys, limit })

  const batches = build_batches(diff.changed)
  const planned = batches.flatMap((batch) => batch.calls.map((call) => call.key))
  const coverage = coverage_check({ ruled: diff.changed.map((row) => row.key), planned })
  const outliers = loot_rate_outliers(diff.changed)
  const seed_rows = Object.values(desired).reduce((sum, entries) => sum + entries.length, 0)
  const chain_rows = Object.values(chain_by_id).reduce((sum, entries) => sum + (entries?.length ?? 0), 0)

  // 5 spot-agreement samples — thread wooling in first (the wool-floor's proof line), then fill from the changed set.
  const changed_keys = diff.changed.map((row) => row.key)
  const spot_keys = [...new Set(['wooling', ...changed_keys])].filter((key) => changed_keys.includes(key)).slice(0, 5)

  console.log(`=== MOB LOOT PAYLOAD | ${mode.live ? 'LIVE' : 'DRY-RUN'} | network=${network} ===`)
  console.log(`package=${deployment.call_package} fight=${deployment.fight_package} loot-type=${deployment.fight_type_package}::mob::MobLootEntry`)
  console.log(
    `census: ${diff.total} manifest mobs · ${diff.changed.length} changed · ${diff.unchanged.length} unchanged · ` +
      `${diff.read_failed.length} read_failed · ${diff.missing_seed.length} missing_seed · ${diff.unresolved.length} unresolved · ` +
      `${invalid.length} invalid_seed · ${duplicates.length} dup_seed`,
  )
  console.log(`entries: ${seed_rows} seed loot rows (resolved, ≤16/mob) · ${chain_rows} on-chain rows`)
  console.log(`coverage-report: ruled=${coverage.ruled_count} planned=${coverage.planned_count} covered=${coverage.covered_pct}%`)
  console.log(`rate-gate: 0<bp≤${MAX_CHANCE_BP}, 1≤min≤max · outliers=${outliers.length}`)
  console.log(`batches: ${batches.length} (≤${MAX_MOBS_PER_PTB} mobs/PTB) · fixed gas=${GAS_BUDGET_MIST} MIST/PTB`)
  console.log('samples (loot changes, old→new):')
  for (const row of diff.changed.slice(0, 5)) console.log(sample_line(row, slug_by_id))
  print_spot_table(loot_spot_agreement(diff.changed, spot_keys))

  // THE COVERAGE TOOTH + integrity/rate blockers — LOUD refusal, never a silent zero-drift or a partial LIVE run.
  if (!coverage.ok)
    throw new Error(
      `COVERAGE GAP — ${coverage.uncovered.length} ruled row(s) not planned: ${coverage.uncovered.slice(0, 20).join(', ')}` +
        (coverage.ruled_count > 0 && coverage.planned_count === 0 ? ' (ZERO planned against nonzero ruled)' : ''),
    )
  if (outliers.length) {
    console.error(`\nNEEDS-RULING — ${outliers.length} planned loot entr(ies) violate the rate/qty law:`)
    for (const o of outliers) console.error(`  ${o.key} [${o.id.slice(0, 10)}…] ${o.slug}: ${o.why}`)
    throw new Error(`${outliers.length} out-of-spec loot rate/qty — refusing (fix the seed or rule it). NEVER silently applied.`)
  }
  const spot_mismatch = loot_spot_agreement(diff.changed, spot_keys).filter((r) => !r.agree)
  if (spot_mismatch.length)
    throw new Error(`SPOT-AGREEMENT FAILED — ${spot_mismatch.length} sampled row(s) disagree with the seed mapping: ${JSON.stringify(spot_mismatch.slice(0, 5))}`)
  const blockers = [...diff.read_failed, ...diff.missing_seed, ...diff.unresolved, ...invalid, ...duplicates]
  if (blockers.length)
    throw new Error(
      `INTEGRITY BLOCKERS — ${diff.read_failed.length} read_failed, ${diff.missing_seed.length} missing_seed, ` +
        `${diff.unresolved.length} unresolved, ${invalid.length} invalid_seed, ${duplicates.length} dup_seed. ` +
        `First: ${JSON.stringify(blockers.slice(0, 5))}`,
    )

  if (!batches.length) { console.log('=== ALREADY CONVERGED (0 changes) ==='); return }
  if (!mode.live) { console.log('=== DRY-RUN COMPLETE (nothing signed) ==='); return }

  const { getSigner, run } = await import('./ceremony_lib.mjs')
  const signer = getSigner()
  console.log(`signer ${signer.getPublicKey().toSuiAddress()} (CLI keystore)`)
  for (const batch of batches) {
    const tx = batch_tx(deployment, batch)
    tx.setGasBudget(GAS_BUDGET_MIST) // fixed budget — run(derive:false) signs with it, throws on executed failure
    await run(client, signer, batch.label, tx, { derive: false })
  }
  console.log('=== MOB LOOT PAYLOAD APPLIED ===')
}

const is_main = process.argv[1] && resolve(process.argv[1]) === file_url_to_path(import.meta.url)
if (is_main)
  main().catch((error) => {
    console.error(`\nMOB LOOT PAYLOAD STOPPED: ${error.message}`)
    console.error('No automatic retry was attempted (a digest = gas burned — the tx-retry-burn law).')
    process.exitCode = 1
  })
