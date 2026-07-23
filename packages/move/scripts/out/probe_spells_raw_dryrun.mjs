// DISPOSABLE PROBE — was written to surface the RAW dryRun failure behind ceremony_lib's probeBatchSize wrapper
// message ("probeBatchSize: even a single row fails to clear simulate — refusing to guess a size"), reported
// against the LIVE ceremony #3 spells package. RESULT: it does NOT reproduce — this exact single-row build
// dryRuns CLEAN (status.success:true) against the live ceremony #3 ids. See probe_spells_wrapper_repro.mjs for
// the full-corpus companion proof (the real, unmodified probeBatchSize also clears with zero unexpected throws).
//
// Extracts the LIVE `buildSpellsInto` PTB builder (+ its serializer helpers) as SOURCE TEXT from the on-disk
// seed_spells_phase.mjs (byte-faithful — this is the exact code that ships, not a hand-copy), builds ONE row's
// tx against the REAL ceremony #3 ids in out/ceremony_manifest.json, and dryRuns it directly against
// https://fullnode.testnet.sui.io:443 via gRPC Core `simulateTransaction`. Prints the COMPLETE result — a
// concise summary on success, the FULL raw JSON (no truncation) on any failure. No signing, no execute
// (MONEY LAW: simulate only).
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Transaction } from '@mysten/sui/transactions'
import { SuiGrpcClient } from '@mysten/sui/grpc'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS = path.resolve(__dir, '..') // packages/move/scripts
const REPO = path.resolve(SCRIPTS, '..', '..', '..')
const SPELLS_DIR = path.join(REPO, 'seed', 'mainnet', 'spells')
const SCRIPT_PATH = path.join(SCRIPTS, 'seed_spells_phase.mjs')

const MANIFEST = JSON.parse(
  readFileSync(path.join(SCRIPTS, 'out', 'ceremony_manifest.json'), 'utf8')
)

// ── confirm this IS ceremony #3 against aresrpg testnet before spending a single RPC call ──────────────────
if (MANIFEST._network !== 'testnet')
  throw new Error(`expected _network=testnet, got ${MANIFEST._network}`)
if (!MANIFEST.aresrpg.pkg.startsWith('0x045fdf6f'))
  throw new Error(`expected aresrpg pkg 0x045fdf6f… , got ${MANIFEST.aresrpg.pkg}`)
if (MANIFEST.spells.pkg !== '0xe0d15583bb2ef612a3b1ad73df6da0c8a82ed042053e6bc572c5ec875b6a1937')
  throw new Error(`expected ceremony #3 spells pkg, got ${MANIFEST.spells.pkg}`)
console.log(
  `manifest OK — network=${MANIFEST._network} aresrpg=${MANIFEST.aresrpg.pkg} spells=${MANIFEST.spells.pkg}`
)

const FND = MANIFEST.foundation.pkg
const SPELLS = MANIFEST.spells.pkg
const CAP = MANIFEST.spells.admin
const VER = MANIFEST.spells.version
const REG = MANIFEST.spells.shared.SpellRegistry
const SENDER = MANIFEST._signer
// (B,P) legacy ABI params — verbatim from seed_spells_phase.mjs (SPELL_B/SPELL_P); mint_spell keeps them for
// upgrade compat but validate_levels ignores them (see spell_template.move).
const SPELL_B = 10
const SPELL_P = 9
console.log(`FND=${FND}\nSPELLS=${SPELLS}\nCAP=${CAP}\nVER=${VER}\nREG=${REG}\nSENDER=${SENDER}`)

// ── extract buildSpellsInto (+ its serializer helpers) VERBATIM from the shipped script ─────────────────────
function extractBuilder(source) {
  const start = source.indexOf('const T_EFFECT = ')
  const end = source.indexOf('\nconst spellRowKey = (sp) =>')
  if (start === -1 || end === -1)
    throw new Error('probe: anchor markers not found — file shape moved, update the probe')
  return source.slice(start, end)
}
function buildBuilderFn(source) {
  const body = `'use strict'\n${extractBuilder(source)}\nreturn buildSpellsInto`
  // eslint-disable-next-line no-new-func -- disposable local probe, evaluates trusted in-repo source only
  return new Function(
    'FND',
    'SPELLS',
    'CAP',
    'REG',
    'VER',
    'SPELL_B',
    'SPELL_P',
    body
  )(FND, SPELLS, CAP, REG, VER, SPELL_B, SPELL_P)
}
const buildSpellsInto = buildBuilderFn(readFileSync(SCRIPT_PATH, 'utf8'))

// ── load the real corpus, same dedupe as main(), pick the SAME single row probeBatchSize's floor test hits
//    (richest-first, top BATCH_PROBE.cap=40, floor = the single densest row) ──────────────────────────────
const spellRowKey = (sp) => `${sp.classType}:${sp.unlock}:${sp.id}`
const allSpells = []
for (const f of readdirSync(SPELLS_DIR).filter((x) => x.endsWith('.json')).sort())
  for (const sp of JSON.parse(readFileSync(path.join(SPELLS_DIR, f), 'utf8')))
    allSpells.push(sp)
const seen = new Set()
const spellRows = allSpells.filter(
  (sp) => !seen.has(spellRowKey(sp)) && seen.add(spellRowKey(sp))
)
const richest = [...spellRows].sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)
const [row] = richest
console.log(`\nprobing single row: ${spellRowKey(row)} (densest pending row, ${JSON.stringify(row).length} chars authored)`)

// ── build + dryRun ────────────────────────────────────────────────────────────────────────────────────────
const tx = new Transaction()
buildSpellsInto(tx, [row])
tx.setSenderIfNotSet(SENDER)

const client = new SuiGrpcClient({ network: 'testnet', baseUrl: 'https://fullnode.testnet.sui.io:443' })

console.log('\n--- simulateTransaction (RAW) ---')
try {
  const sim = await client.simulateTransaction({ transaction: tx, include: { effects: true } })
  const ok = sim.$kind === 'Transaction' && sim.Transaction.effects.status.success === true
  if (ok) {
    const eff = sim.Transaction.effects
    const g = eff.gasUsed
    const net = Number(g.computationCost) + Number(g.storageCost) - Number(g.storageRebate)
    console.log(
      `PASS — status.success=true digest=${eff.transactionDigest} gasNet=${net} MIST (${(net / 1e9).toFixed(4)} SUI) changedObjects=${eff.changedObjects.length}`
    )
  } else {
    console.error('FAIL — COMPLETE raw result follows:')
    console.error(JSON.stringify(sim, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2))
    process.exit(1)
  }
} catch (e) {
  console.error('\n--- simulateTransaction THREW (build-time / transport reject) ---')
  console.error('message:', e?.message ?? e)
  console.error('stack:', e?.stack)
  process.exit(1)
}
