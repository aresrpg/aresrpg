// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PROGRESSION SOAK ORCHESTRATOR — drives the L50 progression soak on an ALREADY-BOOTED
// gold-soak stack: (1) cranks xp/loot to the sanctioned test max (×1000, descending-probe the on-chain ceiling),
// (2) runs the bot behaviors as child processes (bot/run.mjs, sdk mode), (3) AGGREGATES their balance_report +
// summary into out/bot/soak_report.json — DATA over feelings: max level per bot, the
// level-vs-time / level-vs-fight curves, win/loss/deaths per bracket, stat points spent, and the REAL-RATE (x1)
// projections (fights + hours to L10/25/50 — "divide the times on the curves"), plus every friction/gap finding.
//
// FENCE: test/gold only. Reads the gold-soak manifest (P.DEPLOY, env-resolved). Admin dials use the localnet
// throwaway publisher key from the manifest. Run AFTER up_gold; tear down with down_gold (both env-scoped).
//   source /tmp/gold_soak_env.sh && node test/gold/bot/soak.mjs [--fighter-only]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { P, log, makeClient, signerOf } from '../lib_gold.mjs'
import { load_deps } from '../deps_gold.mjs'
import { levels } from '../../../packages/sdk/src/experience.js'

const { REPO } = P
const manifest = JSON.parse(fs.readFileSync(P.DEPLOY, 'utf8'))
const ids = manifest.ids.aresrpg
const fighter_only = process.argv.includes('--fighter-only')

// ── the xp/loot multiplier crank (config::set_xp/loot_multiplier — unit: 100 = ×1.00, so ×1000 = 100_000) ──────
// Descending probe so we get the HIGHEST reachability the on-chain MULT_MAX allows without a guessed constant.
async function crank_multiplier() {
  const { Transaction } = await load_deps()
  const client = await makeClient(manifest.rpc)
  const signer = await signerOf(manifest.publisher.privkey)
  const pkg = ids.LATEST_PACKAGE_ID
  // XP is cranked HIGH (reachability) but LOOT stays ×1 (unit 100): the loot multiplier scales drop QUANTITIES, and
  // at ×1000 a "1-3 iron_ore" drop becomes 1000-3000 units — no subset ever sums to a recipe's exact 2/3, so craft
  // (EXACT tally) becomes impossible. ×1 loot keeps drops at the authored 1-3 units → deterministic, craftable.
  const LOOT_MULT = 100
  for (const xp of [100_000, 10_000, 4_000, 400]) {
    const tx = new Transaction()
    tx.moveCall({
      target: `${pkg}::config::set_xp_multiplier`,
      arguments: [tx.object(ids.ADMIN_ARESRPG), tx.object(ids.GAME_CONFIG), tx.pure.u64(xp), tx.object(ids.VERSION)],
    })
    tx.moveCall({
      target: `${pkg}::config::set_loot_multiplier`,
      arguments: [
        tx.object(ids.ADMIN_ARESRPG),
        tx.object(ids.GAME_CONFIG),
        tx.pure.u64(LOOT_MULT),
        tx.object(ids.VERSION),
      ],
    })
    tx.setGasBudget(1_000_000_000)
    try {
      const r = await client.signAndExecuteTransaction({ signer, transaction: tx, options: { showEffects: true } })
      await client.waitForTransaction({ digest: r.digest })
      if (r?.effects?.status?.status === 'success') {
        log(`cranked xp mult → ${xp} (×${xp / 100}), loot mult → ${LOOT_MULT} (×1) · digest=${r.digest}`)
        return xp
      }
      log(`xp mult ${xp} rejected on-chain (${r?.effects?.status?.error}) — trying lower`)
    } catch (e) {
      log(`xp mult ${xp} threw (${String(e?.message ?? e).split('\n')[0]}) — trying lower`)
    }
  }
  log('WARNING: could not raise the xp multiplier — leaving the boot default (400)')
  return 400
}

// ── run one behavior as a child process (bot/run.mjs, sdk mode); returns its out dir (never throws on RED) ──────
function run_behavior({ file, run_id, extra = [] }) {
  const args = [
    'test/gold/bot/run.mjs',
    file,
    '--target',
    'localnet',
    '--wallet',
    'fresh',
    '--run_id',
    run_id,
    '--max_minutes',
    '38',
    ...extra,
  ]
  let exit = 0
  try {
    execFileSync('node', args, { cwd: REPO, stdio: 'inherit', env: process.env })
  } catch (e) {
    exit = e.status ?? 1
  }
  const dir = path.join(P.OUT, 'bot', run_id)
  const summary = read_json(path.join(dir, 'summary.json'))
  const balance = read_json(path.join(dir, 'balance_report.json'))
  return { run_id, exit, dir, summary, balance }
}
const read_json = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null)

