#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The `ares` CLI dispatcher. Domains live in scripts/ares/ (lib = shared kernel, status = the
// liveness/drift board); the test-selector pipeline and publish pre-flight stay here — they ARE
// the dispatch surface CLAUDE.md's testing gate names (`ares test …`).
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync as spawn_sync } from 'node:child_process'
import { fileURLToPath as file_url_to_path, pathToFileURL as path_to_file_url } from 'node:url'

import { repo_root, error_reason } from './ares/lib.mjs'
import { run_status } from './ares/status.mjs'

// Pure status/report helpers re-exported for scripts/ares.test.mjs — the one import seam.
export {
  bundle_pin_summary,
  package_pin_summary,
  probe_object_ids,
  spell_manifest_ids,
  spell_presence_summary,
} from './ares/status.mjs'

const script_path = file_url_to_path(import.meta.url)
function run_publish_dry() {
  const gate = spawn_sync('bash', [path.join(repo_root, 'scripts/check-constraints.sh')], {
    cwd: repo_root,
    stdio: 'inherit',
  })
  const gate_exit = gate.status ?? 1
  console.log(`${gate_exit === 0 ? 'OK' : 'FAIL'} publish.precondition.constraints exit=${gate_exit}`)
  if (gate_exit !== 0) return 1
  const ceremony_path = path.join(repo_root, 'packages/move/scripts/ceremony.mjs')
  const result = spawn_sync(process.execPath, [ceremony_path, '--dry-run'], {
    cwd: repo_root,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) {
    console.error(`ares publish --dry: ${error_reason(result.error)}`)
    return 1
  }
  if (result.signal) {
    console.error(`ares publish --dry: ceremony stopped by ${result.signal}`)
    return 1
  }
  return result.status ?? 1
}
function run_test_command(command, args, cwd, env) {
  const result = spawn_sync(command, args, {
    cwd,
    stdio: 'inherit',
    env: env ? { ...process.env, ...env } : process.env,
  })
  if (result.error) console.error(`ares test: ${error_reason(result.error)}`)
  if (result.signal) console.error(`ares test: stopped by ${result.signal}`)
  return result.status ?? 1
}
// `anchor` runs EVERY project playwright.anchor.config.ts declares — chromium, chromium-headed, and LANE LAG's
// `lagged` project (a 700ms+jitter delay proxy in front of /v1, test/gold/proxy_lag.mjs): no extra selector
// needed, `bunx playwright test` with no --project flag already runs every project whose grep a spec matches.
const gold_suites = ['gold', 'anchor', 'multiplayer']
const anchor_report_path = path.join(repo_root, 'test/gold/out/ares-anchor-report.json')
export const orchestrator_unit_tests = [
  'test/gold/bot/orchestrator.test.mjs',
  'test/gold/fixtures/actor_fixture.test.mjs',
  'test/gold/bot/ui_driver.test.mjs',
  'test/gold/bot/behavior.test.mjs',
  'test/gold/fixtures/market_two_actor.test.mjs',
  'test/gold/sponsor_compose.test.mjs',
]
// ANCHOR STACK PRE-CHECK — a down gold stack must never fall into the skip-storm
// that reads like a verdict (every specs_anchor row SKIPS, playwright still exits 0) — probe liveness
// with lib_gold.mjs's OWN health functions (short timeout, never boot-time patience) through the same
// `run` injectable every other leg uses, so scripts/ares.test.mjs mocks it exactly like a playwright call.
const anchor_stack_health_script = [
  `import { waitHealthy, waitApi } from ${JSON.stringify(path_to_file_url(path.join(repo_root, 'test/gold/lib_gold.mjs')).href)}`,
  'try { await waitHealthy(3000); await waitApi(3000); process.exit(0) } catch { process.exit(1) }',
].join('\n')
function run_gold_suite(suite, run = run_test_command) {
  const frontend_root = path.join(repo_root, 'packages/frontend')
  // Keep Playwright under Bun: multiplayer imports the tracked classes JSON directly, which Node 25 refuses
  // without an import attribute before Playwright can collect the COOP specs.
  const playwright_args = [
    path.join(frontend_root, 'node_modules', '@playwright', 'test', 'cli.js'),
    'test',
    '--config',
    `../../test/gold/playwright.${suite}.config.ts`,
  ]
  if (suite !== 'anchor') return run('bun', playwright_args, frontend_root)
  if (run(process.execPath, ['--input-type=module', '-e', anchor_stack_health_script], repo_root) !== 0) {
    console.error('REFUSING ares test anchor: the gold stack is DOWN (lib_gold.mjs waitHealthy/waitApi probe failed).')
    console.error('  boot it first: node test/gold/up_gold.mjs   # ~5-10 min: regenesis + publish + seed + backfill')
    return 1
  }
  // SKIP ≠ PASS (07-17 audit; same gate as deploy-frontend.sh:27): without the gold manifest every
  // specs_anchor row SKIPS and playwright still exits 0 — so the anchor leg emits a JSON report beside the
  // list output and, after a green exit, REQUIRES the driven MULTI-TURN row literally `passed` (skipped or
  // absent = RED). The driven-fight rows live only in specs_anchor/, so gold/multiplayer have none to require.
  fs.rmSync(anchor_report_path, { force: true }) // a stale report must never green a fresh run
  const playwright_exit = run('bun', [...playwright_args, '--reporter=list,json'], frontend_root, {
    PLAYWRIGHT_JSON_OUTPUT_FILE: anchor_report_path,
  })
  if (playwright_exit !== 0) return playwright_exit
  const driven_exit = run(
    process.execPath,
    [path.join(repo_root, 'scripts/require_driven_fight_green.mjs'), anchor_report_path, 'MULTI-TURN'],
    repo_root
  )
  if (driven_exit !== 0) return driven_exit
  // MINT-FIDELITY READBACK (board row 22): read every minted spell template's on-chain effect rows back and
  // diff them, per field, against the authored seed — the third side of the sim↔chain↔seed triangle (twin
  // vectors test sim↔chain on synthetic args, V-gates test the seed, NOTHING compared minted↔authored). Reuses
  // the live anchor rig the driven-fight gate above just proved is up; SKIP ≠ PASS — a rig it cannot read reds.
  return run(process.execPath, [path.join(repo_root, 'test/gold/mint_readback.mjs')], repo_root)
}
function run_orchestrator_units(run = run_test_command) {
  return run('bun', ['test', ...orchestrator_unit_tests], repo_root)
}
// FIGHT-CORE gates + core unit suite. S2 flipped: the 4 structural gates are GREEN and this
// runs INSIDE the default `run_tests()` pipeline (plus the dedicated `fightcore` selector for fast iteration).
function run_fight_core(run = run_test_command) {
  // Run BOTH always: a unit failure is a real regression and dominates the exit; the structural gates stand
  // guard against any second reducer / fat shim / live packet-bus dispatch coming back.
  const gates = run(process.execPath, [path.join(repo_root, 'scripts/fight-core-gates.mjs')], repo_root)
  const units = run('bun', ['test'], path.join(repo_root, 'packages/fight'))
  return units !== 0 ? units : gates
}
// THE COMBINATORIAL FIGHT GATE (`ares test combo`): sim-driven, chain-free fights — every effect / AoE shape /
// trap / displacement / kill sequence folded through the REAL beat/store pipeline and judged by four oracle
// families (grammar · trajectory · state-parity · §7b). Its own selector (a full sim×fold sweep, heavier than
// the hot unit slice); the lead re-runs it against sweep merges. Writes the finding catalog to
// packages/fight/test/combinatorial/out/catalog.md. HARD oracles gate; SOFT §7b timings are cataloged findings.
function run_combo(run = run_test_command) {
  return run('bun', ['test', path.join(repo_root, 'packages/fight/test/combinatorial.test.js')], repo_root)
}
// THE COMPLAINT LEDGER GATE — every recurring complaint gets an impossible-to-fail gate. Asserts every GATED
// row of test/gold/COMPLAINT_LEDGER.md maps to a discoverable test; pure/rig-free, so
// it stands in the default pipeline AND has its own `ledger` selector for fast iteration.
function run_ledger_gate(run = run_test_command) {
  return run(process.execPath, [path.join(repo_root, 'test/gold/ledger_gate.mjs')], repo_root)
}
// LANE PRODASSET: prod /v1 + the real icon resolvers → URL census → HEAD 200 + sha-distinctness (CLI_TEST_AUDIT.md #1) — read-only against prod, its own selector, never the local no-selector pipeline.
export const unit_test_files = [
  'packages/party/test', // M2 rung 4 (D768): the @aresrpg/party core suite + its hermeticity pin
  'packages/inventory/test', // M2 rung 4 (D768): the @aresrpg/inventory core suite + its hermeticity pin
  'packages/engine/test', // Bun `?url` resolver proof: the absent engine source path maps to the shipped GLB route
  'packages/frontend/test', // package-level frontend regressions required outside the src-colocated suite
  // THE SPELL-EFFECT CONFORMANCE MATRIX (survival gate): drives EVERY declared effect of the 240-spell mainnet
  // corpus through the reducer and asserts its effect-class postcondition held. RED the moment any SUPPORTED
  // effect kind regresses; the known-unsupported kinds are the enumerated worklist in MATRIX_CONVICTIONS.md.
  'packages/sim/test/spell_effect_conformance_matrix.test.js',
  'packages/sim/test/spawn_draw_rate.test.js',
  'test/scripts/check-doc-file-references.test.mjs',
  'test/scripts/arch-gates-missing-tools.test.mjs',
  'scripts/check-chain-ids.test.mjs',
  'packages/move/scripts/crit_fold.test.mjs',
  'packages/move/scripts/spell_wire.test.mjs', // #1250 RED-FIRST parity fixture — the ONE new_effect signed-value dialect home
  'packages/move/scripts/apply_xp_payload.test.mjs', // the ceremony driver's LAW ④ cap gate + payload core — unwired until #1246, which is how MAX_RESIST_MAGNITUDE sat at the superseded 50 for days
  'scripts/prod_smoke_registration.test.mjs',
  'scripts/prod_asset_census.test.mjs',
  'scripts/airdrop_dump.test.mjs', // AIRDROP CLAIM-MAPPING ORACLE: resources.json include-set fix (2026-07-19 queue row 4)
  'seed/mainnet/shop_content.test.mjs', // canonical catalog generator/seed convergence + exact v2 economy
  'seed/generators/resist_element_effect.test.mjs', // RESIST-ELEMENT MINT BUG: ALTER_RESIST emits `element`, never element-in-`stat`
  'seed/generators/resist_element_seed_corpus.test.mjs', // same bug, the REAL seed corpus: 07-20 regen closed 144/300 rows, 156/8 tracked-exception rows remain (ratchet)
  'test/gold/mint_readback.test.mjs', // MINT-FIDELITY READBACK pure core (CHAIN-side twin of the resist gate above): the value/kind transform-drift + novel-elementless RED paths a faithful rig can't show (RED-FIRST fixture)
  'scripts/wip-mainline-gate.test.mjs', // WIP-ON-MAINLINE GATE self-test — real disposable git repos against scripts/githooks/commit-msg
  'scripts/deploy-frontend.test.mjs', // the below-gate owner-word door: default-closed, no-env-equiv, citation-mandatory, flag-parsed
  'scripts/eslint-rules/one_pipeline.test.mjs', // the ONE-REDUCER lint tripwire's own RuleTester suite
  'scripts/eslint-rules/fp_law.test.mjs', // the FP-LAW tripwires' RuleTester suite (docs/CODE_LAW.md)
  'scripts/eslint-rules/no_silent_failures.test.mjs', // the SILENT-FAILURE tripwire's RuleTester suite — two controls: specimen-shaped fixtures AND fresh novel shapes (a rule that only reds on history is a regression suite wearing a gate's name)
  'packages/rpc/api/indexer_log_ship.test.mjs', // Rust indexer JSON-error -> Sentry sidecar decoder/fingerprint
  'scripts/sentry_triage.test.mjs', // hourly Sentry -> GitHub dedupe/material-growth loop pure core
  'scripts/board_hygiene.test.mjs', // #845's close chain: close-keyword parsing, the landing sweep's reopen guard, the stale clock's bot exclusion
  'scripts/loop_deadman.test.mjs', // the CI dead-man's anchor reader (real captured #1357 bytes), staleness bar, and one-alarm-per-loop ladder
  'scripts/check-move-field-limits.test.mjs', // the field-cap gate's no-verdict severity split (#938) — real subprocess, disposable git fixtures
  'scripts/check-fixture-adjudication.test.mjs', // #1101 — existing fixture mutations need independent commit-trailer ratification
  'scripts/check-loc-ledger-workflow.test.mjs', // #1603 — promotion history scope + ordinary-PR negative control
  'test/gold/specs_anchor/click_verify_test.ts', // the harness click-decision pure unit (*_test.ts on purpose: the anchor playwright config's testMatch must never collect it)
  'test/gold/specs_anchor/fight_recovery_test.ts', // the stale-fight recovery classifier + tx-door invocation count (same *_test.ts law)
  'test/gold/specs_anchor/search_retry_test.ts', // the fixture-search retry classifier + bounded settle loop (same *_test.ts law)
  'test/gold/specs_anchor/pacing_envelopes_test.ts', // the SPEC §7b beat-trace evaluator pure unit (same *_test.ts law)
  'test/gold/specs_anchor/trajectory_eval_test.ts', // the pos-trace trajectory-conformance evaluator pure unit (same *_test.ts law)
  'test/gold/tree_freeze_fingerprint.test.ts', // the mechanical tree-freeze pure unit
  'test/localnet/harness/verify-sui-artifact.test.js', // #1718 per-arch release row + pre-fetch/checksum ordering
  'test/localnet/bots/framework/world_flow.test.js', // terminal polling + transient pre-execution retry contract for driven fights
  'test/localnet/bots/framework/gate.test.js', // #1165 boot/leg gate determinism: bounded retry-once, ENV-FAIL vs PRODUCT-FAIL exit codes, no Promise.race
  'test/gold/rig_integrity.test.mjs', // localnet closure + the browser dynamic-import audit (stale rig URLs 404 silently at drive time)
  'test/gold/fixtures/runtime_catalog_export_parity.test.mjs', // TWIN-DRIFT gate: the aliased gold fight-spells fixture must export every name the real app module does (a missing export = ESM boot-crash, invisible off-browser; killed r12d's 4 driven rows on project_spell_effect)
]
// THE WORLD-CORE suite (D770a): @aresrpg/world's package tests — the three-door headless world core plus its
// in-package hermeticity gate (the depcruise world-core-hermetic rule's node-side twin).
function run_world_core(run = run_test_command) {
  return run('bun', ['test'], path.join(repo_root, 'packages/world'))
}
// THE FAST LOCAL SLICE — `ares test unit` (the selector CLAUDE.md's testing gate names): unit files +
// fight-core + world-core + ledger, no constraints sweep, no browser suites. Also the default pipeline's
// opening legs.
function run_unit_slice(run = run_test_command) {
  // Existence-filtered: rows whose files aren't in THIS tree self-drop (tree-subset builds —
  // e.g. the public repo without the content/rig trees — run the surviving slice; a missing
  // file is a routing fact, never a red).
  const present_unit_files = unit_test_files.filter((f) => fs.existsSync(path.join(repo_root, f)))
  if (present_unit_files.length < unit_test_files.length)
    console.log(
      `ares: unit slice filtered to ${present_unit_files.length}/${unit_test_files.length} rows present in this tree`
    )
  let exit_code = run('bun', ['test', ...present_unit_files], repo_root)
  if (exit_code !== 0) return exit_code
  exit_code = run_fight_core(run) // S2: the 4 fight-core gates + core units are part of the default gate
  if (exit_code !== 0) return exit_code
  exit_code = run_world_core(run) // D770a: the world core's suite + hermeticity ride the same slice
  if (exit_code !== 0) return exit_code
  return run_ledger_gate(run) // every complaint maps to a discoverable gate (pure, rig-free)
}
// RENDER GOLD — the fight render suite's pixel rows (packages/engine/bench/render_gold.mjs: damage
// floater + cast VFX on the real ?board=1 WebGPU board, degenerate floor + region-censused change with a
// controlled red twin). Needs a real GPU browser (headed Metal) + its own isolated vite (:5263), so it is a
// SELECTOR leg like gold/anchor — never the default no-selector pipeline. Born from the 2026-07-18
// "no more floating numbers in fights" report: every data oracle was green while the screen was the bug.
function run_render_gold(run = run_test_command) {
  const exit_code = run(process.execPath, [path.join(repo_root, 'packages/engine/bench/render_gold.mjs')], repo_root)
  if (exit_code !== 0) return exit_code
  // v30 P1 golden row — "rendering the login backdrop": the logged-out landing must present the LIVE
  // world behind the glass login (packages/frontend/bench/login_backdrop_gold.mjs; same idiom: headed
  // GPU browser, degenerate floor + region assert, own isolated vite :5601).
  return run(process.execPath, [path.join(repo_root, 'packages/frontend/bench/login_backdrop_gold.mjs')], repo_root)
}
export function run_tests(selector = null, run = run_test_command) {
  if (selector === 'prod') return run('bun', ['scripts/prod_asset_tier.mjs'], repo_root)
  if (selector === 'prod-smoke') return run_gold_suite('prod-smoke', run)
  if (selector === 'fightcore') return run_fight_core(run)
  if (selector === 'combo') return run_combo(run)
  if (selector === 'ledger') return run_ledger_gate(run)
  if (selector === 'render') return run_render_gold(run)
  if (selector === 'unit') return run_unit_slice(run)
  if (selector) {
    if (!gold_suites.includes(selector)) return 2
    if (selector === 'multiplayer') {
      const unit_exit = run_orchestrator_units(run)
      if (unit_exit !== 0) return unit_exit
    }
    return run_gold_suite(selector, run)
  }
  let exit_code = run_unit_slice(run)
  if (exit_code !== 0) return exit_code
  exit_code = run('bash', [path.join(repo_root, 'scripts/check-constraints.sh'), '--hardcoded-ids'], repo_root)
  if (exit_code !== 0) return exit_code
  exit_code = run('bun', ['run', 'test'], repo_root)
  if (exit_code !== 0) return exit_code
  exit_code = run_orchestrator_units(run)
  if (exit_code !== 0) return exit_code
  for (const suite of gold_suites) {
    exit_code = run_gold_suite(suite, run)
    if (exit_code !== 0) return exit_code
  }
  return 0
}
function usage() {
  console.error(
    'usage: bun ares status | bun ares publish --dry | bun ares test [unit|gold|anchor|multiplayer|prod|prod-smoke|fightcore|combo|ledger|render] | bun ares check ids [--strict|--inventory]'
  )
}
async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'status' && args.length === 0) return run_status()
  if (command === 'publish' && args.length === 1 && args[0] === '--dry') return run_publish_dry()
  if (command === 'test' && args.length <= 1) return run_tests(args[0] ?? null)
  const id_args = args.slice(1)
  if (command === 'check' && args[0] === 'ids' && id_args.every((arg) => ['--strict', '--inventory'].includes(arg)))
    return run_test_command(
      'bash',
      [path.join(repo_root, 'scripts/check-constraints.sh'), '--hardcoded-ids', ...id_args],
      repo_root
    )
  usage()
  return 1
}
if (process.argv[1] && path.resolve(process.argv[1]) === script_path) {
  try {
    process.exitCode = await main()
  } catch (error) {
    console.error(`ares: ${error_reason(error)}`)
    process.exitCode = 1
  }
}
