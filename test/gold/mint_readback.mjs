// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MINT-FIDELITY READBACK — the third side of the sim↔chain↔seed triangle (board row 22).
//
// twin vectors test sim↔chain on SYNTHETIC args; the V-gates test the SEED; NOTHING ever compared the
// MINTED on-chain effect rows back to the AUTHORED seed intent — so any mint-time transform bug (value
// scaling, kind mapping, dropped element) ships invisibly with every suite green. This closes that side:
// after the gold rig mints the full mainnet spell corpus, it reads EVERY SpellTemplate's on-chain effect
// rows back and diffs them, per effect, per field, against the authored seed row.
//
// TWO orthogonal lenses over the minted corpus:
//   1. TRANSFORM-DRIFT (the prize) — the minted effect must equal the mint's own documented transform of the
//      authored seed (element ?? el_none, |value|, the ?? defaults — reproduced by reseed_plan's normalizers,
//      an INDEPENDENT second implementation of that transform). Any kind/element/value/turns/stat mismatch =
//      the mint and its twin disagree, or a field was dropped, or the object read is corrupt. NEVER baselined.
//      This is where a "-4 predicted vs -1 landed" class of bug would surface as a static value/kind drift.
//   2. ELEMENTLESS-RESIST (the expected first red) — an ALTER_RESIST (kind 11) minted with element=255
//      (spell::el_none) mitigates zero damage (no live corpus damage source deals element=NONE). The legacy 8
//      spells still ship this shape; they live in mint_readback_baseline.json as a SHRINK-ONLY ledger. A NEW
//      spell id with an elementless resist, or a count over baseline (e.g. the mint dropping a NOW-present
//      element on one of the 4 fixed spells), is RED.
//
// Rig lifecycle: REUSE a live rig when .gold-deployment.json answers; else boot up_gold FOREGROUND (generous
// budget). SKIP ≠ PASS: a rig that cannot boot FAILS loudly with the boot evidence, never greens.
//
//   node test/gold/mint_readback.mjs        # reuse-or-boot, read back, write the drift table, exit 0/1
//
// Wired into `ares test anchor` (scripts/ares.mjs) as an anchor-class row; the pure diff is proven by
// mint_readback.test.mjs (the RED-FIRST fixture for the value/kind + novel-elementless red paths).
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  normalize_chain_spell_level,
  normalize_seed_spell_level,
  spell_row_key,
} from '../../packages/move/scripts/reseed_plan.mjs'

import { P, log } from './lib_gold.mjs'

const GOLD = path.dirname(fileURLToPath(import.meta.url))
const BASELINE_PATH = path.join(GOLD, 'mint_readback_baseline.json')
const SPELLS_DIR = path.join(P.REPO, 'seed', 'mainnet', 'spells')
const SEED_MANIFEST_PATH = path.join(P.BUILD, 'scripts', 'out', 'seed_manifest.json')
const REPORT_JSON = path.join(P.OUT, 'mint_readback_report.json')
const REPORT_MD = path.join(P.OUT, 'mint_readback_report.md')

const K_ALTER_RESIST = 11
const EL_NONE = 255
// The flat spell_effect::Effect envelope (foundation/sources/spell_effect.move). reseed_plan's normalizers
// project both the seed row and the chain object into exactly these eleven fields, so a diff is field-honest.
const EFFECT_FIELDS = [
  'kind',
  'element',
  'value',
  'area_shape',
  'area_size',
  'target_filter',
  'chance',
  'turns',
  'stat',
  'flags',
  'phase',
]

const read_json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

export function load_seed_spells(dir = SPELLS_DIR) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => read_json(path.join(dir, f)))
}

