// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S-30 E2E QA shared lib — THROWAWAY. Loads live ids from the manifests, binds the JSON-RPC client to the
// publicnode RPC (fullnode.testnet is dead), signs with the dev-key wallet. NEVER echoes the key.
import { readFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'

const __dir = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dir, '..', 'out')
export const ceremony = JSON.parse(readFileSync(join(OUT, 'ceremony_manifest.json'), 'utf8'))
export const seed = JSON.parse(readFileSync(join(OUT, 'seed_manifest.json'), 'utf8'))
export const LOG = join(__dir, 'e2e_run1.log')

const { PRIVATE_KEY, SUI_RPC } = process.env
if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY required')
if (!SUI_RPC) throw new Error('SUI_RPC required (publicnode)')

export const keypair = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(PRIVATE_KEY).secretKey)
export const ADDR = keypair.getPublicKey().toSuiAddress()
export const sui = new SuiJsonRpcClient({ url: SUI_RPC, network: 'testnet' })

// convenience id bundles
export const IDS = {
  game: ceremony.game.pkg,
  gameVersion: ceremony.game.version,
  gameConfig: ceremony.game.shared.GameConfig,
  characterLink: ceremony.game.shared.CharacterLink,
  equipmentRegistry: ceremony.game.shared.EquipmentRegistry,
  petFeedConfig: ceremony.game.shared.PetFeedConfig,
  gameAdmin: ceremony.game.admin,
  items: ceremony.items.pkg,
  itemsVersion: ceremony.items.version,
  catalog: ceremony.items.shared.Catalog,
  creation: ceremony.items.shared.Creation,
  scribeConfig: ceremony.items.shared.ScribeConfig,
  itemsAdmin: ceremony.items.admin,
  itemPolicy: ceremony.policies.item.policy,
  itemPolicyCap: ceremony.policies.item.cap,
  characterPolicy: ceremony.policies.character.policy,
  characterPolicyCap: ceremony.policies.character.cap,
  extractPolicy: ceremony.policies.extract.policy,
  fight: ceremony.fight.pkg,
  fightVersion: ceremony.fight.version,
  fightRegistry: ceremony.fight.shared.FightRegistry,
  dungeon: ceremony.dungeon.pkg,
  dungeonVersion: ceremony.dungeon.version,
  dungeonRegistry: ceremony.dungeon.shared.DungeonRegistry,
  pools: ceremony.pools.pkg,
  poolsVersion: ceremony.pools.version,
  poolRegistry: ceremony.pools.shared.PoolRegistry,
  kolizeum: ceremony.kolizeum.pkg,
  kolizeumVersion: ceremony.kolizeum.version,
  kolizeumRegistry: ceremony.kolizeum.shared.KolizeumRegistry,
  social: ceremony.social.pkg,
  socialVersion: ceremony.social.version,
  friendRegistry: ceremony.social.shared.FriendRegistry,
  spells: ceremony.spells.pkg,
  spellRegistry: ceremony.spells.shared.SpellRegistry,
}

export async function getObj(id, opts = {}) {
  return sui.getObject({ id, options: { showContent: true, showType: true, showOwner: true, ...opts } })
}
export async function fields(id) {
  const o = await getObj(id)
  return o?.data?.content?.fields ?? null
}
export async function typeOf(id) {
  const o = await getObj(id)
  return o?.data?.type ?? null
}

// Sign + execute; returns { digest, status, ok, err, changes, events, effects }
export async function exec(tx, label = '') {
  tx.setSender(ADDR)
  let built
  try {
    built = await tx.build({ client: sui })
  } catch (e) {
    logline(`BUILD-FAIL ${label}: ${e.message}`)
    return { ok: false, buildError: e.message, digest: null }
  }
  const r = await sui.signAndExecuteTransaction({
    signer: keypair,
    transaction: built,
    options: { showEffects: true, showObjectChanges: true, showEvents: true },
  })
  await sui.waitForTransaction({ digest: r.digest })
  const status = r.effects?.status?.status
  const err = r.effects?.status?.error ?? null
  const gas = r.effects?.gasUsed
  const gasMist = gas
    ? Number(gas.computationCost) + Number(gas.storageCost) - Number(gas.storageRebate)
    : 0
  logline(`${status === 'success' ? 'OK ' : 'FAIL'} ${label} digest=${r.digest} gasMist=${gasMist}${err ? ' err=' + err : ''}`)
  return {
    ok: status === 'success',
    status,
    err,
    digest: r.digest,
    gasMist,
    changes: r.objectChanges ?? [],
    events: r.events ?? [],
    effects: r.effects,
  }
}

// Dry-run only (for gas derivation / adversarial expected-abort without burning). Returns { ok, err, effects }
export async function dryRun(tx, label = '') {
  tx.setSender(ADDR)
  const bytes = await tx.build({ client: sui })
  const dr = await sui.dryRunTransactionBlock({ transactionBlock: bytes })
  const status = dr.effects?.status?.status
  const err = dr.effects?.status?.error ?? null
  return { ok: status === 'success', status, err, effects: dr.effects, changes: dr.objectChanges ?? [], events: dr.events ?? [] }
}

export function logline(s) {
  const line = `[${new Date().toISOString()}] ${s}\n`
  appendFileSync(LOG, line)
  console.log(s)
}

export async function balanceMist() {
  const b = await sui.getBalance({ owner: ADDR })
  return Number(b.totalBalance)
}
