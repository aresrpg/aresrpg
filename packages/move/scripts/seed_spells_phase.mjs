// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SEED_SPELLS_PHASE — the SPELLS-ONLY seeder (seed_full_corpus.mjs PHASE 8, extracted verbatim).
//
// WHY A DEDICATED RUNNER: the 2026-07-13 SPELL_KITS reseed mints ONLY the new 240-spell kit corpus
// against the LIVE lineage. Running seed_full_corpus would also mint any item/mob/world rows that
// drifted into seed/mainnet since the last full run — unauthorized scope + gas on a money path.
// This runner shares the SAME out/seed_manifest.json (stamp-guarded resume, pendingDigests
// crash-safety, per-row landing) so content projections keep their one join home.
//
// MONEY LAW (verbatim from the corpus seeder): budgets derive from dryRun ×1.5 (ceremony_lib.run);
// an EXECUTED failure (digest exists) is NEVER auto-retried — the pendingDigests backfill is the
// crash recovery; every batch dry-runs BEFORE signing (zero gas on a bad PTB).
//
// GAS (address-balance wallets): the gRPC Core tx resolver selects gas NATIVELY from the signer's consensus
// address-balance (no discrete Coin object needed) — the old raw `suix_getCoins` reservation-ref fallback is
// retired (it was a JSON-RPC-only workaround for that client's coin filter; testnet JSON-RPC is dead now).
//
// RUN (testnet, owner-blessed) — gRPC only; publicnode is FORBIDDEN and does not speak gRPC:
//   NETWORK=testnet SEED_CONFIRM_REMOTE=testnet PRIVATE_KEY=<VITE_DEV_KEY> \
//   node packages/move/scripts/seed_spells_phase.mjs   # SUI_GRPC_URL overrides the default fullnode gRPC

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Transaction } from '@mysten/sui/transactions'

import { keypair, sui_client } from './client.js'
import {
  run,
  netGas,
  probeBatchSize,
  resolveBatch,
  claimCreated,
  getReceipt,
} from './ceremony_lib.mjs'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dir, '..', '..', '..')
const SPELLS_DIR = path.join(REPO, 'seed', 'mainnet', 'spells')
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(__dir, 'out', 'ceremony_manifest.json'), 'utf8')
)
const OUT_PATH = path.join(__dir, 'out', 'seed_manifest.json')

const FND = MANIFEST.foundation.pkg
const SPELLS = MANIFEST.spells.pkg
const LINEAGE_STAMP = [
  FND,
  MANIFEST.items.pkg,
  SPELLS,
  MANIFEST.game.pkg,
  MANIFEST.fight.pkg,
].join(',')
const CAP = MANIFEST.spells.admin
const VER = MANIFEST.spells.version
const REG = MANIFEST.spells.shared.SpellRegistry
const ME = keypair.getPublicKey().toSuiAddress()

// (B,P) = the corpus DESIGN budget (spell_kits.mjs authors within it; mint_spell re-validates).
const SPELL_B = 10
const SPELL_P = 9
// Spell rows are the densest seed shape (the corpus's worst row, ikari_bloodletting, is 72 effects across 6
// levels ≈ 962 PTB inputs alone) — probeBatchSize's `richest` always tests the densest rows first, and this
// corpus's top-3 richest rows combined already exceed the 2048-input PTB cap (measured: n=1→962, n=2→1777,
// n=3→2520 inputs against LIVE testnet dryRun) — n=2 is the actual safe ceiling for THIS corpus. step:1 (not
// items/mobs' step:5) so the down-search never jumps PAST that n=2 window straight to the n=1 floor test;
// ceilingSuiPerItem measured against the worst single row (0.0394 SUI/item at n=1) — 0.05 keeps honest
// headroom over ground truth (money law: measure, don't guess).
const BATCH_PROBE = { start: 6, cap: 40, step: 1, ceilingSuiPerItem: 0.05 }

// ── manifest (SHARED with seed_full_corpus — same stamp guard, same shape) ─────────────────────
if (!fs.existsSync(OUT_PATH))
  throw new Error(
    `no ${OUT_PATH} — the spells phase extends an existing lineage manifest`
  )
