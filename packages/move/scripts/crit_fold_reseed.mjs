// CRIT-FOLD RESEED AUDIT (D765). DRY-RUN ONLY — this tool makes ZERO chain calls: the lead fires the actual
// on-chain reseed (reseed_driver.mjs) at ceremony time. seed/mainnet was already folded in the crit-convergence
// commit, so there is NOTHING to patch (and the fence forbids it) — this script instead RE-DERIVES the fold
// from the pre-fold seed (the git blob BEFORE that commit) and proves, before the ceremony writes a single
// template, the three facts it needs:
//   1. LAW — the folded corpus is clean: item_stat_law's 19-pin D765 allowlist honored, no 20th over-envelope
//      row, strict_key_schema's dead-key ban intact (all via the REAL gates — single source of truth).
//   2. DRIFT — the committed on-disk seed already carries the faithful per-side sums (the fold receipt).
//   3. TABLE — the full ~433-row delta (world/slug · critical + critical_chance(11) + critical_outcomes(12) → 9).
// Any pin drift, 20th outlier, dead-key leak, drift, or schema surprise prints RED and sets a non-zero exit.
//
// Source: PRE_FOLD_REF (default = the parent of the newest commit that changed `critical_outcomes` under
// seed/mainnet — i.e. the crit-convergence commit; override for a rebased history). There is NO LIVE mode.

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { fold_corpus, verify_drift, verify_folded } from './crit_fold.mjs'

const script_dir = dirname(fileURLToPath(import.meta.url))
const repo_root = resolve(script_dir, '..', '..', '..')
const seed_mainnet = join(repo_root, 'seed', 'mainnet')

const git = (args) =>
  execFileSync('git', args, { cwd: repo_root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })

const world_directories = () =>
  readdirSync(seed_mainnet, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d/.test(entry.name))
    .map((entry) => entry.name)
    .sort()

const detect_pre_fold_ref = () => {
  const commit = git(['log', '-1', '--format=%H', '-S', 'critical_outcomes', '--', 'seed/mainnet']).trim()
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error('could not auto-detect the crit-fold commit — set PRE_FOLD_REF explicitly')
  return `${commit}^`
}

const rows_with_world = (json, world) =>
  JSON.parse(json).map((row) => ({ ...row, world: row.world ?? world }))

const load_pre_fold_rows = (ref) => {
  const rows = []
  for (const world of world_directories()) {
    let blob = null
    try {
      blob = git(['show', `${ref}:seed/mainnet/${world}/items.json`])
    } catch {
      continue // a world absent at the pre-fold ref simply contributes no rows
    }
    for (const row of rows_with_world(blob, world)) rows.push(row)
  }
  return rows
}

const load_current_rows = () => {
  const rows = []
  for (const world of world_directories())
    for (const row of rows_with_world(readFileSync(join(seed_mainnet, world, 'items.json'), 'utf8'), world))
      rows.push(row)
  return rows
}

const side_fold_text = (detail) =>
  detail ? `${detail.before}+${detail.critical_chance}+${detail.critical_outcomes}=${detail.after}` : '—'

const print_delta_table = (deltas) => {
  console.log(
    `\n=== CRIT FOLD DELTA · ${deltas.length} rows (critical + critical_chance[11] + critical_outcomes[12] → critical[9]) ===`
  )
  console.log('  world/slug  ·  min crit+11+12=9  ·  max crit+11+12=9')
  for (const delta of deltas)
    console.log(`  ${delta.where}  ·  min ${side_fold_text(delta.min)}  ·  max ${side_fold_text(delta.max)}`)
}

const main = () => {
  if (process.env.LIVE === '1' || process.env.DRY_RUN === '0')
    throw new Error(
      'crit_fold_reseed is a DRY-RUN AUDIT — it makes NO chain calls; reseed_driver.mjs applies the fold on-chain at ceremony time'
    )

  const ref = process.env.PRE_FOLD_REF ?? detect_pre_fold_ref()
  const pre_fold = load_pre_fold_rows(ref)
  if (pre_fold.length === 0)
    throw new Error(`no pre-fold rows read at ${ref} — wrong PRE_FOLD_REF or an empty seed tree`)
  const current = load_current_rows()

  const { folded, deltas } = fold_corpus(pre_fold)
  const law = verify_folded(folded)
  const current_by_slug = new Map(current.filter((row) => row.slug).map((row) => [row.slug, row]))
  const drift = verify_drift(deltas, current_by_slug)

  console.log(`=== CRIT-FOLD RESEED AUDIT (DRY_RUN) · pre-fold ref=${ref} ===`)
  console.log(`pre-fold rows=${pre_fold.length} · current rows=${current.length} · affected (carry 11/12)=${deltas.length}`)
  print_delta_table(deltas)

  console.log('\n=== LAW (item_stat_law 19-pin allowlist + band envelope · strict_key_schema dead-key ban) ===')
  if (law.ok) console.log('  OK — every folded row is law-clean (all 19 pins honored, no 20th outlier, no dead key)')
  else for (const error of law.errors) console.log(`  RED ${error}`)

  console.log('\n=== DRIFT (the committed seed already carries the faithful per-side sums) ===')
  if (drift.ok) console.log('  OK — on-disk critical == re-derived fold; no dead key survives on disk')
  else for (const error of drift.errors) console.log(`  RED ${error}`)

  const failed = !law.ok || !drift.ok
  console.log(
    `\n=== VERDICT: ${failed ? 'RED — refusing; NO chain writes' : 'GREEN — fold proven; reseed_driver may apply on-chain at ceremony time'} ===`
  )
  process.exitCode = failed ? 1 : 0
}

main()
