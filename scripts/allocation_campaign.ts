// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFile, writeFile } from 'node:fs/promises'

import { blast_csv, normalize_address } from '../packages/immutable/src/allocation.ts'
import { connect_redis, read_awards } from '../packages/server/src/allocation/store.ts'
import { blast_allowlist } from '../packages/server/src/allocation/blast_allowlist.ts'

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
const export_csv = async (output: string): Promise<void> => {
  const redis = await connect_redis(process.env.ALLOCATION_REDIS_URL)
  try {
    const awards = await read_awards(redis)
    await write_csv(output, blast_csv(awards))
    console.log(`Exported ${awards.length} allocations to ${output}. No chain transaction was submitted.`)
  } finally {
    redis.disconnect()
  }
}
/** Reads the exact CSV handed to Blast; its row order is the leaf order. No network access. */
const allowlist = async (path: string): Promise<void> => {
  const [header, ...lines] = (await readFile(path, 'utf8')).trimEnd().split('\n')
  if (header !== 'address,cap_sui,cap_mist') throw new Error('Not a Blast allowlist CSV')
  const rows = lines.map((line) => {
    const [address, , cap] = line.split(',')
    return { address: normalize_address(address ?? ''), cap_mist: BigInt(cap ?? '') }
  })
  const { root, leaf_count } = blast_allowlist(rows)
  console.log(JSON.stringify({ root, leaf_count }))
}
const main = async (): Promise<void> => {
  const [command, path, ...rest] = process.argv.slice(2)
  const commands: Readonly<Record<string, (path: string) => Promise<void>>> = { export: export_csv, allowlist }
  const run = Object.hasOwn(commands, command ?? '') ? commands[command!] : undefined
  if (!run || !path || rest.length)
    throw new Error('Usage: bun scripts/allocation_campaign.ts export blast.csv | allowlist blast.csv')
  await run(path)
}
await main()