const OUT = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'))
if (OUT._stamp !== LINEAGE_STAMP)
  throw new Error(
    `seed_manifest stamp ≠ current ceremony lineage — refusing (a dead-lineage resume mints against the wrong catalog)`
  )
OUT.spells = OUT.spells ?? {}
OUT.digests = OUT.digests ?? {}
OUT.pendingDigests = OUT.pendingDigests ?? {}
OUT.gas = OUT.gas ?? { totalMist: 0, totalSui: 0 }
const persist = () => fs.writeFileSync(OUT_PATH, JSON.stringify(OUT, null, 2))

// ── network guard (the gated remote-seed law, verbatim semantics) ────────────────────────
function guard_network() {
  const grpc = process.env.SUI_GRPC_URL || ''
  if (/(127\.0\.0\.1|localhost|0\.0\.0\.0|::1)/.test(grpc)) return
  const confirm = process.env.SEED_CONFIRM_REMOTE
  if (confirm && (process.env.NETWORK || 'testnet') === confirm) {
    console.warn(
      `⚠️  REMOTE spells seed authorized — SUI_GRPC_URL=${grpc || '(default fullnode)'} · SEED_CONFIRM_REMOTE=${confirm}`
    )
    return
  }
  throw new Error(
    `spells seed is LOCALNET/gate-only without SEED_CONFIRM_REMOTE=<network> matching NETWORK (got grpc=${grpc || 'default'})`
  )
}