// ── x1 real-rate projection from the (multiplied) fight ledger ─────────────────────────────────────────────────
// raw_xp = granted xp_share ÷ (mult/100). Cumulative raw → level via the on-chain curve. fights/hours-to-Lk at x1.
function project(balance, summary, mult, trace_dir) {
  const fights = balance?.fights ?? []
  const factor = mult / 100 // ×1.00 == 100
  const won = fights.filter((f) => f.won)
  const total_raw = won.reduce((s, f) => s + Number(f.xp_share ?? 0) / factor, 0)
  const raw_per_won = won.length ? total_raw / won.length : 0
  const win_rate = fights.length ? won.length / fights.length : 0
  // per-fight wall time from the trace (fight step ms)
  const trace = read_ndjson(path.join(trace_dir, 'trace.ndjson')).filter((r) => r.step === 'fight' && r.ms != null)
  const avg_fight_s = trace.length ? trace.reduce((s, r) => s + r.ms, 0) / trace.length / 1000 : null
  const proj = {}
  for (const k of [10, 25, 50]) {
    const xp_needed = levels[k] ?? null
    if (!xp_needed || raw_per_won <= 0) {
      proj[`L${k}`] = { reachable: false, note: 'no won-fight raw-xp sample' }
      continue
    }
    const won_needed = Math.ceil(xp_needed / raw_per_won)
    const fights_needed = win_rate > 0 ? Math.ceil(won_needed / win_rate) : won_needed
    proj[`L${k}`] = {
      x1_won_fights: won_needed,
      x1_total_fights: fights_needed,
      x1_hours: avg_fight_s != null ? Number(((fights_needed * avg_fight_s) / 3600).toFixed(2)) : null,
    }
  }
  return {
    applied_mult: mult,
    applied_factor: factor,
    raw_xp_per_won_fight: Number(raw_per_won.toFixed(1)),
    win_rate: Number(win_rate.toFixed(3)),
    avg_fight_seconds: avg_fight_s != null ? Number(avg_fight_s.toFixed(1)) : null,
    x1_projection: proj,
  }
}
function read_ndjson(p) {
  return fs.existsSync(p)
    ? fs
        .readFileSync(p, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l)
          } catch {
            return {}
          }
        })
    : []
}

// ── curves: level-vs-fight and level-vs-elapsed (at the applied mult) from the balance ledger ──────────────────
function curves(balance) {
  const fights = balance?.fights ?? []
  const t0 = fights[0]?.ts ?? 0
  return fights.map((f, i) => ({
    fight: i + 1,
    elapsed_s: t0 ? Number(((f.ts - t0) / 1000).toFixed(1)) : null,
    level_before: f.my_level,
    level_after: f.level_after ?? f.my_level,
    xp_share: f.xp_share,
    cumulative_xp: f.cumulative_xp,
    won: !!f.won,
  }))
}

async function main() {
  log(
    `SOAK on gold-soak · rpc=${manifest.rpc} · world=${manifest.world_id?.slice(0, 12)} · worlds_seeded=${1 + (manifest.seed?.worlds?.length ?? 0)}`
  )
  const mult = await crank_multiplier()
  if (process.argv.includes('--crank-only')) {
    log('crank-only: done')
    return
  }

  const bots = []
  bots.push({
    role: 'fighter',
    ...run_behavior({ file: 'test/gold/behaviors/progression_l50.behavior.js', run_id: 'soak_fighter' }),
  })
  if (!fighter_only)
    bots.push({
      role: 'artisan',
      ...run_behavior({ file: 'test/gold/behaviors/artisan_economy.behavior.js', run_id: 'soak_artisan' }),
    })

  const report = {
    _generated: new Date().toISOString(),
    stack: {
      rpc: manifest.rpc,
      api: manifest.api,
      worlds_seeded: 1 + (manifest.seed?.worlds?.length ?? 0),
      corpus: manifest.seed?.worlds?.length ? 'mainnet' : 'active/minimal',
    },
    applied_multiplier: mult,
    bots: bots.map((b) => ({
      role: b.role,
      verdict: b.summary?.verdict ?? (b.exit === 0 ? 'GREEN' : 'RED/partial'),
      error: b.summary?.error ?? null,
      level_final: b.summary?.level_final ?? null,
      fights: b.summary?.fights ?? 0,
      fights_won: b.summary?.fights_won ?? 0,
      stat_points_spent: b.summary?.stat_points_spent ?? 0,
      inventory: b.summary?.inventory ?? 0,
      checkpoints: b.summary?.checkpoints ?? [],
      spent_sui: b.summary?.spent_sui ?? null,
      brackets: b.balance?.brackets ?? [],
      balance_findings: b.balance?.findings ?? [],
      findings: b.summary?.findings ?? [],
      projection: b.balance ? project(b.balance, b.summary, mult, b.dir) : null,
      curve: b.balance ? curves(b.balance) : [],
    })),
  }
  const out = path.join(P.OUT, 'bot', 'soak_report.json')
  fs.writeFileSync(out, JSON.stringify(report, null, 2))
  log(`\n===== SOAK REPORT → ${out} =====`)
  for (const b of report.bots) {
    log(
      `\n[${b.role}] verdict=${b.verdict} · level_final=${b.level_final} · fights=${b.fights}(won ${b.fights_won}) · stat_pts=${b.stat_points_spent} · inv=${b.inventory}`
    )
    if (b.projection)
      log(
        `  x1 projection: ${JSON.stringify(b.projection.x1_projection)} · raw_xp/won=${b.projection.raw_xp_per_won_fight} · win_rate=${b.projection.win_rate} · avg_fight=${b.projection.avg_fight_seconds}s`
      )
    for (const br of b.brackets)
      log(
        `  bracket ${br.bracket}: ${br.wins}/${br.fights} won (rate ${br.win_rate}) deaths=${br.deaths} avg_turns=${br.avg_turns} xp=${br.total_xp}${br.in_band ? '' : ' ⚠ OUT-OF-BAND'}`
      )
    for (const f of [...(b.findings ?? []), ...(b.balance_findings ?? [])])
      log(`  FINDING · ${f.step ?? f.class ?? ''}: ${f.note}`)
  }
}
main().catch((e) => {
  console.error('[soak] fatal:', e)
  process.exit(1)
})
