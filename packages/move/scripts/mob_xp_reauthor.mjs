// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MOB-XP REAUTHOR driver. Owner re-aim 2026-07-20 — this lane is the FALLBACK; the PRIMARY xp path is an additive
// `aresrpg::mob_template::set_xp_reward` setter + upgrade (parallel lane, 07-15 set_level_targeting precedent).
// Because the setter mutates xp IN PLACE, template ids do NOT change and NO world-table repoint is needed.
//
//   --strategy=read   (default) — prints the SHARED changed-set truth (manifest ids → on-chain xp_reward →
//                                 retuned seed xp). BOTH the setter apply script and any remint path consume it.
//   --strategy=remint            — the burn+remint writer is INTENTIONALLY UNBUILT (the setter supersedes it):
//                                 this prints the plan then refuses to write, loudly — never a silent no-op.
//   --limit N / LIMIT=N          — canary: diff only the first N (sorted) manifest mobs.
//   PLAN_PATH=<file>             — also emit the changed-set as JSON for the setter apply lane to consume.
//
// gRPC READS ONLY — this lane signs nothing (the LIVE fire is the lead's, via the setter ceremony). Reads through
// ./client.js; object ids come only from out/seed_manifest.json; the retuned xp from seed/mainnet/**/mobs.json.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolve_mode } from './reseed_plan.mjs'
import {
  diff_mob_xp,
  fetch_chain_xp,
  seed_xp_by_key,
  unminted_seed_keys,
} from './mob_xp_reauthor_plan.mjs'

const script_dir = dirname(fileURLToPath(import.meta.url))
const repo_dir = resolve(script_dir, '..', '..', '..')
const seed_dir = join(repo_dir, 'seed', 'mainnet')
const manifest_path = join(script_dir, 'out', 'seed_manifest.json')
const commands_per_remint = 2 // burn + mint per template (fallback plan sizing only)
const max_ptb_commands = 30 // reseed_plan.mjs law

const read_json = (path) => JSON.parse(readFileSync(path, 'utf8'))

function flag_value(argv, env, name, env_name) {
  const prefix = `--${name}=`
  const hit = argv.find((argument) => argument.startsWith(prefix))
  if (hit) return hit.slice(prefix.length)
  return env[env_name]
}

function selected_strategy(argv, env) {
  const value = flag_value(argv, env, 'strategy', 'STRATEGY') ?? 'read'
  if (value !== 'read' && value !== 'remint')
    throw new Error(`--strategy must be read|remint (got ${JSON.stringify(value)})`)
  return value
}

function limit_from(argv, env) {
  const raw = flag_value(argv, env, 'limit', 'LIMIT')
  if (raw == null) return null
  const number = Number(raw)
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new Error(`--limit must be a positive integer (got ${JSON.stringify(raw)})`)
  return number
}

