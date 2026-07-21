// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #304 STANDING GATE — browser reads leave the fullnode. Constitution: player DISPLAY reads ride the keyless
// `/v1` read layer (packages/rpc); the fullnode is for server-side paths (api/sponsor.mjs — the verified
// POSITIVE CONTROL below) plus a small, EXPLICITLY NAMED set of browser exceptions (tx pre-flight state and
// documented /v1 gaps — SPEC's "chain-direct ONLY for tx pre-flight" carve-out, e.g. craft_actions.js below).
//
// WHY THIS SHAPE, NOT A DIST-BUNDLE STRING GREP: the fullnode URL literal
// (`https://fullnode.testnet.sui.io:443`, packages/sdk/src/sui.js) is the SHARED transport default for the
// SDK's `grpc_client` — every sanctioned chain-direct read (checkpoint DFs, spell-state DFs, item-template
// stat detail, this file's own allowlist) transitively reaches it too, so "zero fullnode literal anywhere in
// the built bundle" can never be green while ANY legitimate chain-direct read remains (and some always will —
// see the /v1 GAPS below). The actual incident shape — BOTH the cured shop-sales storm and the #304 world_levels
// storm this lane fixes — is a BATCH object fan-out (`grpc_client.core.getObjects`, wire method
// `sui.rpc.v2.LedgerService/BatchGetObjects`) fired from a browser DISPLAY read: N objects in one browser
// action, no server backoff, straight at the public fullnode. That is what this gate enforces: an EXPLICIT,
// justified ALLOWLIST of the files permitted to call the batch method at all. A NEW call site (or a NEW class
// re-widening the DEAD entries below into a live path) fails here, naming the offending file:line, before it
// ever reaches players — the same role .dependency-cruiser.cjs's forbidden-import rules play one layer up.
//
// SINGULAR `grpc_client.core.getObject` (one object, not a fan-out — checkpoint/spell_state DF reads,
// tx-preflight kiosk/fight-ref resolution, single-character reads) is OUT OF SCOPE here: it cannot storm by
// construction (one request per call site invocation), so it doesn't carry the incident's blast radius. Those
// remaining chain-direct reads are documented /v1 GAPS (issue #242), not gate violations:
//   - read_checkpoint.js  — character position+time DF; no /v1 projection (ZoneSearched carries no x/z).
//   - read_spell_state.js — per-character spell-allocation DFs; no /v1 projection (no DF pagination view).
//   - read_findables.js `get_template_detail_map` — full stat/damage/consumable-effect detail; /v1/encyclopedia
//     carries only name/level/category/description/supply for an item template, not the stat spread.
// All three already degrade honestly (try/catch to null/[]/empty Map, never an unhandled rejection or a raw
// console storm) — verified by reading every caller, not just the reader.
//
// packages/sdk is NOT walked here: its `sui/read/*.js` helpers are transport-AGNOSTIC (grpc_client arrives as
// a parameter — see sui.js's context object) — the fullnode-vs-not decision is made entirely by the CALLER
// that constructs `SDK({ network })`, and in production that's exactly one place: chain/sdk.ts (browser). No
// server-side production code shares that factory (api/sponsor.mjs builds its own independent SuiGrpcClient —
// the sanctioned server positive control, asserted below); the "split transport injection instead of
// environment-sniffing" seam issue #304 asks for is therefore already satisfied by construction — there is no
// function today serving both a browser and a server call site to split.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'bun:test'

const FRONTEND_SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const REPO_ROOT = path.resolve(FRONTEND_SRC, '..', '..', '..')

