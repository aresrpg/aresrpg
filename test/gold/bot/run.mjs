// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GOLD BOT RUNNER (§1c framework core, lane B0) — executes a declarative BEHAVIOR FILE against a TARGET, in
// `--mode sdk` (headless PTB gameplay — the fast "pure gameplay" control group) or `--mode ui` (the real
// frontend, UX findings — rider 2026-07-11). Money rails are REAL from day one: wallet-source law, spend
// cap, per-tx ceiling, executed-failure latch (tx-burn law — a digest is never re-fired), pace budgets, loop +
// PROGRESS watchdogs (soft-lock detection), NDJSON evidence, and per-fight BALANCE recording (§1c).
//
//   node test/gold/bot/run.mjs <behavior.js> --target localnet --wallet fresh            # sdk mode (default)
//   node test/gold/bot/run.mjs <behavior.js> --target localnet --wallet fresh --mode ui  # ui mode (needs L1)
//   node test/gold/bot/run.mjs <behavior.js> --target mainnet --wallet env:CANARY_KEY --spend-cap 1 --confirm-mainnet
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { P, RPC, FAUCET, API, log, ensureDeps, genKeypairs } from '../lib_gold.mjs'

import { build_sdk_backend } from './backend_sdk.mjs'
import { make_oracles } from './oracles.mjs'
import { make_balance } from './balance.mjs'
import { ui_run } from './ui_driver.mjs'
import { compile_behavior, verify_expected_abort } from './behavior.mjs'

// ── targets: the dual-posture table (§1c). localnet = full pass; testnet/mainnet = canary. ────
const TARGETS = {
  localnet: {
    rpc: RPC,
    faucet: FAUCET,
    api: API,
    wallet_sources: ['fresh', 'env'],
    pace_ms: [0, 0],
    spend_cap_sui: 50,
    per_tx_cap_sui: 1,
    admin_ok: true,
    needs_manifest: true,
  },
  // testnet/mainnet `rpc` defaults below are UNREACHABLE from the gold localnet boot chain (up_gold.mjs never
  // drives this target — only an explicit `--target testnet|mainnet` CLI call does); `needs_manifest: false`
  // means no gold manifest ever exists to resolve them from, so the env-fallback default is justified here.
  testnet: {
    rpc: process.env.SUI_RPC ?? 'https://sui-testnet-rpc.publicnode.com',
    faucet: null,
    api: process.env.GOLD_API ?? null,
    wallet_sources: ['env'],
    pace_ms: [1500, 8000],
    spend_cap_sui: 2,
    per_tx_cap_sui: 0.1,
    admin_ok: false,
    needs_manifest: false,
  },
  mainnet: {
    rpc: process.env.SUI_RPC ?? 'https://sui-rpc.publicnode.com',
    faucet: null,
    api: process.env.GOLD_API ?? null,
    wallet_sources: ['env'],
    pace_ms: [1500, 8000],
    spend_cap_sui: 1,
    per_tx_cap_sui: 0.1,
    admin_ok: false,
    needs_manifest: false,
    confirm_flag: true,
  },
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────
function parse_args(argv) {
  const [behavior_path, ...rest] = argv
  const flags = {}
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]
    if (a === '--confirm-mainnet') flags.confirm_mainnet = true
    else if (a.startsWith('--')) flags[a.slice(2).replaceAll('-', '_')] = rest[++i]
  }
  return { behavior_path, flags }
}
const die = (code, msg) => {
  console.error(`[bot] REFUSED: ${msg}`)
  process.exit(code)
}

const rpc_call = async (rpc, method, params = []) =>
  (
    await (
      await fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
    ).json()
  ).result
const balance_sui = async (rpc, address) =>
  Number((await rpc_call(rpc, 'suix_getBalance', [address]))?.totalBalance ?? 0) / 1e9

