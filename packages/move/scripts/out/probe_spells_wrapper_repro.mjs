// DISPOSABLE PROBE #2 — the single-row dryRun (probe_spells_raw_dryrun.mjs) came back CLEAN (success:true) for
// the densest row (ikari_bloodletting), which contradicts probeBatchSize's reported "even a single row fails to
// clear simulate". This probe calls the REAL, UNMODIFIED probeBatchSize from ceremony_lib.mjs (not a
// hand-rolled reproduction) with PROBE_DEBUG=1 so its own internal per-n failure reason prints — settles
// whether this is a data/Move problem or something else (rate limiting, ceiling, wrapper logic).
//
// RESULT: does NOT reproduce. Against the live ceremony #3 spells package, the real prober clears cleanly —
// n=6/5/4/3 reject at BUILD time (`programmable transaction has too many inputs: 4821/3862/3191/2520, limit
// 2048` — the documented, expected PTB-input ceiling for this corpus's dense spell rows, not a bug), the
// down-search lands on n=2 (matching the code comment's own "n=2 is the actual safe ceiling for THIS corpus"),
// and `node packages/move/scripts/seed_spells_phase.mjs` (SEED_CONFIRM_REMOTE=testnet NETWORK=testnet DRY=1),
// run verbatim end-to-end with zero modifications, completes cleanly with the same size=2. Whatever produced
// the originally reported wrapper failure is not present in the current on-disk code + corpus + ceremony #3
// manifest — no fix applied (there is nothing here to fix without inventing a regression).
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Transaction } from '@mysten/sui/transactions'
import { SuiGrpcClient } from '@mysten/sui/grpc'

import { probeBatchSize, netGas } from '../ceremony_lib.mjs'

process.env.PROBE_DEBUG = '1'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS = path.resolve(__dir, '..')
const REPO = path.resolve(SCRIPTS, '..', '..', '..')
const SPELLS_DIR = path.join(REPO, 'seed', 'mainnet', 'spells')
const SCRIPT_PATH = path.join(SCRIPTS, 'seed_spells_phase.mjs')
const MANIFEST = JSON.parse(readFileSync(path.join(SCRIPTS, 'out', 'ceremony_manifest.json'), 'utf8'))

const FND = MANIFEST.foundation.pkg
const SPELLS = MANIFEST.spells.pkg
const CAP = MANIFEST.spells.admin
const VER = MANIFEST.spells.version
const REG = MANIFEST.spells.shared.SpellRegistry
const SENDER = MANIFEST._signer
const SPELL_B = 10
const SPELL_P = 9

function extractBuilder(source) {
  const start = source.indexOf('const T_EFFECT = ')
  const end = source.indexOf('\nconst spellRowKey = (sp) =>')
  if (start === -1 || end === -1) throw new Error('probe: anchor markers not found')
  return source.slice(start, end)
}
const buildSpellsInto = (() => {
  const body = `'use strict'\n${extractBuilder(readFileSync(SCRIPT_PATH, 'utf8'))}\nreturn buildSpellsInto`
  // eslint-disable-next-line no-new-func -- disposable local probe, evaluates trusted in-repo source only
  return new Function('FND', 'SPELLS', 'CAP', 'REG', 'VER', 'SPELL_B', 'SPELL_P', body)(
    FND, SPELLS, CAP, REG, VER, SPELL_B, SPELL_P
  )
})()

const spellRowKey = (sp) => `${sp.classType}:${sp.unlock}:${sp.id}`
const allSpells = []
for (const f of readdirSync(SPELLS_DIR).filter((x) => x.endsWith('.json')).sort())
  for (const sp of JSON.parse(readFileSync(path.join(SPELLS_DIR, f), 'utf8'))) allSpells.push(sp)
const seen = new Set()
const spellRows = allSpells.filter((sp) => !seen.has(spellRowKey(sp)) && seen.add(spellRowKey(sp)))
console.log(`corpus: ${spellRows.length} spells`)

const BATCH_PROBE = { start: 6, cap: 40, step: 1, ceilingSuiPerItem: 0.05 }
const richest = [...spellRows]
  .sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)
  .slice(0, BATCH_PROBE.cap)
console.log(`richest[0] = ${spellRowKey(richest[0])}, richest[39] = ${spellRowKey(richest[richest.length - 1])}`)

const client = new SuiGrpcClient({ network: 'testnet', baseUrl: 'https://fullnode.testnet.sui.io:443' })

try {
  const { size, gasNet } = await probeBatchSize(
    client,
    SENDER,
    richest,
    (rows) => {
      const tx = new Transaction()
      buildSpellsInto(tx, rows)
      return tx
    },
    BATCH_PROBE
  )
  console.log(`\nWRAPPER RESULT: size=${size} gasNet=${gasNet} (${gasNet / 1e9} SUI)`)
} catch (e) {
  console.error(`\nWRAPPER THREW: ${e.message}`)
}
