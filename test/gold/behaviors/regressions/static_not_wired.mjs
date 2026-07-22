#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// STATIC "NOT-WIRED" REGRESSION FENCE (docs/REGRESSION_ENFORCEMENT.md · the L11 not-wired-static lane).
// Runs with ZERO localnet — pure source inspection — so it can gate every publish cheaply and instantly.
//
// Each check pins a reported wiring regression: it PASSES on today's fixed source and turns RED the
// moment the fix is reverted. A missing target file is reported RED-by-name (never a silent pass — mirrors the
// gate's absent-track philosophy in test/localnet/gate/signals.mjs). INFO rows document known-pending gaps
// (e.g. an SDK builder that lands with the republish) without failing the suite.
//
//   node test/gold/behaviors/regressions/static_not_wired.mjs
// exit 0 = all fences green · exit 1 = a wiring regression (or a target file vanished).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..', '..') // test/gold/behaviors/regressions → repo root
const FE = path.join(REPO, 'packages', 'frontend', 'src')
const MOVE = path.join(REPO, 'packages', 'move')

// Read a source file and strip //-line-comments + /* */ blocks so checks match LIVE code, not the prose that
// documents the old pattern (read_shop_sales.js literally names `get_item_template` in its migration comment).
function code_of(abs) {
  if (!fs.existsSync(abs)) return null
  let s = fs.readFileSync(abs, 'utf8')
  s = s.replace(/\/\*[\s\S]*?\*\//g, '')
  s = s
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
  return s
}
const results = []
const record = (name, status, detail) => results.push({ name, status, detail })
// status: PASS | FAIL | INFO. A check whose target file is missing records FAIL (regression: the file moved
// out from under the fence) with a clear note.
function check(name, { file, pass, why }) {
  const code = code_of(file)
  if (code == null)
    return record(name, 'FAIL', `target file not found: ${path.relative(REPO, file)} (fence lost its subject)`)
  try {
    const ok = pass(code)
    record(name, ok ? 'PASS' : 'FAIL', why(code, ok))
  } catch (e) {
    record(name, 'FAIL', `check threw: ${String(e?.message ?? e)}`)
  }
}

// ── R-ECON-1 · shop reads through /v1, never the 60-BatchGetObjects/mount gRPC storm (07-10 13:35) ──────────
check('shop_reads_v1', {
  file: path.join(FE, 'chain', 'read_shop_sales.js'),
  pass: (c) => /get_encyclopedia\s*\(/.test(c) && !/\bget_item_template\s*\(/.test(c) && !/BatchGetObjects/.test(c),
  why: (c, ok) =>
    ok
      ? 'reads /v1 get_encyclopedia; no per-sale get_item_template() chain fan-out'
      : 'shop fell back to chain-direct get_item_template() — the 60 BatchGetObjects/mount storm regressed',
})

// ── R-ECON-1b · marketplace load reads /v1, never the graphql.testnet event-replay + BatchGetObjects (07-10) ──
check('marketplace_reads_v1', {
  file: path.join(FE, 'stores', 'marketplace_chain.ts'),
  pass: (c) => /get_listings\s*\(|get_encyclopedia\s*\(/.test(c) && !/\.getKiosk\s*\(|graphql\.\w+\.sui\.io/.test(c),
  why: (c, ok) =>
    ok
      ? 'marketplace load() reads /v1 get_listings + get_encyclopedia; no graphql replay'
      : 'marketplace load() hits graphql/getKiosk again — the GraphQL event-replay storm regressed',
})

// ── R-CRAFT-1 · craft is wired to a real PTB, not a dead on_craft FLAG with zero craft_ptb callers ──────────
check('craft_wired', {
  file: path.join(FE, 'world-shell', 'craft_actions.js'),
  pass: (c) => /craft_ptb\s*\(/.test(c),
  why: (c, ok) =>
    ok
      ? 'craft_actions.js composes sdk.craft_ptb(...) — craft is wired (was a no-op FLAG in the 07-11 pickaxe report)'
      : 'no craft_ptb() caller — craft regressed to an unwired stub',
})

// ── R-PROG-2 · the stat-allocation Move door exists (R3 landed); the SDK/frontend wire is the tracked gap ──
check('stat_alloc_move_door', {
  file: path.join(MOVE, 'aresrpg', 'sources', 'stat_allocation.move'),
  pass: (c) => /public\s+fun\s+raise_stat\b|entry\s+fun\s+raise_stat\b|fun\s+raise_stat\b/.test(c),
  why: (c, ok) =>
    ok
      ? 'stat_allocation::raise_stat exists on-chain (R3) — the "stat points unspendable" root (available_points always 0) is fixed at the Move layer'
      : 'stat_allocation::raise_stat missing — stat points remain permanently unspendable',
})

// ── R-ECON-3 · the royalty-bypass rule (0-amount ghost-stack block) exists on-chain (R1b) ───────────────────
check('royalty_listing_rule', {
  file: path.join(MOVE, 'aresrpg', 'sources', 'item_listing_rule.move'),
  pass: (c) => /EZeroAmount\b/.test(c) && /prove_amount\b/.test(c),
  why: (c, ok) =>
    ok
      ? 'item_listing_rule::prove_amount + EZeroAmount present — 0-amount ghost-stack royalty dodge is blocked'
      : 'item_listing_rule guard missing — the royalty-bypass ghost stack reopened',
})

// ── R-FIGHT-4 · mobs that reposition emit MobMoved (07-11 forensics "Mystery A" silent reposition) ──────────
check('mob_move_event', {
  file: path.join(MOVE, 'engine', 'sources', 'turns.move'),
  pass: (c) => /emit_mob_moved\b/.test(c), // turns.move:258 fires fight_events::emit_mob_moved on any cell change
  why: (c, ok) =>
    ok
      ? 'turns.move calls emit_mob_moved on reposition — no more silent AI repositions (invisible to indexer/spectator)'
      : 'resolve_mob_turn repositions with no emit_mob_moved again — mobs move invisibly (the "Mystery A" root)',
})

// ── INFO (non-failing, tracked gaps) ────────────────────────────────────────────────────────────────────────
const backend = code_of(path.join(REPO, 'test', 'gold', 'bot', 'backend_sdk.mjs')) ?? ''
if (/declared_missing\.push\('spend_stat_points'\)/.test(backend))
  record(
    'stat_points_sdk_wire',
    'INFO',
    'backend_sdk still declares spend_stat_points MISSING — the SDK builder + frontend wire land with the republish (Move door already exists; see stat_alloc_move_door=PASS). B-wave: add raise_stat_ptb.'
  )

// ── report + exit ─────────────────────────────────────────────────────────────────────────────────────────
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n)
console.log('─'.repeat(92))
console.log(' STATIC NOT-WIRED REGRESSION FENCE (docs/REGRESSION_ENFORCEMENT.md)')
console.log('─'.repeat(92))
for (const r of results) console.log(`  [${pad(r.status, 4)}] ${pad(r.name, 22)} ${r.detail}`)
const failed = results.filter((r) => r.status === 'FAIL')
console.log('─'.repeat(92))
console.log(
  `  RESULT: ${failed.length === 0 ? 'GREEN ✓ — no wiring regressions' : `RED ✗ — ${failed.length} wiring regression(s)`}`
)
console.log('─'.repeat(92))
process.exit(failed.length === 0 ? 0 : 1)
