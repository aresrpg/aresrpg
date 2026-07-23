// DISPOSABLE PROBE #3 — proves the CORPUS DRIVER'S OWN call path (seed_full_corpus.mjs's local buildSpellsInto
// + its :1421 probe opts), not the standalone seed_spells_phase.mjs. probe_spells_wrapper_repro.mjs already
// proved the PHASE's own BATCH_PROBE (ceilingSuiPerItem:0.05) clears — and that's exactly why the driver's
// stale ceilingSuiPerItem:0.03 (inherited via `{ ...BATCH_PROBE, start:6, step:1 }`, BATCH_PROBE being
// seed_full_corpus.mjs's items/mobs-shaped module default) stayed invisible: nobody had run the DRIVER's own
// spells leg through probeBatchSize before. Every symbol below is copied VERBATIM from seed_full_corpus.mjs
// (line numbers cited per block, as read 2026-07-24) — no hand-reimplementation, and no `import` of that
// module (importing it runs its own top-level manifest-resume/archive side effect on disk — it RENAMES
// out/seed_manifest.json if the lineage stamp mismatches — unsafe for a disposable probe). Everything here is
// simulateTransaction only (via ceremony_lib's real probeBatchSize); nothing signs or executes.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Transaction } from '@mysten/sui/transactions'
import { SuiGrpcClient } from '@mysten/sui/grpc'

import { probeBatchSize } from '../ceremony_lib.mjs'

process.env.PROBE_DEBUG = '1'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS = path.resolve(__dir, '..')
const REPO = path.resolve(SCRIPTS, '..', '..', '..')
const SPELLS_DIR = path.join(REPO, 'seed', 'mainnet', 'spells')
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(SCRIPTS, 'out', 'ceremony_manifest.json'), 'utf8')
)

// ── seed_full_corpus.mjs lines 73-122 (SHIFT..T), pruned to the fields buildSpellsInto's chain reads ──
const SHIFT = 32768
const FND = MANIFEST.foundation.pkg
const SPELLS = MANIFEST.spells.pkg // unused directly but kept for fidelity with the source block
const CALL = (e) => e.latest ?? e.pkg
const CFND = CALL(MANIFEST.foundation)
const CSPELLS = CALL(MANIFEST.spells)
const CAP = { spells: MANIFEST.spells.admin }
const VER = { spells: MANIFEST.spells.version }
const SH = { spellReg: MANIFEST.spells.shared.SpellRegistry }
const T = {
  effect: `${FND}::spell_effect::Effect`,
  level: `${FND}::spell_effect::SpellLevel`,
}

// ── seed_full_corpus.mjs lines 357-463 (fxVec..levelVec), byte-identical ──
const fxVec = (tx, effects) =>
  tx.makeMoveVec({ type: T.effect, elements: effects })
const KIND_PHASE = { 20: 1, 21: 1 } // K_PLACE_GLYPH / K_APPLY_DOT → PHASE_START; all else PHASE_ON_ENTER
const SIGNED_EFFECT_KINDS = new Set([9, 11]) // K_ALTER_STAT / K_ALTER_RESIST — value/value_max centered at SHIFT
const FLAG_NEGATIVE = 8 // spell_effect FLAG_NEGATIVE bit — the DECLARED sign band/filter/dispel read
const encodeEffectValue = (kind, raw) => {
  const n = Number(raw ?? 0)
  if (SIGNED_EFFECT_KINDS.has(kind)) return SHIFT + n // centered: n may be negative
  if (n < 0)
    throw new Error(
      `effect kind ${kind}: negative value ${n} — only alter_stat/alter_resist (9/11) author signed deltas (R3)`
    )
  return n
}
const effectRange = (e) => {
  if (e.value_max != null) return [Number(e.value ?? 0), Number(e.value_max)]
  if (e.baseMax != null) return [Number(e.base ?? 0), Number(e.baseMax)]
  if (e.damageMax != null) return [Number(e.damageMin ?? 0), Number(e.damageMax)]
  const fixed = Number(e.value ?? e.base ?? e.damageMin ?? 0) // no range family ⇒ FIXED (max == min)
  return [fixed, fixed]
}
const effectFlags = (kind, rawMin, rawMax, authored = 0) => {
  if (!SIGNED_EFFECT_KINDS.has(kind)) return authored
  let flags = authored & ~FLAG_NEGATIVE
  if (Math.min(rawMin, rawMax) < 0) flags |= FLAG_NEGATIVE
  return flags
}
const effectFx = (tx, e) => {
  const [rawMin, rawMax] = effectRange(e)
  const a = encodeEffectValue(e.kind, rawMin)
  const b = encodeEffectValue(e.kind, rawMax)
  return tx.moveCall({
    target: `${CFND}::spell_effect::new_effect_ranged`,
    arguments: [
      tx.pure.u8(e.kind),
      tx.pure.u8(e.element ?? 255),
      tx.pure.u64(Math.min(a, b)),
      tx.pure.u64(Math.max(a, b)),
      tx.pure.u8(e.area_shape ?? 0),
      tx.pure.u64(e.area_size ?? 0),
      tx.pure.u8(e.target_filter ?? 0),
      tx.pure.u8(e.chance ?? 100),
      tx.pure.u8(e.turns ?? 0),
      tx.pure.u8(e.stat ?? 0),
      tx.pure.u8(effectFlags(e.kind, rawMin, rawMax, e.flags ?? 0)),
      tx.pure.u8(KIND_PHASE[e.kind] ?? 0),
    ],
  })
}
const spellLevel = (tx, o, fx, crit) =>
  tx.moveCall({
    target: `${CFND}::spell_effect::new_spell_level`,
    arguments: [
      tx.pure.u16(o.min_cl),
      tx.pure.u64(o.ap),
      tx.pure.u64(o.rmin),
      tx.pure.u64(o.rmax),
      tx.pure.bool(!!o.mod),
      tx.pure.bool(!!o.line),
      tx.pure.bool(o.los !== false),
      tx.pure.bool(!!o.free),
      tx.pure.u8(o.cpt ?? 255),
      tx.pure.u8(o.cpta ?? 255),
      tx.pure.u8(o.cd ?? 0),
      tx.pure.u64(o.crit ?? 0),
      tx.pure.bool(false),
      tx.pure.vector('u16', []),
      tx.pure.vector('u16', []),
      fxVec(tx, fx),
      fxVec(tx, crit),
    ],
  })