// ── PHASE 8 builders (verbatim from seed_full_corpus.mjs, spells slice only) ───────────────────
const T_EFFECT = `${FND}::spell_effect::Effect`
const T_LEVEL = `${FND}::spell_effect::SpellLevel`
const KIND_PHASE = { 20: 1, 21: 1 } // K_PLACE_GLYPH / K_APPLY_DOT → PHASE_START; all else PHASE_ON_ENTER
// HARDENED SERIALIZER CONTRACT — transcribed from seed_full_corpus.mjs's module-level effectFx/encodeEffectValue/
// effectRange/effectFlags (that file does not export them; this is the ONE other call site, kept byte-faithful —
// seed_full_corpus.mjs stays the home for any future contract change, per the #577/R3/F1/F2 rulings there).
// #577 — every effect authors a RANGE [value, value_max] (a missing max ⇒ max = min, the degenerate FIXED case).
// R3 — alter_stat/alter_resist (kinds 9/11) author SIGNED deltas encoded CENTERED at SHIFT (a debuff's negative
// delta must NOT become Math.abs'd positive); every OTHER kind is a raw magnitude and a negative is a HARD ERROR.
const SHIFT = 32768 // item_stats + mob resistances + alter_stat/alter_resist center here (spell.move RES_SHIFT)
const SIGNED_EFFECT_KINDS = new Set([9, 11]) // K_ALTER_STAT / K_ALTER_RESIST — value/value_max centered at SHIFT
const FLAG_NEGATIVE = 8 // spell_effect FLAG_NEGATIVE bit — the DECLARED sign band/filter/dispel read
// Encode ONE authored effect scalar for `kind`: signed kinds center at SHIFT (delta may be negative); every other
// kind stays a raw magnitude and a negative aborts the seed (the R3 refuse-negative gate).
const encodeEffectValue = (kind, raw) => {
  const n = Number(raw ?? 0)
  if (SIGNED_EFFECT_KINDS.has(kind)) return SHIFT + n // centered: n may be negative
  if (n < 0)
    throw new Error(
      `effect kind ${kind}: negative value ${n} — only alter_stat/alter_resist (9/11) author signed deltas (R3)`
    )
  return n
}
// The authored [min, max] range of an effect (#577), selected by FAMILY (max-gated) — NEVER mixing a legacy
// midpoint `value` with a `damageMin/damageMax` range family: a row carrying BOTH is the damage-range family, not
// a hybrid. A missing max family ⇒ FIXED at the single authored value.
const effectRange = (e) => {
  if (e.value_max != null) return [Number(e.value ?? 0), Number(e.value_max)]
  if (e.baseMax != null) return [Number(e.base ?? 0), Number(e.baseMax)]
  if (e.damageMax != null) return [Number(e.damageMin ?? 0), Number(e.damageMax)]
  const fixed = Number(e.value ?? e.base ?? e.damageMin ?? 0) // no range family ⇒ FIXED (max == min)
  return [fixed, fixed]
}
// DERIVE the FLAG_NEGATIVE bit for a signed kind from the authored SIGN (never trust corpus flags for it — the
// corpus authors the sign in the delta, not a flag). A negative delta ⇒ bit 8 set; a positive delta clears it.
// Non-signed kinds keep their authored flags verbatim.
const effectFlags = (kind, rawMin, rawMax, authored = 0) => {
  if (!SIGNED_EFFECT_KINDS.has(kind)) return authored
  let flags = authored & ~FLAG_NEGATIVE // derive the sign bit, ignore any corpus-supplied FLAG_NEGATIVE
  if (Math.min(rawMin, rawMax) < 0) flags |= FLAG_NEGATIVE
  return flags
}
const effectFx = (tx, e) => {
  const [rawMin, rawMax] = effectRange(e)
  const a = encodeEffectValue(e.kind, rawMin)
  const b = encodeEffectValue(e.kind, rawMax)
  return tx.moveCall({
    target: `${FND}::spell_effect::new_effect_ranged`,
    arguments: [
      tx.pure.u8(e.kind),
      tx.pure.u8(e.element ?? 255),
      tx.pure.u64(Math.min(a, b)), // value = the LOW endpoint (well-formed range: value <= value_max)
      tx.pure.u64(Math.max(a, b)), // value_max = the HIGH endpoint
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
const fxVec = (tx, effects) =>
  tx.makeMoveVec({ type: T_EFFECT, elements: effects })
const spellLevel = (tx, o, fx, crit) =>
  tx.moveCall({
    target: `${FND}::spell_effect::new_spell_level`,
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
const buildSpellsInto = (tx, rows) => {
  for (const sp of rows) {
    // SPELL_KITS Law 5: the corpus authors the per-level targeting bits — threaded verbatim.
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
      target: `${SPELLS}::spell_template::mint_spell`,
      arguments: [
        tx.object(CAP),
        tx.object(REG),
        tx.pure.string(sp.classType),
        tx.pure.u16(sp.unlock),
        tx.pure.string(sp.id),
        tx.makeMoveVec({ type: T_LEVEL, elements: levels }),
        tx.pure.u64(SPELL_B),
        tx.pure.u64(SPELL_P),
        tx.object(VER),
      ],
    })
  }
}
const spellRowKey = (sp) => `${sp.classType}:${sp.unlock}:${sp.id}`
const spellCreatedOf = (r) =>
  (r.events || [])
    .filter((e) => (e.type || '').endsWith('::spell_template::SpellMinted'))
    .map((e) => {
      const j = e.parsedJson ?? e.json ?? e.contents
      return { id: j.spell, key: `${j.class}:${j.unlock_level}:${j.name}` }
    })
const landSpell = ({ row, id }) => {
  OUT.spells[spellRowKey(row)] = {
    id,
    name: row.name,
    class: row.classType,
    unlock: row.unlock,
    slot: row.slot ?? 0,
    role: row.role,
    element: row.element,
    description_key: row.description_key,
  }
}

async function main() {
  guard_network()
  console.log(
    `\n=== SEED SPELLS PHASE · network=${MANIFEST._network} · grpc=${process.env.SUI_GRPC_URL || '(default)'} · signer=${ME} ===`
  )
  if (OUT._signer && OUT._signer !== ME)
    throw new Error(
      `manifest signer ${OUT._signer} ≠ current signer ${ME} — refusing`
    )

  const { object: cap } = await sui_client.getObject({ objectId: CAP })
  if (cap?.owner?.AddressOwner !== ME)
    throw new Error(
      `PREFLIGHT: spells AdminCap ${CAP} not owned by signer (${JSON.stringify(cap?.owner)})`
    )
  console.log('preflight OK — spells AdminCap owned by signer')

  const allSpells = []
  for (const f of fs
    .readdirSync(SPELLS_DIR)
    .filter((x) => x.endsWith('.json'))
    .sort())
    for (const sp of JSON.parse(
      fs.readFileSync(path.join(SPELLS_DIR, f), 'utf8')
    ))
      allSpells.push(sp)
  const seen = new Set()
  const spellRows = allSpells.filter(
    (sp) => !seen.has(spellRowKey(sp)) && seen.add(spellRowKey(sp))
  )
  console.log(
    `corpus: ${spellRows.length} spells · already landed: ${spellRows.filter((sp) => OUT.spells[spellRowKey(sp)]).length}`
  )

  // BACKFILL: an executed-but-unresolved batch digest (crash between execute and land) — resolve, land, clear.
  for (const [label, digest] of Object.entries(OUT.pendingDigests)) {
    if (!label.startsWith('spells:')) continue
    console.log(
      `  [${label}] BACKFILL executed-but-unresolved digest ${digest.slice(0, 8)}…`
    )
    const txb = await getReceipt(sui_client, digest)
    claimCreated(
      spellRows.filter((sp) => !OUT.spells[spellRowKey(sp)]),
      spellRowKey,
      spellCreatedOf(txb)
    ).forEach(landSpell)
    delete OUT.pendingDigests[label]
    persist()
  }

  const pending = spellRows.filter((sp) => !OUT.spells[spellRowKey(sp)])
  if (!pending.length) {
    console.log('nothing to mint — every corpus spell already landed')
    return summary()
  }

  const richest = [...pending]
    .sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)
    .slice(0, BATCH_PROBE.cap)
  const { size, gasNet } = await probeBatchSize(
    sui_client,
    ME,
    richest,
    (rows) => {
      const tx = new Transaction()
      buildSpellsInto(tx, rows)
      return tx
    },
    BATCH_PROBE
  )
  console.log(
    `  spells: batch size ${size} (probe gasNET ${gasNet}) → ${Math.ceil(pending.length / size)} txs for ${pending.length} rows`
  )
  if (process.env.DRY === '1') {
    console.log('DRY=1 — probe-only run, nothing signed')
    return summary()
  }

  let gasMist = 0
  for (let i = 0; i < pending.length; i += size) {
    const batch = pending.slice(i, i + size)
    // Label = the batch's FIRST ROW key (content-stable): a resume's re-sliced batches never collide
    // with a previous run's labels (a pending-relative index did — false SKIP on the 07-13 resume).
    const label = `spells:kit:${spellRowKey(batch[0])}`
    if (OUT.digests[label]) {
      console.log(
        `  [${label}] SKIP (already: ${OUT.digests[label].slice(0, 8)}…)`
      )
      continue
    }
    const tx = new Transaction()
    buildSpellsInto(tx, batch)
    const r = await run(sui_client, keypair, label, tx, {
      ceilingSui: batch.length * BATCH_PROBE.ceilingSuiPerItem,
    })
    OUT.pendingDigests[label] = r.digest
    OUT.digests[label] = r.digest
    gasMist += netGas(r.effects.gasUsed)
    OUT.gas.totalMist += netGas(r.effects.gasUsed)
    OUT.gas.totalSui = OUT.gas.totalMist / 1e9
    persist()
    resolveBatch(batch, spellRowKey, spellCreatedOf(r)).forEach(landSpell)
    delete OUT.pendingDigests[label]
    persist()
  }
  console.log(
    `\nphase gas: ${(gasMist / 1e9).toFixed(4)} SUI (${gasMist} MIST)`
  )
  return summary()
}

function summary() {
  const kit = Object.entries(OUT.spells).filter(([, v]) => v.description_key)
  console.log(
    `=== SPELLS PHASE COMPLETE · manifest spells total: ${Object.keys(OUT.spells).length} · manifest → ${OUT_PATH} ===`
  )
  return kit.length
}

main().catch((e) => {
  persist()
  console.error(`\nSPELLS PHASE STOPPED: ${e.message}`)
  console.error(`partial manifest persisted → ${OUT_PATH}`)
  process.exit(1)
})