// ── the run ────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const { behavior_path, flags } = parse_args(process.argv.slice(2))
  if (!behavior_path)
    die(2, 'usage: run.mjs <behavior.js> --target <t> --wallet <src> [--mode sdk|ui] [--spend-cap SUI]')
  const target_name = flags.target ?? 'localnet'
  const target = TARGETS[target_name] ?? die(2, `unknown target '${target_name}'`)
  const mode = flags.mode ?? 'sdk'
  if (!['sdk', 'ui'].includes(mode)) die(2, `unknown --mode '${mode}' (sdk | ui)`)

  // MONEY RAILS FIRST (§1c canary safety) — refuse before any I/O.
  if (target.confirm_flag && !flags.confirm_mainnet)
    die(2, 'mainnet needs --confirm-mainnet (real SUI is never a default)')
  const wallet_src = flags.wallet ?? (target_name === 'localnet' ? 'fresh' : null)
  if (!wallet_src) die(2, `--wallet required for ${target_name} (env:<VAR> — a dedicated funded canary key)`)
  const src_kind = wallet_src === 'fresh' ? 'fresh' : wallet_src.split(':')[0]
  if (!target.wallet_sources.includes(src_kind))
    die(
      2,
      `wallet source '${src_kind}' forbidden on ${target_name} (allowed: ${target.wallet_sources}; never an owner/master key)`
    )
  if (src_kind === 'env' && /master|owner|main/i.test(wallet_src))
    die(2, `refusing suspicious key name '${wallet_src}' (prod-key fence)`)
  const spend_cap = Number(flags.spend_cap ?? target.spend_cap_sui)
  const max_minutes = Number(flags.max_minutes ?? 120)
  const max_executed_failures = 3
  const progress_stall = Number(flags.progress_stall ?? 6) // consecutive non-progressing `do` steps → soft-lock

  ensureDeps()
  const behavior = (await import(pathToFileURL(path.resolve(behavior_path)).href)).default
  const steps = compile_behavior(behavior)
  const manifest = target.needs_manifest ? JSON.parse(fs.readFileSync(P.DEPLOY, 'utf8')) : null
  // localnet's `target.rpc` above is a module-load-time default (env `GOLD_RPC` via lib_gold's `RPC`); once
  // the manifest is on disk it is authoritative — override so a mismatched isolation-lane env can never
  // silently aim this bot at the wrong localnet (BOOT-NET-2 sweep, 2026-07-16).
  if (manifest?.rpc) target.rpc = manifest.rpc
  const api = target.api ?? die(2, `no /v1 api for ${target_name} — set GOLD_API`)

  // wallet
  let wallet
  if (src_kind === 'fresh') [wallet] = await genKeypairs(1)
  else {
    const key = process.env[wallet_src.split(':')[1]]
    if (!key) die(2, `env ${wallet_src.split(':')[1]} is unset`)
    wallet = { privkey: key, address: null }
  }

  // evidence
  const run_id = flags.run_id ?? `${behavior.name}_${mode}_${Date.now()}`
  const out_dir = path.join(P.OUT, 'bot', run_id)
  fs.mkdirSync(out_dir, { recursive: true })
  const trace_path = path.join(out_dir, 'trace.ndjson')
  const t_run = Date.now()
  const record = (row) => fs.appendFileSync(trace_path, `${JSON.stringify({ ts: Date.now(), ...row })}\n`)

  // ── UI MODE: delegate to the real-frontend driver (refuses on localnet until L1 — rider seam) ─────
  if (mode === 'ui') {
    const budgets = fs.existsSync(path.join(P.GOLD, 'budgets.json'))
      ? JSON.parse(fs.readFileSync(path.join(P.GOLD, 'budgets.json'), 'utf8'))
      : {}
    const r = await ui_run({ behavior, target: target_name, out_dir, baseline: null, budgets })
    const summary = {
      behavior: behavior.name,
      target: target_name,
      mode,
      verdict: r.verdict,
      error: r.error,
      ux: r.ux ?? null,
      ms: Date.now() - t_run,
    }
    fs.writeFileSync(path.join(out_dir, 'summary.json'), JSON.stringify(summary, null, 2))
    console.log(`BOT RUN ${behavior.name} · mode=ui · target=${target_name} · ${r.verdict} · ${r.error}`)
    process.exit(r.verdict === 'GREEN' ? 0 : 3) // 3 = BLOCKED (an honest boundary, not a red gameplay failure)
  }

  // ── SDK MODE: the pure-gameplay control (headless PTB composition) ───────────────────────────────────
  const backend = await build_sdk_backend({ manifest, wallet })
  const balance = make_balance()
  const state = {
    spent_sui: 0,
    executed_failures: 0,
    step_count: 0,
    checkpoints: [],
    fights_won: 0,
    stall: 0,
    findings: [],
  }
  const oracles = make_oracles({ api, rpc: target.rpc, wallet, manifest, state, backend })

  const guard = () => {
    state.spent_sui = backend.gas_sui()
    state.executed_failures = backend.stats.executed_failures
    if (state.spent_sui + target.per_tx_cap_sui > spend_cap)
      throw new Error(
        `SPEND CAP: ${state.spent_sui.toFixed(3)} + next ≤${target.per_tx_cap_sui} SUI would exceed --spend-cap ${spend_cap}`
      )
    if (state.executed_failures >= max_executed_failures)
      throw new Error(
        `FAILURE LATCH: ${state.executed_failures} executed failures — stopping (never retried; tx-burn law)`
      )
    if (Date.now() - t_run > max_minutes * 60_000) throw new Error(`RUN BUDGET: exceeded --max-minutes ${max_minutes}`)
  }
  const pace = async () => {
    const [lo, hi] = target.pace_ms
    if (hi > 0) await new Promise((r) => setTimeout(r, lo + Math.random() * (hi - lo)))
  }

  async function check(assert) {
    const fn = oracles[assert.oracle] ?? die(3, `unknown oracle '${assert.oracle}'`)
    const value = await fn(assert.args ?? {})
    const ok =
      ('eq' in assert && value === assert.eq) ||
      ('gte' in assert && value >= assert.gte) ||
      ('lte' in assert && value <= assert.lte) ||
      ('within' in assert && value >= assert.within[0] && value <= assert.within[1])
    return { ok, value }
  }

  // built-in (infra) executors + the SDK-choke verb set from the backend
  const builtins = {
    noop: async () => ({ ok: true }),
    faucet_fund: async ({ sui = 2 }) => {
      if (!target.faucet) {
        const bal = await balance_sui(target.rpc, wallet.address)
        return { ok: bal > 0, note: `canary pre-funded balance=${bal} SUI` }
      }
      for (let i = 0; i < Math.ceil(sui); i += 1)
        await fetch(`${target.faucet}/gas`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ FixedAmountRequest: { recipient: wallet.address } }),
        }).catch(() => {})
      await new Promise((r) => setTimeout(r, 600))
      return { ok: (await balance_sui(target.rpc, wallet.address)) > 0 }
    },
  }
  const resolve_exec = (name) => builtins[name] ?? backend.verbs.get(name)

  async function run_steps(list, depth = 0) {
    for (const step of list) {
      guard()
      state.step_count += 1
      const t0 = Date.now()
      if (step.expect_abort) {
        const expected = step.expect_abort
        const exec = resolve_exec(expected.do)
        if (!exec) throw new Error(`executor '${expected.do}' unknown for expect_abort`)
        const verified = await verify_expected_abort({
          step,
          execute: (args) => exec({ ...args, __expect_abort: true }),
          snapshot: async (oracle, args) => {
            const fn = oracles[oracle]
            if (!fn) throw new Error(`unknown expect_abort oracle '${oracle}'`)
            return fn(args)
          },
        })
        record({
          expect_abort: expected,
          actual: verified.result,
          before: verified.before,
          after: verified.after,
          ok: true,
          ms: Date.now() - t0,
        })
        log(`expect_abort ${expected.module}::${expected.abort_code} → ok (${Date.now() - t0}ms)`)
      } else if (step.do) {
        const exec = resolve_exec(step.do)
        if (!exec)
          throw new Error(
            `executor '${step.do}' unknown (declared-missing: ${backend.declared_missing.join(', ') || 'none'})`
          )
        await pace()
        const res = await exec(step.with ?? {})
        record({ step: step.do, with: step.with, ...res, ms: Date.now() - t0 })
        log(`step ${step.do} → ${res.ok ? 'ok' : 'FAIL'}${res.note ? ` · ${res.note}` : ''} (${Date.now() - t0}ms)`)
        if (res.balance) {
          balance.record(res.balance)
          if (res.balance.won) state.fights_won += 1
        }
        // OPTIONAL steps (best-effort progression legs — gather/craft/economy that may hit a content/SDK gap) do
        // NOT kill the soak: a failure is recorded as a FINDING — a blocker list entry, each with the failing
        // step + evidence — and the loop continues. Mandatory steps still throw (RED) on failure.
        if (!res.ok) {
          if (step.optional) {
            state.findings.push({
              step: step.do,
              with: step.with,
              note: res.note ?? 'no detail',
              kind: 'optional_step_blocked',
            })
            log(`OPTIONAL step ${step.do} blocked → finding · ${res.note ?? ''}`)
            continue
          }
          throw new Error(`step '${step.do}' failed: ${res.note ?? 'no detail'}`)
        }
        // PROGRESS WATCHDOG: a step that succeeds but yields no observable delta is a soft-lock signal.
        if (res.noop || res.declared_pending) {
          /* declared no-op — neither progress nor stall */
        } else if (res.progressed) state.stall = 0
        else if ((state.stall += 1) >= progress_stall)
          throw new Error(
            `PROGRESS WATCHDOG: ${progress_stall} consecutive steps with no state delta (soft-lock) — trace at ${trace_path}`
          )
      } else if (step.assert) {
        const { ok, value } = await check(step.assert)
        record({ assert: step.assert, value, ok, ms: Date.now() - t0 })
        log(`assert ${step.assert.oracle} = ${JSON.stringify(value)} → ${ok ? 'ok' : 'FAIL'}`)
        if (!ok)
          throw new Error(
            `assert failed: ${step.assert.oracle} = ${JSON.stringify(value)} vs ${JSON.stringify(step.assert)}`
          )
      } else if (step.checkpoint) {
        state.checkpoints.push(step.checkpoint)
        record({ checkpoint: step.checkpoint, balance: balance.fights.length })
        log(`checkpoint · ${step.checkpoint}`)
      } else if (step.loop) {
        const t_loop = Date.now()
        for (let i = 0; i < step.max_iters; i += 1) {
          if (Date.now() - t_loop > step.max_minutes * 60_000)
            throw new Error(`loop watchdog: max_minutes ${step.max_minutes}`)
          const { ok } = await check(step.until)
          if (ok) break
          if (i === step.max_iters - 1) throw new Error(`loop watchdog: max_iters ${step.max_iters} without 'until'`)
          await run_steps(step.loop, depth + 1)
        }
      }
    }
  }

  let verdict = 'GREEN'
  let error = null
  try {
    await run_steps(steps)
  } catch (e) {
    verdict = 'RED'
    error = String(e?.message ?? e)
    record({ fatal: error })
  }
  state.spent_sui = backend.gas_sui()
  const balance_report = balance.report(out_dir)
  const summary = {
    behavior: behavior.name,
    target: target_name,
    mode,
    wallet: wallet.address,
    verdict,
    error,
    steps: state.step_count,
    checkpoints: state.checkpoints,
    spent_sui: Number(state.spent_sui.toFixed(4)),
    executed_failures: backend.stats.executed_failures,
    contention: backend.stats.classes,
    fights: balance_report.total_fights,
    fights_won: state.fights_won,
    inventory: backend.ctx.inventory.length,
    level_final: backend.read_level(),
    stat_points_spent: backend.ctx.stat_spent ?? 0,
    balance_findings: balance_report.findings.length,
    findings: state.findings, // optional-leg blockers (the run's blocker list)
    declared_missing: backend.declared_missing,
    ms: Date.now() - t_run,
    trace: trace_path,
  }
  fs.writeFileSync(path.join(out_dir, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(
    `BOT RUN ${behavior.name} · mode=sdk · target=${target_name} · ${verdict} · steps=${state.step_count} · fights=${summary.fights}(won ${summary.fights_won}) · spent=${summary.spent_sui} SUI · ${summary.ms}ms · ${trace_path}`
  )
  process.exit(verdict === 'GREEN' ? 0 : 1)
}

main().catch((e) => {
  console.error('[bot] fatal:', e)
  process.exit(1)
})