// One effect list (a level's base `effects` or `crit_effects`) → its per-field transform-drift rows plus the
// minted elementless-resist rows. Both sides arrive pre-normalized by reseed_plan, so a field diff is honest.
function diff_effect_list({ id, level, list, authored, minted }) {
  const drift = []
  const elementless = []
  if (authored.length !== minted.length)
    drift.push({ id, level, list, pos: -1, field: 'effect_count', authored: authored.length, minted: minted.length })
  const shared = Math.min(authored.length, minted.length)
  for (let pos = 0; pos < shared; pos += 1)
    for (const field of EFFECT_FIELDS)
      if (String(authored[pos][field]) !== String(minted[pos][field]))
        drift.push({ id, level, list, pos, field, authored: authored[pos][field], minted: minted[pos][field] })
  minted.forEach((effect, pos) => {
    if (Number(effect.kind) === K_ALTER_RESIST && Number(effect.element) === EL_NONE)
      elementless.push({ id, level, list, pos })
  })
  return { drift, elementless }
}

// A minted SpellTemplate must be structurally addressable (identity + exactly 6 levels) before its effects diff.
function spell_blocker(row, chain) {
  const identity_ok =
    String(chain.class) === String(row.classType) &&
    Number(chain.unlock_level) === Number(row.unlock) &&
    String(chain.name) === String(row.id)
  if (!identity_ok)
    return `${row.id}: chain identity {${chain.class},${chain.unlock_level},${chain.name}} != seed {${row.classType},${row.unlock},${row.id}}`
  if (
    !Array.isArray(row.levels) ||
    row.levels.length !== 6 ||
    !Array.isArray(chain.levels) ||
    chain.levels.length !== 6
  )
    return `${row.id}: expected 6 seed + 6 chain levels (seed ${row.levels?.length}, chain ${chain.levels?.length})`
  return null
}

// All six levels, base + crit lists, of one spell → its drift + elementless rows.
function diff_spell(row, chain) {
  const drift = []
  const elementless = []
  for (let level_index = 0; level_index < 6; level_index += 1) {
    const seed_level = normalize_seed_spell_level(row.levels[level_index])
    const chain_level = normalize_chain_spell_level(chain.levels[level_index])
    for (const list of ['effects', 'crit_effects']) {
      const part = diff_effect_list({
        id: row.id,
        level: level_index + 1,
        list,
        authored: seed_level[list],
        minted: chain_level[list],
      })
      drift.push(...part.drift)
      elementless.push(...part.elementless)
    }
  }
  return { drift, elementless }
}

// ── the pure readback: authored seed corpus + minted chain objects → the drift verdict (rig-free, unit-tested) ──
export function diff_corpus({ seed_spells, seed_manifest, chain_by_id, baseline }) {
  const blockers = []
  const transform_drift = []
  const elementless = []
  const elementless_by_id = {}
  const seen = new Set()
  let spells_read = 0

  for (const row of seed_spells) {
    const key = spell_row_key(row)
    if (seen.has(key)) continue // corpus dedup (mirrors seed_spells_phase's spellRows filter)
    seen.add(key)
    const object_id = seed_manifest?.spells?.[key]?.id
    if (!object_id) {
      blockers.push(`${row.id}: no object id in seed_manifest.spells[${key}]`)
      continue
    }
    const chain = chain_by_id[object_id]
    if (!chain) {
      blockers.push(`${row.id}: object ${object_id} unreadable on-chain`)
      continue
    }
    spells_read += 1
    const blocker = spell_blocker(row, chain)
    if (blocker) {
      blockers.push(blocker)
      continue
    }
    const spell = diff_spell(row, chain)
    transform_drift.push(...spell.drift)
    for (const found of spell.elementless) {
      elementless.push(found)
      elementless_by_id[found.id] = (elementless_by_id[found.id] ?? 0) + 1
    }
  }

  // SHRINK-ONLY ratchet of the elementless findings against the named baseline
  const allowed = baseline?.elementless_resist ?? {}
  const novel = []
  const exceeded = []
  const improved = []
  const matched = []
  for (const id of new Set([...Object.keys(elementless_by_id), ...Object.keys(allowed)])) {
    const found = elementless_by_id[id] ?? 0
    const budget = allowed[id] ?? 0
    if (found > budget) (budget === 0 ? novel : exceeded).push({ id, found, budget })
    else if (found < budget) improved.push({ id, found, budget })
    else if (found > 0) matched.push({ id, found })
  }

  const red_reasons = []
  if (blockers.length) red_reasons.push(`${blockers.length} blocker(s) — unreadable/identity/level-count`)
  if (transform_drift.length)
    red_reasons.push(
      `${transform_drift.length} TRANSFORM-DRIFT row(s) — minted effect != authored seed transform (never baselined)`
    )
  if (novel.length)
    red_reasons.push(
      `${novel.length} NOVEL elementless-resist spell(s) outside baseline: ${novel.map((n) => `${n.id}(${n.found})`).join(', ')}`
    )
  if (exceeded.length)
    red_reasons.push(
      `${exceeded.length} elementless-resist count(s) EXCEED baseline: ${exceeded.map((e) => `${e.id} ${e.found}>${e.budget}`).join(', ')}`
    )

  return {
    verdict: red_reasons.length ? 'RED' : 'PASS',
    red_reasons,
    counts: {
      seed_spells: seen.size,
      spells_read,
      transform_drift: transform_drift.length,
      elementless_total: elementless.length,
      blockers: blockers.length,
    },
    blockers,
    transform_drift,
    elementless_by_id,
    ratchet: { novel, exceeded, improved, matched },
    elementless,
  }
}

