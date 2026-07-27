// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RESEED DRIVER (`ares sync` embryo). Default is DRY_RUN; only LIVE=1 can reach signing. Reads are gRPC through
// ./client.js, object ids come only from out/seed_manifest.json, and call targets are ceremony latest ?? origin.

import {
  readFileSync as read_file_sync,
  readdirSync as read_dir_sync,
  writeFileSync as write_file_sync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import {
  build_item_leg,
  build_spell_leg,
  call_package,
  execute_transactions,
  fixed_gas_budget_mist,
  resolve_mode,
} from './reseed_plan.mjs'
import { build_world_leg, role_drift_report } from './reseed_world_plan.mjs'

const script_dir = dirname(file_url_to_path(import.meta.url))
const repo_dir = resolve(script_dir, '..', '..', '..')
const seed_dir = join(repo_dir, 'seed', 'mainnet')
const output_dir = join(script_dir, 'out')

const read_json = (file_path) => JSON.parse(read_file_sync(file_path, 'utf8'))

function json_files(directory) {
  return read_dir_sync(directory)
    .filter((file_name) => file_name.endsWith('.json'))
    .sort()
    .map((file_name) => read_json(join(directory, file_name)))
}

function biome_directories() {
  return read_dir_sync(seed_dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
}

function load_repo_inputs() {
  const directories = biome_directories()
  return {
    manifest: read_json(join(output_dir, 'ceremony_manifest.json')),
    seed_manifest: read_json(join(output_dir, 'seed_manifest.json')),
    seeds: {
      spells: json_files(join(seed_dir, 'spells')).flat(),
      items: directories.flatMap((directory) =>
        read_json(join(seed_dir, directory, 'items.json'))
      ),
      mobs: directories.flatMap((directory) =>
        read_json(join(seed_dir, directory, 'mobs.json'))
      ),
      worlds: directories.map((directory) =>
        read_json(join(seed_dir, directory, 'world.json'))
      ),
    },
  }
}

function selected_legs_from(environment) {
  const value = environment.LEG ?? 'all'
  const selected =
    value === 'all' ? ['spells', 'items', 'worlds'] : value.split(',')
  const invalid = selected.filter(
    (leg) => !['spells', 'items', 'worlds'].includes(leg)
  )
  if (invalid.length)
    throw new Error(
      `LEG must be spells, items, worlds, or all (got ${invalid.join(',')})`
    )
  return [...new Set(selected)]
}

function load_inputs(environment) {
  if (!environment.FIXTURE_PATH)
    return { ...load_repo_inputs(), fixture: false }
  const fixture = read_json(resolve(environment.FIXTURE_PATH))
  return {
    manifest: fixture.manifest,
    seed_manifest: fixture.seed_manifest,
    seeds: fixture.seeds,
    chain_state: fixture.chain_state,
    fixture: true,
  }
}

function require_package(entry, name) {
  if (!entry?.pkg) throw new Error(`ceremony manifest has no ${name}.pkg`)
  return call_package(entry)
}

function build_plan({
  mode,
  selected_legs,
  manifest,
  seed_manifest,
  seeds,
  chain_state,
}) {
  const foundation_target = require_package(manifest.foundation, 'foundation')
  const spells_target = require_package(manifest.spells, 'spells')
  const aresrpg_target = require_package(manifest.aresrpg, 'aresrpg')
  const legs = {}
  if (selected_legs.includes('spells'))
    legs.spells = build_spell_leg({
      seed_rows: seeds.spells,
      seed_manifest,
      chain_state: chain_state.spells,
      targets: { spells: spells_target, foundation: foundation_target },
    })
  if (selected_legs.includes('items'))
    legs.items = build_item_leg({
      seed_rows: seeds.items,
      seed_manifest,
      chain_state: chain_state.items,
      target: aresrpg_target,
    })
  if (selected_legs.includes('worlds'))
    legs.worlds = build_world_leg({
      seed_rows: seeds.worlds,
      mob_rows: seeds.mobs,
      seed_manifest,
      chain_state: chain_state.worlds,
      target: aresrpg_target,
    })
  return {
    kind: 'aresrpg-reseed-plan-v1',
    generated_at: new Date().toISOString(),
    mode: mode.live ? 'LIVE' : 'DRY_RUN',
    selected_legs,
    fixed_gas_budget_mist,
    legs,
  }
}

function print_plan(plan, plan_path) {
  console.log(
    `=== RESEED PLAN · mode=${plan.mode} · legs=${plan.selected_legs.join(',')} ===`
  )
  console.log(
    `fixed gas ceiling: ${plan.fixed_gas_budget_mist} MIST (0.05 SUI) per tx`
  )
  for (const [leg_name, leg] of Object.entries(plan.legs)) {
    console.log(
      `\n[${leg_name}] rows drifted=${leg.rows_drifted}/${leg.seed_rows} · calls=${leg.call_count} · txs=${leg.tx_count}`
    )
    if (leg.levels_drifted != null)
      console.log(`  levels drifted=${leg.levels_drifted}`)
    if (leg.totals)
      console.log(
        `  table delta: resources -${leg.totals.resources.removed}/+${leg.totals.resources.added} · ` +
          `mobGroups -${leg.totals.mob_groups.removed}/+${leg.totals.mob_groups.added} · ` +
          `rooms -${leg.totals.rooms.removed}/+${leg.totals.rooms.added}`
      )
    if (leg.role_projection_drift?.length) {
      // DERIVED from the emitted calls, never a fixed classification: role drives the boss mask now, so a
      // normal↔boss change does reach chain and the operator has to be told that.
      const report = role_drift_report(leg)
      console.log(`  ${report.line}`)
      for (const role of leg.role_projection_drift)
        console.log(
          `    ${report.row_prefix} ${role.mob}: ${role.manifest_role} -> ${role.seed_role}`
        )
    }
    for (const blocker of leg.blockers) console.log(`  BLOCKER ${blocker}`)
    for (const transaction of leg.transactions) {
      console.log(
        `  tx ${transaction.label} · setters=${transaction.call_count} · ptb_commands=${transaction.ptb_command_count}`
      )
      for (const call of transaction.calls) console.log(`    - ${call.summary}`)
    }
  }
  console.log(`\nplan JSON -> ${plan_path}`)
}

function all_transactions(plan) {
  return plan.selected_legs.flatMap((leg) => plan.legs[leg]?.transactions ?? [])
}

function all_blockers(plan) {
  return Object.entries(plan.legs).flatMap(([leg, value]) =>
    value.blockers.map((blocker) => `${leg}: ${blocker}`)
  )
}

function live_context(manifest) {
  return {
    foundation_target: call_package(manifest.foundation),
    effect_type: `${manifest.foundation.pkg}::spell_effect::Effect`,
    spells_admin: manifest.spells.admin,
    spells_version: manifest.spells.version,
    aresrpg_admin: manifest.aresrpg.admin,
    aresrpg_version: manifest.aresrpg.version,
  }
}

async function main() {
  const mode = resolve_mode(process.env)
  const selected_legs = selected_legs_from(process.env)
  const inputs = load_inputs(process.env)
  if (inputs.fixture && mode.live)
    throw new Error('LIVE=1 is forbidden with FIXTURE_PATH')

  let client_module = null
  let live_module = null
  if (!inputs.chain_state) {
    client_module = await import('./client.js')
    live_module = await import('./reseed_live.mjs')
    inputs.chain_state = await live_module.fetch_chain_state({
      client: client_module.sui_client,
      selected_legs,
      seeds: inputs.seeds,
      seed_manifest: inputs.seed_manifest,
      manifest: inputs.manifest,
    })
  }

  const plan = build_plan({
    mode,
    selected_legs,
    manifest: inputs.manifest,
    seed_manifest: inputs.seed_manifest,
    seeds: inputs.seeds,
    chain_state: inputs.chain_state,
  })
  const plan_path = resolve(
    process.env.PLAN_PATH ?? join(output_dir, 'reseed_plan.json')
  )
  write_file_sync(plan_path, `${JSON.stringify(plan, null, 2)}\n`)
  print_plan(plan, plan_path)

  const blockers = all_blockers(plan)
  if (blockers.length)
    throw new Error(
      `plan has ${blockers.length} blocker(s); refusing every chain write`
    )
  if (mode.dry_run) {
    console.log(
      '\nDRY_RUN=1 (default) — chain writes disabled; 0 transactions signed'
    )
    return
  }

  client_module ??= await import('./client.js')
  live_module ??= await import('./reseed_live.mjs')
  const context = live_context(inputs.manifest)
  const result = await execute_transactions(all_transactions(plan), {
    live: true,
    execute_transaction: async (transaction_plan) => {
      const receipt = await live_module.execute_live_transaction({
        client: client_module.sui_client,
        signer: client_module.keypair,
        transaction_plan,
        context,
      })
      console.log(
        `EXECUTED ${transaction_plan.label} status=${receipt.status} digest=${receipt.digest ?? '(missing)'}`
      )
      return receipt
    },
  })
  console.log(
    `\nLIVE COMPLETE — ${result.executed} transaction(s); rerun DRY_RUN to prove zero drift`
  )
}

main().catch((error) => {
  console.error(`\nRESEED STOPPED: ${error.message}`)
  if (error.digest)
    console.error(`failure latch digest=${error.digest} — NEVER auto-retry`)
  process.exitCode = 1
})
