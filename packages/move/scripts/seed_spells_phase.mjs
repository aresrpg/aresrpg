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
import { encode_effect_value } from './spell_wire.mjs'

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
const BATCH_PROBE = { start: 30, cap: 40, step: 5, ceilingSuiPerItem: 0.03 }

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
const KIND_PHASE = { 20: 1, 21: 1 }
// value/flags ride spell_wire.mjs's encode_effect_value (#1250 — CENTERED for alter_stat/alter_resist,
// magnitude passthrough otherwise) — the ONE home every new_effect PTB encoder shares.
const effectFx = (tx, e) => {
  const { value, flags } = encode_effect_value(e.kind, e.value ?? 0, e.flags ?? 0)
  return tx.moveCall({
    target: `${FND}::spell_effect::new_effect`,
    arguments: [
      tx.pure.u8(e.kind),
      tx.pure.u8(e.element ?? 255),
      tx.pure.u64(value),
      tx.pure.u8(e.area_shape ?? 0),
      tx.pure.u64(e.area_size ?? 0),
      tx.pure.u8(e.target_filter ?? 0),
      tx.pure.u8(e.chance ?? 100),
      tx.pure.u8(e.turns ?? 0),
      tx.pure.u8(e.stat ?? 0),
      tx.pure.u8(flags),
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
