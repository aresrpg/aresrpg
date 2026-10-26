// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Integration-only compiler/publication boundary. The transport is restricted to the local rehearsal node.
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

import { SuiGrpcClient } from '@mysten/sui/grpc'
import { requestSuiFromFaucetV2 } from '@mysten/sui/faucet'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { fromBase58 } from '@mysten/sui/utils'
import type { Transaction } from '@mysten/sui/transactions'

import { SDK, type Pins, type Receipt } from '../../packages/sdk/src/client.ts'
import {
  create_package_publish_transaction,
  create_package_upgrade_transaction,
  project_package_id,
} from '../../packages/sdk/src/deployment_admin.ts'
import { parse_contract_artifact, run_build_command } from '../deployment_build.ts'
import manifest from '../../move-packages.json'

export const ROOT = resolve(import.meta.dirname, '../..')
export const RPC = 'http://127.0.0.1:19000'
export const FAUCET = 'http://127.0.0.1:19123'
export const object_of = (receipt: Receipt, suffix: string): string => {
  const match = Object.entries(receipt.Transaction?.objectTypes ?? {}).find(([, type]) => type.endsWith(suffix))
  assert.ok(match, `Missing receipt object ${suffix}`)
  return match[0]
}
export const shared_of = (receipt: Receipt, suffix: string) => {
  const id = object_of(receipt, suffix)
  const change = receipt.Transaction?.effects?.changedObjects?.find((row) => row.objectId === id)
  const version = change?.outputOwner?.Shared?.initialSharedVersion
  assert.ok(version, `Missing shared version for ${suffix}`)
  return { id, shared_version: String(version) }
}
export type Publication = Readonly<{ package: string; original: string; cap: string; version: string; path: string }>

