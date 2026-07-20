// One-shot: align every world's on-chain speed_budget with the ENGINE's real movement ceiling.
// 2026-07-15 incident: the S-73 movement-feel pass raised engine RUN_SPEED to 10.5 m/s while worlds
// still carried DEFAULT_SPEED=550 (5.5 blocks/s, authored for a ~6.5 flat-line era) — every RUNNING
// player outpaced the §17.3 plausibility check, so every position-verified action aborted
// checkpoint::102 (engage/search/doors + the fight-commit cascade). Budget = engine max + terrain
// slack; the pet ×1.5 both-ends allowance rides ON TOP on-chain, so base only needs to cover unmounted.
//
//   NETWORK=testnet node apply_speed_budget.mjs            # dry-run
//   NETWORK=testnet LIVE=1 node apply_speed_budget.mjs     # execute (keystore signer)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Transaction } from '@mysten/sui/transactions'

import { keypair, sui_client } from './client.js'
import { deriveBudget, run } from './ceremony_lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(HERE, 'out/ceremony_manifest.json'), 'utf8')
)
const SEED = JSON.parse(
  fs.readFileSync(path.join(HERE, 'out/seed_manifest.json'), 'utf8')
)
const LIVE = process.env.LIVE === '1'

// 11.5 blocks/s ×100 fixed-point: engine RUN_SPEED 10.5 + ~10% terrain slack (SPEC §17.3 — cliffs and
// valleys mean nobody sustains flat-line speed; the budget must never punish an honest straight runner).
const SPEED_BUDGET = 1150

const A = MANIFEST.aresrpg ?? MANIFEST.packages?.aresrpg
const LATEST = A.latest ?? A.package_id ?? A.pkg
const worlds = SEED.worlds.map((w) => w.world_id ?? w.id)
if (worlds.length !== 20)
  throw new Error(`expected 20 worlds, manifest has ${worlds.length}`)

const tx = new Transaction()
for (const world_id of worlds)
  tx.moveCall({
    target: `${LATEST}::world::set_speed_budget`,
    arguments: [
      tx.object(A.admin),
      tx.object(world_id),
      tx.pure.u64(SPEED_BUDGET),
      tx.object(A.version),
    ],
  })

console.log(
  `signer ${keypair.toSuiAddress()} | ${LIVE ? 'LIVE' : 'DRY-RUN ONLY'} | ${worlds.length} worlds → speed_budget=${SPEED_BUDGET}`
)
if (LIVE)
  await run(sui_client, keypair, 'speed_budget:all', tx, { ceilingSui: 0.3 })
else {
  const budget = await deriveBudget(
    sui_client,
    keypair,
    tx,
    'speed_budget:all',
    0.3
  )
  console.log(`  dry-run OK, derived budget=${budget} MIST`)
}
console.log(LIVE ? '=== SPEED BUDGETS APPLIED ===' : '=== DRY-RUN COMPLETE ===')