function load_seed_mobs() {
  return readdirSync(seed_dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .flatMap((name) => read_json(join(seed_dir, name, 'mobs.json')))
}

function load_manifest(network) {
  let manifest
  try {
    manifest = read_json(manifest_path)
  } catch (error) {
    throw new Error(`seed_manifest.json missing/unreadable at ${manifest_path}: ${error.message}`)
  }
  const mobs = manifest.mobs ?? {}
  if (!Object.keys(mobs).length)
    throw new Error('seed_manifest.json carries zero mobs — nothing to diff')
  if (manifest._network && manifest._network !== network)
    throw new Error(
      `manifest network ${manifest._network} ≠ NETWORK ${network} — refusing cross-network reads`
    )
  // NOTE the manifest PREDATING the retuned seed is EXPECTED here (chain=old xp, seed=new xp); the real freshness
  // gate is per-id read success below (a stale id → xp unreadable → read_failed → LIVE blocker), not mtime.
  return mobs
}

function print_report({ plan, strategy, mode, limit, seed, unminted }) {
  console.log(
    `\n=== MOB-XP REAUTHOR · strategy=${strategy} · mode=${mode.live ? 'LIVE' : 'DRY_RUN'}` +
      `${limit == null ? '' : ` · limit=${limit}`} · scanned=${plan.total} templates ===`
  )
  console.log(
    `changed=${plan.changed.length} · unchanged=${plan.unchanged.length} · ` +
      `read_failed=${plan.read_failed.length} · missing_seed=${plan.missing_seed.length} · ` +
      `seed_invalid=${seed.invalid.length} · seed_dupes=${seed.duplicates.length} · unminted_seed=${unminted.length}`
  )
  console.log('\nsamples (old chain xp → new seed xp):')
  for (const row of plan.changed.slice(0, 5))
    console.log(`  ${row.key}  ${row.from} → ${row.to}   (${row.id})`)
  if (!plan.changed.length) console.log('  (none — chain xp already matches the retuned seed)')
  for (const row of plan.read_failed) console.log(`  READ_FAILED ${row.key} (${row.id}): ${row.why}`)
  for (const row of plan.missing_seed) console.log(`  MISSING_SEED ${row.key} (${row.id})`)
  for (const row of seed.invalid) console.log(`  SEED_INVALID ${row.key}: ${row.why}`)
  for (const row of seed.duplicates)
    console.log(`  SEED_DUPE ${row.key}: kept ${row.kept}, ignored ${row.ignored}`)
}

async function main() {
  const argv = process.argv.slice(2)
  const env = process.env
  const mode = resolve_mode(env) // reuses the reseed LIVE/DRY latch (LIVE=1 vs DRY_RUN default)
  const strategy = selected_strategy(argv, env)
  const limit = limit_from(argv, env)
  const network = env.NETWORK ?? 'testnet'

  const manifest_mobs = load_manifest(network)
  const seed = seed_xp_by_key(load_seed_mobs())

  const sorted_keys = Object.keys(manifest_mobs).sort()
  const scoped_keys = limit == null ? sorted_keys : sorted_keys.slice(0, limit)
  const ids = scoped_keys
    .map((key) => manifest_mobs[key]?.id)
    .filter((id) => /^0x[0-9a-f]{64}$/i.test(id))

  const { sui_client } = await import('./client.js')
  const chain_xp = await fetch_chain_xp(sui_client, ids)

  const plan = diff_mob_xp({ manifest_mobs, seed_xp: seed.xp, chain_xp, limit })
  const unminted = unminted_seed_keys(manifest_mobs, seed.xp)
  print_report({ plan, strategy, mode, limit, seed, unminted })

  if (env.PLAN_PATH) {
    const plan_path = resolve(env.PLAN_PATH)
    writeFileSync(
      plan_path,
      `${JSON.stringify(
        {
          kind: 'mob-xp-changed-set-v1',
          generated_at: new Date().toISOString(),
          network,
          strategy,
          changed: plan.changed,
        },
        null,
        2
      )}\n`
    )
    console.log(`\nchanged-set JSON → ${plan_path}`)
  }

  // The one gate BOTH strategies honor: never fire LIVE with reads you couldn't fully trust.
  const live_blockers =
    plan.read_failed.length + plan.missing_seed.length + seed.invalid.length

  if (strategy === 'remint') {
    console.log(
      '\n[strategy=remint] the burn+remint WRITER is INTENTIONALLY UNBUILT (superseded 2026-07-20 by the in-place strategy):\n' +
        '  primary xp path = aresrpg::mob_template::set_xp_reward (additive setter + upgrade, parallel lane) —\n' +
        '  an in-place mutation, so ids never change and no world-table repoint is needed. This lane ships the\n' +
        `  diff/read truth above; the setter apply script consumes plan.changed (${plan.changed.length} rows).`
    )
    const would_be_batches = Math.ceil(
      (plan.changed.length * commands_per_remint) / max_ptb_commands
    )
    console.log(
      `  (were a remint ever built: ${plan.changed.length} × ${commands_per_remint} cmds ⇒ ` +
        `${would_be_batches} PTB batch(es) at ≤${max_ptb_commands} cmds — plus a manifest writeback + world repoint.)`
    )
    if (mode.live) {
      console.error(
        '\nREFUSING: no remint writer to run under LIVE=1 — fire the set_xp_reward setter ceremony instead.'
      )
      process.exitCode = 1
    }
    return
  }

  // strategy=read — the shared truth. Under LIVE, an unreadable/inconsistent row blocks (the ceremony must not
  // proceed on a partial read); under DRY (default) it is a report and exits 0.
  if (mode.live && live_blockers) {
    console.error(
      `\nREFUSING LIVE: ${plan.read_failed.length} unreadable + ${plan.missing_seed.length} missing-seed + ` +
        `${seed.invalid.length} invalid-seed row(s) — resolve before any xp ceremony fires.`
    )
    process.exitCode = 1
    return
  }
  console.log(
    `\nread-only diff complete — ${plan.changed.length} template(s) need the xp reauthor ` +
      '(feed plan.changed to the set_xp_reward setter ceremony).'
  )
}

main().catch((error) => {
  console.error(`\nMOB-XP REAUTHOR STOPPED: ${error.message}`)
  process.exitCode = 1
})
