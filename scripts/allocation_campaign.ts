// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFile, writeFile } from 'node:fs/promises'

import { SuiGrpcClient } from '@mysten/sui/grpc'

import {
  blast_csv,
  cap_mist,
  normalize_address,
  type Award,
  type SpotProof,
} from '../packages/immutable/src/allocation.ts'
import { blast_config } from '../packages/sdk/src/blast.ts'
import { resolve_pins } from '../packages/sdk/src/pins.ts'
import { blast_proof_root } from '../packages/server/src/allocation/blast_allowlist.ts'
import { connect_redis, key, read_awards } from '../packages/server/src/allocation/store.ts'

const write_csv = async (path: string, csv: string): Promise<void> => {
  try {
    await writeFile(path, csv, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
    if ((await readFile(path, 'utf8')) !== csv)
      throw new Error('Existing CSV differs; refusing to overwrite it', { cause: error })
  }
}
/** Writes the published allocation list as the Blast handoff CSV. Read-only on the campaign store. */
const export_csv = async (output: string | undefined): Promise<void> => {
  if (!output) throw new Error('export needs an output path')
  const redis = await connect_redis(process.env.ALLOCATION_REDIS_URL)
  try {
    const awards = await read_awards(redis)
    await write_csv(output, blast_csv(awards))
    console.log(`Exported ${awards.length} allocations to ${output}. No chain transaction was submitted.`)
  } finally {
    redis.disconnect()
  }
}

// Blast's partner API allows 120 proof reads a minute for one key; this stays under it.
const BLAST_PACE_MS = 600
const BLAST_API = 'https://www.blast.fun/api/v1/presales'
const blast_proof = async (sale: string, address: string, api_key: string): Promise<SpotProof> => {
  const response = await fetch(`${BLAST_API}/${sale}/proof?wallet=${address}`, {
    headers: { 'X-Blast-Partner-Key': api_key },
  })
  const body = (await response.json()) as Readonly<{
    index?: unknown
    wallet_cap?: unknown
    proof?: unknown
    error?: Readonly<{ code?: unknown }>
  }>
  if (!response.ok) throw new Error(`Blast refused ${address}: ${response.status} ${String(body.error?.code)}`)
  const { index, wallet_cap, proof } = body
  if (
    typeof index !== 'string' ||
    typeof wallet_cap !== 'string' ||
    !Array.isArray(proof) ||
    !proof.every((sibling): sibling is string => typeof sibling === 'string' && /^[0-9a-f]{64}$/.test(sibling))
  )
    throw new Error(`Blast returned a malformed proof for ${address}`)
  return { index, cap_mist: wallet_cap, siblings: proof }
}
/** The pinned sale's allowlist root, read from the chain: the only thing a stored proof must match. */
const sale_allowlist = async (): Promise<Readonly<{ sale: string; root: string }>> => {
  const config = blast_config(resolve_pins('mainnet'))
  if (!config) throw new Error('No Blast presale is pinned')
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' })
  const { object } = await client.core.getObject({ objectId: config.id, include: { json: true } })
  const eligibility = object.json?.eligibility as Readonly<{ '@variant'?: unknown; root?: unknown }> | undefined
  if (eligibility?.['@variant'] !== 'Allowlisted' || typeof eligibility.root !== 'string')
    throw new Error('The pinned Blast presale is not allowlisted')
  return { sale: config.id, root: Buffer.from(eligibility.root, 'base64').toString('hex') }
}
const verified_proof = async (
  { sale, root }: Readonly<{ sale: string; root: string }>,
  award: Award,
  api_key: string
): Promise<readonly [string, SpotProof]> => {
  const address = normalize_address(award.address)
  const proof = await blast_proof(sale, address, api_key)
  if (BigInt(proof.cap_mist) !== cap_mist(award.tier)) throw new Error(`Blast lists another cap for ${address}`)
  if (blast_proof_root(address, proof) !== root) throw new Error(`Blast's proof for ${address} misses the sale root`)
  return [address, proof]
}
/** Stores Blast's proof for every published wallet, each checked against the sale's on-chain root
 * and the published cap. One refusal stores nothing. No chain transaction is submitted. */
const import_proofs = async (): Promise<void> => {
  const api_key = process.env.BLAST_PARTNER_API_KEY
  if (!api_key) throw new Error('BLAST_PARTNER_API_KEY is required')
  const allowlist = await sale_allowlist()
  const redis = await connect_redis(process.env.ALLOCATION_REDIS_URL)
  try {
    const awards = await read_awards(redis)
    const proofs = await awards.reduce<Promise<readonly (readonly [string, SpotProof])[]>>(async (previous, award) => {
      const done = await previous
      if (done.length) await Bun.sleep(BLAST_PACE_MS)
      return [...done, await verified_proof(allowlist, award, api_key)]
    }, Promise.resolve([]))
    if (!proofs.length) throw new Error('The published allocation list is empty')
    await redis.set(key('proofs'), JSON.stringify(Object.fromEntries(proofs)))
    console.log(`Stored ${proofs.length} verified Blast proofs for sale root ${allowlist.root}.`)
  } finally {
    redis.disconnect()
  }
}
const main = async (): Promise<void> => {
  const [command, path, ...rest] = process.argv.slice(2)
  const commands: Readonly<Record<string, (path: string | undefined) => Promise<void>>> = {
    export: export_csv,
    proofs: import_proofs,
  }
  const run = Object.hasOwn(commands, command ?? '') ? commands[command!] : undefined
  if (!run || rest.length || (command === 'proofs' && path))
    throw new Error('Usage: bun scripts/allocation_campaign.ts export blast.csv | proofs')
  await run(path)
}
await main()