export const local_packages = async ({ rpc_url, faucet_url } = { rpc_url: RPC, faucet_url: FAUCET }) => {
  assert.equal(new URL(rpc_url).hostname, '127.0.0.1')
  assert.equal(new URL(faucet_url).hostname, '127.0.0.1')
  const client = new SuiGrpcClient({ network: 'testnet', baseUrl: rpc_url })
  const { chainIdentifier: identifier } = await client.core.getChainIdentifier()
  const chain_id = Buffer.from(fromBase58(identifier)).subarray(0, 4).toString('hex')
  const workspace = await mkdtemp(join(tmpdir(), 'ares-upgrade-rehearsal-'))
  const cli_config = join(workspace, 'client.yaml')
  const empty_keystore = join(workspace, 'empty.keystore')
  await writeFile(empty_keystore, '[]', { mode: 0o600 })
  await writeFile(
    cli_config,
    JSON.stringify({
      keystore: { File: empty_keystore },
      envs: [{ alias: 'localnet', rpc: rpc_url }],
      active_env: 'localnet',
      active_address: null,
    })
  )
  const owner = Ed25519Keypair.generate()
  await requestSuiFromFaucetV2({ host: faucet_url, recipient: owner.toSuiAddress() })
  const sdk_for = (signer: Ed25519Keypair, pins: Pins = {}) =>
    SDK({ signer, rpc_url, network: 'testnet', pins, gas_budget: 'estimate', transaction_storage: null })
  const sdk = sdk_for(owner)
  const receipts: { label: string; digest: string }[] = []
  const send = async (label: string, transaction: Transaction, actor = sdk): Promise<Receipt> => {
    const receipt = await actor.execute(transaction, {
      budget: 'estimate',
      include: { objectTypes: true, events: true, balanceChanges: true },
    })
    const digest = receipt.Transaction?.digest
    assert.ok(digest, `No certified success for ${label}`)
    receipts.push({ label, digest })
    await client.core.waitForTransaction({ digest })
    console.log(`${label}: ${digest}`)
    return receipt
  }
  const json = async (id: string) => {
    const { object } = await client.core.getObject({ objectId: id, include: { json: true } })
    assert.ok(object.json)
    return object.json
  }
  const publications: Record<string, Publication> = {}
  for (const row of manifest.packages) {
    const path = join(workspace, row.path)
    await mkdir(path, { recursive: true })
    await cp(join(ROOT, row.path, 'sources'), join(path, 'sources'), { recursive: true })
    const source = await readFile(join(ROOT, row.path, 'Move.toml'), 'utf8')
    // Legacy manifests ignore custom environments. The isolated copy uses implicit self addresses.
    const modern = source.replace(/\n\[addresses\][\s\S]*?(?=\n\[|$)/, '')
    const treasury = source.match(/^treasury\s*=\s*"(0x[0-9a-f]+)"/m)?.[1]
    if (treasury)
      for (const file of await readdir(join(path, 'sources'))) {
        if (!file.endsWith('.move')) continue
        const target = join(path, 'sources', file)
        await writeFile(target, (await readFile(target, 'utf8')).replaceAll('@treasury', `@${treasury}`))
      }
    await writeFile(join(path, 'Move.toml'), `${modern}\n[environments]\nlocalnet = "${chain_id}"\n`)
  }
  const compile = async (slot: string) => {
    const row = manifest.packages.find((row) => row.slot === slot)
    const path = row ? join(workspace, row.path) : join(workspace, slot)
    const pubfile = join(workspace, 'Pub.local.toml')
    const rows = Object.values(publications).map(
      (row) =>
        `[[published]]\nsource = { local = ${JSON.stringify(row.path)} }\npublished-at = "${row.package}"\noriginal-id = "${row.original}"\nversion = ${row.version}\n`
    )
    await writeFile(pubfile, `build-env = "localnet"\nchain-id = "${chain_id}"\n${rows.join('\n')}`)
    const { stdout } = await run_build_command(
      'sui',
      [
        'move',
        '--client.config',
        cli_config,
        '--client.env',
        'localnet',
        'build',
        '--path',
        path,
        '--build-env',
        'localnet',
        '--pubfile-path',
        pubfile,
        '--dump-bytecode-as-base64',
        '--warnings-are-errors',
      ],
      ROOT
    )
    return {
      path,
      artifact: parse_contract_artifact(
        (row?.package_name ?? 'kares_test_token') as Parameters<typeof parse_contract_artifact>[0],
        stdout
      ),
    }
  }
  const publish = async (slot: string) => {
    const { path, artifact } = await compile(slot)
    const receipt = await send(
      `publish ${slot}`,
      create_package_publish_transaction({ artifact, recipient: owner.toSuiAddress() })
    )
    const package_id = project_package_id(receipt)
    const cap = object_of(receipt, '::package::UpgradeCap')
    publications[slot] = {
      path,
      package: package_id,
      original: package_id,
      cap,
      version: String((await json(cap)).version),
    }
    return receipt
  }
  const upgrade = async (slot: string) => {
    const current = publications[slot]!
    const { artifact } = await compile(slot)
    await sdk.hydrate([current.cap])
    const receipt = await send(
      `upgrade ${slot}`,
      create_package_upgrade_transaction({
        sdk,
        artifact,
        package: current.package,
        upgrade_cap: current.cap,
        policy: 0,
      })
    )
    publications[slot] = {
      ...current,
      package: project_package_id(receipt),
      version: String((await json(current.cap)).version),
    }
    return receipt
  }
  const prepare_kiosk = async () => {
    const game_manifest = await readFile(join(ROOT, 'packages/move/Move.toml'), 'utf8')
    const spec = game_manifest.match(/^Kiosk\s*=\s*(\{[^\n]+\})$/m)?.[1]
    assert.ok(spec)
    const { stdout } = await run_build_command('sui', ['move', 'cache-package', 'testnet', '4c78adac', spec], ROOT)
    const cached = JSON.parse(stdout.slice(stdout.indexOf('{')))
    const path = join(workspace, 'kiosk')
    await mkdir(path, { recursive: true })
    await cp(join(cached.path, 'sources'), join(path, 'sources'), { recursive: true })
    // Kiosk is normally a dependency. Its legacy API warnings must not alter this local fixture's ABI.
    for (const file of await readdir(join(path, 'sources'), { recursive: true })) {
      if (!file.endsWith('.move')) continue
      const target = join(path, 'sources', file)
      const source = await readFile(target, 'utf8')
      await writeFile(
        target,
        source.replace(/^module /m, '#[allow(deprecated_usage, lint(self_transfer, share_owned))]\nmodule ')
      )
    }
    await writeFile(
      join(path, 'Move.toml'),
      `[package]\nname = "kiosk"\nedition = "legacy"\n[environments]\nlocalnet = "${chain_id}"\n`
    )
    const target = join(workspace, 'packages/move/Move.toml')
    await writeFile(
      target,
      (await readFile(target, 'utf8')).replace(/^Kiosk\s*=.*$/m, `kiosk = { local = "../../kiosk" }`)
    )
    return publish('kiosk')
  }
  const create_fixture = async (name: string, source: string) => {
    const path = join(workspace, name)
    await mkdir(join(path, 'sources'), { recursive: true })
    await writeFile(
      join(path, 'Move.toml'),
      `[package]\nname = "${name}"\nedition = "2024"\n[environments]\nlocalnet = "${chain_id}"\n`
    )
    await writeFile(join(path, 'sources/main.move'), source)
    return publish(name)
  }
  return {
    workspace,
    rpc_url,
    faucet_url,
    client,
    owner,
    sdk,
    sdk_for,
    publications,
    receipts,
    send,
    json,
    publish,
    upgrade,
    compile,
    prepare_kiosk,
    create_fixture,
    cleanup: () => rm(workspace, { recursive: true, force: true }),
  }
}
