// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fixed local transport using the owner's configured Sui CLI signer. Never mints supply.

import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { isValidSuiAddress, normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'

const usage = `Usage: bun scripts/send_giftcards.mjs --network <testnet|mainnet> --manifest <file>
  [--execute --receipts <new-file>]

Manifest: [{ "id": "0xGiftcard", "recipient": "0xWalletOrNFT" }]
Defaults to simulation. Uses the active Sui CLI environment and signer.
Execution requires a new receipt journal. Never rerun a submitted batch blindly.`

export const parse_send_args = (args) => {
  const { values } = parseArgs({
    args,
    options: {
      network: { type: 'string' },
      manifest: { type: 'string' },
      receipts: { type: 'string' },
      execute: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  })
  if (values.help) return { help: true }
  const { network, manifest, receipts, execute } = values
  if (!['testnet', 'mainnet'].includes(network) || !manifest) throw new Error(usage)
  if (execute && !receipts) throw new Error('Execution requires --receipts <new-file>')
  return { network, manifest, receipts, execute }
}

export const giftcard_batches = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('The manifest must contain giftcards')
  const transfers = rows.map((row) => {
    if (!row || !isValidSuiAddress(row.id) || !isValidSuiAddress(row.recipient))
      throw new Error('Every row needs a giftcard id and recipient address')
    return { id: normalizeSuiAddress(row.id), recipient: normalizeSuiAddress(row.recipient) }
  })
  if (new Set(transfers.map(({ id }) => id)).size !== transfers.length)
    throw new Error('The manifest repeats a giftcard')
  return Array.from({ length: Math.ceil(transfers.length / 100) }, (_, index) =>
    transfers.slice(index * 100, (index + 1) * 100)
  )
}

const assert_custody = (result, type, sender) => {
  const object = result
  if (
    normalizeStructTag(object.objType) !== type ||
    typeof object.owner?.AddressOwner !== 'string' ||
    normalizeSuiAddress(object.owner.AddressOwner) !== sender
  )
    throw new Error(`Giftcard is not canonical and held by ${sender}`)
}

const assert_success = (result) => {
  if (result.effects?.status?.status !== 'success')
    throw new Error(`Inspect the failed transaction result: ${JSON.stringify(result)}`)
}

/** Sui PTB dry-run prints its renderer even with --json (verified against the installed CLI).
 * Treat only its explicit successful status as success; never infer it from exit code alone. */
export const decode_cli_result = (args, output) => {
  if (!args.includes('--dry-run')) return JSON.parse(output)
  if (!output.startsWith('Dry run completed, execution status: success\n'))
    throw new Error(`Simulation did not succeed: ${output}`)
  return { effects: { status: { status: 'success' } } }
}

const cli = (args) =>
  decode_cli_result(
    args,
    execFileSync('sui', ['client', ...args, '--json'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
  )

export const send_giftcards = async ({ batches, package_id, execute, run = cli, save }) => {
  const sender = normalizeSuiAddress(run(['active-address']))
  const type = normalizeStructTag(`${package_id}::distribution::Giftcard`)
  // Validate the entire plan before the first transaction. Wrong network/custody/type stops here.
  for (const batch of batches) {
    for (const { id } of batch) {
      assert_custody(run(['object', id]), type, sender)
    }
  }
  for (const [index, batch] of batches.entries()) {
    const args = ['ptb', ...batch.flatMap(({ id, recipient }) => ['--transfer-objects', `[@${id}]`, `@${recipient}`])]
    const simulation = run([...args, '--dry-run'])
    assert_success(simulation)
    if (!execute) continue
    // Persist intent before submission: a lost response leaves an explicit uncertain batch.
    await save({ index, status: 'submitting', sender, transfers: batch })
    const receipt = run(args)
    await save({ index, status: 'executed', receipt })
    assert_success(receipt)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parse_send_args(process.argv.slice(2))
  if (options.help) console.log(usage)
  else {
    const pins = JSON.parse(await readFile(new URL('../pins.json', import.meta.url), 'utf8'))
    const package_id = pins[options.network]?.package_original
    if (!package_id) throw new Error(`No published ${options.network} Giftcard package`)
    const batches = giftcard_batches(JSON.parse(await readFile(options.manifest, 'utf8')))
    if (options.execute) await writeFile(options.receipts, '', { flag: 'wx', mode: 0o600 })
    await send_giftcards({
      ...options,
      batches,
      package_id,
      save: (row) => writeFile(options.receipts, `${JSON.stringify(row)}\n`, { flag: 'a' }),
    })
    console.log(
      `${batches.length} batches ${options.execute ? 'executed; inspect receipt journal' : 'simulated; no gifts sent'}`
    )
  }
}