export function render_markdown(result) {
  const { counts, ratchet } = result
  const lines = []
  lines.push('# Mint-Fidelity Readback — drift table')
  lines.push('')
  lines.push(`**Verdict: ${result.verdict}** · ${new Date().toISOString()}`)
  if (result.red_reasons.length) for (const r of result.red_reasons) lines.push(`- RED: ${r}`)
  lines.push('')
  lines.push('| metric | count |')
  lines.push('| --- | ---: |')
  lines.push(`| spells in corpus | ${counts.seed_spells} |`)
  lines.push(`| spells read back on-chain | ${counts.spells_read} |`)
  lines.push(`| transform-drift rows (value/kind/turns/…) | ${counts.transform_drift} |`)
  lines.push(`| elementless-resist rows (kind 11 · el_none) | ${counts.elementless_total} |`)
  lines.push(`| blockers | ${counts.blockers} |`)
  lines.push('')
  lines.push('## Transform-drift (the prize — always RED, never baselined)')
  if (!result.transform_drift.length) lines.push('_none — every minted effect matches the authored seed transform._')
  else {
    lines.push('| spell | level | list | pos | field | authored | minted |')
    lines.push('| --- | ---: | --- | ---: | --- | --- | --- |')
    for (const d of result.transform_drift.slice(0, 200))
      lines.push(`| ${d.id} | ${d.level} | ${d.list} | ${d.pos} | ${d.field} | ${d.authored} | ${d.minted} |`)
  }
  lines.push('')
  lines.push('## Elementless-resist ratchet (kind 11 minted with el_none)')
  lines.push('| spell id | found | baseline | status |')
  lines.push('| --- | ---: | ---: | --- |')
  for (const m of ratchet.matched) lines.push(`| ${m.id} | ${m.found} | ${m.found} | baselined |`)
  for (const i of ratchet.improved) lines.push(`| ${i.id} | ${i.found} | ${i.budget} | IMPROVED — tighten baseline |`)
  for (const e of ratchet.exceeded) lines.push(`| ${e.id} | ${e.found} | ${e.budget} | RED — exceeds baseline |`)
  for (const n of ratchet.novel) lines.push(`| ${n.id} | ${n.found} | 0 | RED — novel, outside baseline |`)
  if (result.blockers.length) {
    lines.push('')
    lines.push('## Blockers')
    for (const b of result.blockers) lines.push(`- ${b}`)
  }
  lines.push('')
  return lines.join('\n')
}

// ── rig lifecycle: reuse a live gold rig, else boot up_gold FOREGROUND (SKIP ≠ PASS on boot failure) ──
async function rig_answers(rpc) {
  try {
    const r = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sui_getChainIdentifier', params: [] }),
    })
    return !!(await r.json())?.result
  } catch {
    return false
  }
}