const levelVec = (tx, levels) =>
  tx.makeMoveVec({ type: T.level, elements: levels })

// ── seed_full_corpus.mjs lines 1318-1368 (PHASE 8 locals: SPELL_B/P, spellsDir/Files, buildSpellsInto, spellRowKey) ──
const SPELL_B = 30,
  SPELL_P = 9
const spellsDir = SPELLS_DIR
const spellFiles = fs.existsSync(spellsDir)
  ? fs.readdirSync(spellsDir).filter((f) => f.endsWith('.json')).sort()
  : []
const buildSpellsInto = (tx, rows) => {
  for (const sp of rows) {
    const levels = sp.levels.map((lvl) =>
      spellLevel(
        tx,
        {
          min_cl: lvl.min_char_level,
          ap: lvl.ap_cost,
          rmin: lvl.range_min,
          rmax: lvl.range_max,
          mod: lvl.modifiable_range,
          line: lvl.line_launch,
          los: lvl.line_of_sight,
          free: lvl.free_cell,
          cpt: lvl.casts_per_turn,
          cpta: lvl.casts_per_target,
          cd: lvl.cooldown_turns,
          crit: lvl.crit_rate,
        },
        (lvl.effects ?? []).map((e) => effectFx(tx, e)),
        (lvl.crit_effects ?? []).map((e) => effectFx(tx, e))
      )
    )
    tx.moveCall({
      target: `${CSPELLS}::spell_template::mint_spell`,
      arguments: [
        tx.object(CAP.spells),
        tx.object(SH.spellReg),
        tx.pure.string(sp.classType),
        tx.pure.u16(sp.unlock),
        tx.pure.string(sp.id),
        levelVec(tx, levels),
        tx.pure.u64(SPELL_B),
        tx.pure.u64(SPELL_P),
        tx.object(VER.spells),
      ],
    })
  }
}
const spellRowKey = (sp) => `${sp.classType}:${sp.unlock}:${sp.id}`

// ── seed_full_corpus.mjs lines 1389-1399 (corpus load + dedupe) ──
const allSpells = []
for (const file of spellFiles)
  for (const sp of JSON.parse(
    fs.readFileSync(path.join(spellsDir, file), 'utf8')
  ))
    allSpells.push(sp)
const seenSpellKeys = new Set()
const spellRows = allSpells.filter(
  (sp) =>
    !seenSpellKeys.has(spellRowKey(sp)) && seenSpellKeys.add(spellRowKey(sp))
)

// ── pendingSpells — same diff seed_full_corpus.mjs:1407 does, read-only against the ON-DISK manifest ──
const OUT_SPELLS =
  JSON.parse(
    fs.readFileSync(path.join(SCRIPTS, 'out', 'seed_manifest.json'), 'utf8')
  ).spells || {}
const pendingSpells = spellRows.filter((sp) => !OUT_SPELLS[spellRowKey(sp)])
console.log(
  `corpus: ${spellRows.length} spells · already landed: ${spellRows.length - pendingSpells.length} · pending: ${pendingSpells.length}`
)

// ── seed_full_corpus.mjs lines 213-217 (BATCH_PROBE.cap, richest) ──
const BATCH_PROBE_CAP = 100
const richest = (rows, n) =>
  [...rows]
    .sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)
    .slice(0, Math.min(n, rows.length))

const SENDER = MANIFEST._signer
const client = new SuiGrpcClient({
  network: 'testnet',
  baseUrl: 'https://fullnode.testnet.sui.io:443',
})

if (!pendingSpells.length) {
  console.log('nothing pending — cannot exercise the probe (corpus fully landed)')
  process.exit(1)
}

const candidates = richest(pendingSpells, BATCH_PROBE_CAP)
const buildBatch = (rows) => {
  const tx = new Transaction()
  buildSpellsInto(tx, rows)
  return tx
}

console.log('\n--- BEFORE (driver bug): { ...BATCH_PROBE, start:6, step:1 } == { start:6, step:1, cap:100, ceilingSuiPerItem:0.03 } ---')
try {
  const r = await probeBatchSize(client, SENDER, candidates, buildBatch, {
    start: 6,
    step: 1,
    cap: 100,
    ceilingSuiPerItem: 0.03,
  })
  console.log(`UNEXPECTED PASS: size=${r.size} gasNet=${r.gasNet}`)
} catch (e) {
  console.log(`EXPECTED THROW: ${e.message}`)
}

console.log('\n--- AFTER (seed_full_corpus.mjs:1421 post-fix): { start:6, step:1, ceilingSuiPerItem:0.06 } ---')
try {
  const { size, gasNet } = await probeBatchSize(client, SENDER, candidates, buildBatch, {
    start: 6,
    step: 1,
    ceilingSuiPerItem: 0.06,
  })
  console.log(
    `\nDRIVER-PATH PROBE RESULT: size=${size} gasNet=${gasNet} (${(gasNet / 1e9).toFixed(4)} SUI)`
  )
} catch (e) {
  console.log(`\nDRIVER-PATH PROBE THREW: ${e.message}`)
  process.exit(1)
}