const BATCH_CALL_RE = /\.getObjects\s*\(/g

// Every file permitted to call the batch fan-out method, with WHY. Grow this list only with a reviewed reason;
// shrink it the moment a reason stops being true (severities-only-ratchet-up law, docs/CODE_LAW.md).
const ALLOWLIST = {
  'chain/read_staking.js':
    'get_owned_items — /v1 FIRST (/v1/owner-items); this batch read fires ONLY as the sanctioned /v1-outage ' +
    'fallback (get_owned_items catches the /v1 failure before ever reaching it) — the reference pattern for a gap.',
  'world-shell/craft_actions.js':
    'template_slugs/build_recipe_index — resolves the craft recipe index at TX PRE-FLIGHT (SPEC-sanctioned: ' +
    '"chain-direct ONLY for tx pre-flight"), never a display list; no /v1 RecipeCreated projection exists ' +
    '(packages/rpc defers it — Rust out of scope) to reroute to instead.',
  'chain/read_templates.js':
    'get_mob_templates/get_item_templates — CONFIRMED DEAD (zero live callers: onchain_templates.ts dropped ' +
    'its only consumer, use_onchain_templates, in this #304 lane; grep of dist/assets/*.js for the ' +
    'MobTemplateCreated event-type literal finds nothing). Kept — not deleted — because ' +
    'read_templates.test.js pins a real historical chain-shape bug (event-type/field-name mismatch, ' +
    '2026-07-14) against the LIVE network; deleting the reader would delete that regression coverage. Not ' +
    'browser-reachable today; flagged for the lead/owner to action (delete outright, or wire a real consumer).',
  'chain/read_findables.js':
    'get_owned_items_by_id (resolve_recall_drops) — CONFIRMED DEAD (resolve_recall_drops itself has zero ' +
    "callers anywhere in the tree; not in dist). Left in place per this lane's scope fence (pre-existing, " +
    'unrelated to the #304 world_levels fix) — flagged for the lead to delete or wire up.',
  'chain/read_treasury.js':
    'get_treasury_snapshot — CONFIRMED DEAD (zero callers; the admin SUI tab it was built for does not exist ' +
    "in the current app — not in dist). Left in place per this lane's scope fence — flagged for the lead.",
}

function walk_js_files(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    const stat = statSync(p)
    if (stat.isDirectory()) out.push(...walk_js_files(p))
    else if (/\.(js|ts|jsx|tsx)$/.test(name) && !/\.test\.[cm]?[jt]sx?$/.test(name)) out.push(p)
  }
  return out
}

function batch_call_lines(file) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  const hits = []
  lines.forEach((line, idx) => {
    BATCH_CALL_RE.lastIndex = 0
    if (BATCH_CALL_RE.test(line)) hits.push(idx + 1)
  })
  return hits
}

describe('#304 standing gate — browser grpc_client.core.getObjects (fullnode batch fan-out)', () => {
  it('api/sponsor.mjs is the verified server-side positive control (the sweep sees legitimate fullnode use)', () => {
    const sponsor_source = readFileSync(path.join(REPO_ROOT, 'api', 'sponsor.mjs'), 'utf8')
    expect(sponsor_source).toMatch(/SPONSOR_GRPC_URL.*fullnode/)
    expect(sponsor_source).toMatch(/new SuiGrpcClient/)
  })

  it('every batch getObjects call site in packages/frontend/src is a reviewed, named allowlist entry', () => {
    const files = walk_js_files(FRONTEND_SRC)
    const violations = []
    for (const file of files) {
      const rel = path.relative(FRONTEND_SRC, file)
      const hits = batch_call_lines(file)
      if (hits.length === 0) continue
      if (!(rel in ALLOWLIST)) violations.push(...hits.map((line) => `${rel}:${line} — NOT in the allowlist`))
    }
    expect(violations).toEqual([])
  })

  it('the allowlist carries no stale entries (a file that no longer calls getObjects must be pruned)', () => {
    const stale = []
    for (const rel of Object.keys(ALLOWLIST)) {
      const file = path.join(FRONTEND_SRC, rel)
      let hits = []
      try {
        hits = batch_call_lines(file)
      } catch {
        stale.push(`${rel} — file no longer exists`)
        continue
      }
      if (hits.length === 0) stale.push(`${rel} — no getObjects call left; prune this allowlist entry`)
    }
    expect(stale).toEqual([])
  })
})