async function ensure_rig() {
  if (fs.existsSync(P.DEPLOY)) {
    const manifest = read_json(P.DEPLOY)
    if (await rig_answers(manifest.rpc)) {
      log(`reusing live gold rig · rpc=${manifest.rpc}`)
      return manifest
    }
    log(`stale ${P.DEPLOY} (rig ${manifest.rpc} unreachable) — rebooting the gold rig FOREGROUND`)
  } else {
    log(`no ${P.DEPLOY} — booting the gold rig FOREGROUND (full corpus mint; ~5–10 min)`)
  }
  // FOREGROUND, generous budget. A non-zero up_gold exit throws here → the row FAILS loud, never skips green.
  execSync(`node ${path.join(GOLD, 'up_gold.mjs')}`, { cwd: P.REPO, stdio: 'inherit', timeout: 20 * 60_000 })
  if (!fs.existsSync(P.DEPLOY)) throw new Error(`gold boot finished but ${P.DEPLOY} is absent — cannot read back`)
  const manifest = read_json(P.DEPLOY)
  if (!(await rig_answers(manifest.rpc)))
    throw new Error(`gold boot finished but rig ${manifest.rpc} does not answer — refusing to skip green`)
  return manifest
}

async function make_grpc_client(base_url) {
  const require_from_sdk = createRequire(fileURLToPath(new URL('../../packages/sdk/package.json', import.meta.url)))
  const { SuiGrpcClient } = await import(require_from_sdk.resolve('@mysten/sui/grpc'))
  return new SuiGrpcClient({ network: 'localnet', baseUrl: base_url })
}

async function read_chain_objects(client, ids) {
  const by_id = {}
  const page = 50
  for (let i = 0; i < ids.length; i += page) {
    const { objects } = await client.getObjects({ objectIds: ids.slice(i, i + page), include: { json: true } })
    objects.forEach((object, index) => {
      by_id[ids[i + index]] = object instanceof Error ? null : (object?.json ?? null)
    })
  }
  return by_id
}

async function main() {
  const baseline = read_json(BASELINE_PATH)
  const seed_spells = load_seed_spells()
  const manifest = await ensure_rig()
  if (!fs.existsSync(SEED_MANIFEST_PATH))
    throw new Error(
      `no seed_manifest at ${SEED_MANIFEST_PATH} — the gold rig writes it during seed; cannot map spell ids`
    )
  const seed_manifest = read_json(SEED_MANIFEST_PATH)
  const ids = [...new Set(seed_spells.map((row) => seed_manifest.spells?.[spell_row_key(row)]?.id).filter(Boolean))]
  log(`reading ${ids.length} minted spell templates back from ${manifest.rpc}`)
  const client = await make_grpc_client(manifest.rpc)
  const chain_by_id = await read_chain_objects(client, ids)
  const result = diff_corpus({ seed_spells, seed_manifest, chain_by_id, baseline })

  fs.mkdirSync(P.OUT, { recursive: true })
  fs.writeFileSync(REPORT_JSON, `${JSON.stringify(result, null, 2)}\n`)
  fs.writeFileSync(REPORT_MD, render_markdown(result))

  log('── MINT-FIDELITY READBACK ──')
  log(
    `corpus=${result.counts.seed_spells} · read=${result.counts.spells_read} · transform-drift=${result.counts.transform_drift} · elementless-resist=${result.counts.elementless_total} · blockers=${result.counts.blockers}`
  )
  for (const m of result.ratchet.matched) log(`  baselined elementless-resist: ${m.id} ×${m.found}`)
  for (const i of result.ratchet.improved) log(`  IMPROVED (tighten baseline): ${i.id} ${i.budget}→${i.found}`)
  for (const d of result.transform_drift.slice(0, 40))
    log(`  DRIFT ${d.id} L${d.level} ${d.list}[${d.pos}] ${d.field}: authored=${d.authored} minted=${d.minted}`)
  for (const b of result.blockers.slice(0, 40)) log(`  BLOCKER ${b}`)
  log(`report → ${REPORT_JSON} · ${REPORT_MD}`)
  if (result.verdict === 'RED') {
    log(`MINT READBACK RED: ${result.red_reasons.join(' · ')}`)
    return 1
  }
  log('MINT READBACK PASS — every minted effect matches its authored seed; elementless-resist within baseline')
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`[gold] mint readback FAILED: ${error?.stack ?? error}`)
      process.exit(1)
    })
}
