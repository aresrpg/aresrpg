// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Package publication and live-version administration. Compilation stays at the local tooling
// boundary; this module owns the resulting Sui transactions and receipt projection.

import { Transaction } from '@mysten/sui/transactions'
import { normalizeStructTag, normalizeSuiObjectId } from '@mysten/sui/utils'

import { receipt_events, type Receipt } from './cache.ts'
import type { Sdk } from './client.ts'

export type ContractArtifact = Readonly<{
  package_name: 'aresrpg_math' | 'aresrpg_control' | 'aresrpg_seed' | 'aresrpg'
  digest: readonly number[]
  modules: readonly string[]
  dependencies: readonly string[]
}>

type DeploymentReceipt = Receipt &
  Readonly<{
    Transaction?: NonNullable<Receipt['Transaction']> & Readonly<{ objectTypes?: Readonly<Record<string, string>> }>
  }>

export type SharedDeploymentPin = Readonly<{ id: string; shared_version: string }>
export type GameDeployment = Readonly<{
  package: string
  kiosk_package: string
  publisher: string
  item_publisher: string
  character_publisher: string
  version: SharedDeploymentPin
  loot_registry?: SharedDeploymentPin
  name_registry?: SharedDeploymentPin
  friend_registry?: SharedDeploymentPin
}>
export type MathDeployment = Readonly<{ package: string; upgrade_cap: string }>
/** The one application-authority package: every AresRPG package imports this AdminCap type. */
export type ControlDeployment = Readonly<{
  package: string
  upgrade_cap: string
  admin_cap: string
}>
/** The seed package's publish yield: the shared Registry root every content address derives under. */
export type SeedDeployment = Readonly<{
  package: string
  upgrade_cap: string
  content_root: SharedDeploymentPin
}>
export type BootstrapDeployment = Readonly<{
  item_policy: SharedDeploymentPin
  character_policy: SharedDeploymentPin
  item_protected_policy: SharedDeploymentPin
  character_protected_policy: SharedDeploymentPin
}>

export const DISPLAY_REGISTRY_ID = '0xd'

const changed_objects = (receipt: DeploymentReceipt) => receipt.Transaction?.effects?.changedObjects ?? []
const type_entries = (receipt: DeploymentReceipt): readonly (readonly [string, string])[] =>
  Object.entries(receipt.Transaction?.objectTypes ?? {})
const id_of_type = (receipt: DeploymentReceipt, suffix: string): string => {
  const found = type_entries(receipt).find(([, type]) => type.endsWith(suffix))?.[0]
  if (!found) throw new Error(`Published package did not create ${suffix}`)
  return found
}
const shared_pin = (receipt: DeploymentReceipt, id: string): SharedDeploymentPin => {
  const change = changed_objects(receipt).find(({ objectId }) => objectId === id)
  const version = change?.outputOwner?.Shared?.initialSharedVersion
  if (version === undefined) throw new Error(`Published object ${id} is not shared`)
  return Object.freeze({ id, shared_version: String(version) })
}

export const create_package_publish_transaction = ({
  artifact,
  recipient,
}: Readonly<{ artifact: ContractArtifact; recipient: string }>): Transaction => {
  const transaction = new Transaction()
  const upgrade_cap = transaction.publish({ modules: [...artifact.modules], dependencies: [...artifact.dependencies] })
  transaction.transferObjects([upgrade_cap], recipient)
  return transaction
}

export const create_package_upgrade_transaction = ({
  sdk,
  artifact,
  package: package_id,
  upgrade_cap,
  policy,
}: Readonly<{
  sdk: Sdk
  artifact: ContractArtifact
  package: string
  upgrade_cap: string
  policy: number
}>): Transaction => {
  const transaction = sdk.tx()
  const capability = sdk.door_context.obj(transaction, upgrade_cap, false)
  const ticket = transaction.moveCall({
    target: '0x2::package::authorize_upgrade',
    arguments: [capability, transaction.pure.u8(policy), transaction.pure.vector('u8', [...artifact.digest])],
  })
  const receipt = transaction.upgrade({
    modules: [...artifact.modules],
    dependencies: [...artifact.dependencies],
    package: package_id,
    ticket,
  })
  transaction.moveCall({ target: '0x2::package::commit_upgrade', arguments: [capability, receipt] })
  return transaction
}

export const create_version_admin_transaction = ({
  sdk,
  package_id,
  version,
  admin_cap,
  action,
}: Readonly<{
  sdk: Sdk
  package_id: string
  version: string
  admin_cap: string
  action: 'pause' | 'resume'
}>): Transaction => {
  const transaction = sdk.tx()
  transaction.moveCall({
    target: `${package_id}::version::${action === 'pause' ? 'admin_freeze' : 'admin_update'}`,
    arguments: [sdk.door_context.obj(transaction, version, true), sdk.door_context.obj(transaction, admin_cap, false)],
  })
  return transaction
}

export const create_deployment_bootstrap_transaction = async ({
  sdk,
  package_id,
  kiosk_package,
  publisher,
  recipient,
}: Readonly<{
  sdk: Sdk
  package_id: string
  kiosk_package: string
  publisher: string
  recipient: string
}>): Promise<Transaction> => {
  const transaction = sdk.tx()
  const display_registry = sdk.door_context.obj(transaction, DISPLAY_REGISTRY_ID, true)
  const publisher_arg = sdk.door_context.obj(transaction, publisher, false)
  const item_type = `${package_id}::item::Item`
  const character_type = `${package_id}::character::Character`
  const item_display = transaction.moveCall({
    target: `${package_id}::admin::create_item_display`,
    arguments: [display_registry, publisher_arg],
  })
  const character_display = transaction.moveCall({
    target: `${package_id}::admin::create_character_display`,
    arguments: [display_registry, publisher_arg],
  })
  transaction.transferObjects([item_display, character_display], recipient)
  transaction.moveCall({
    target: `${package_id}::protected_policy::mint_and_share`,
    typeArguments: [item_type],
    arguments: [publisher_arg],
  })
  transaction.moveCall({
    target: `${package_id}::protected_policy::mint_and_share`,
    typeArguments: [character_type],
    arguments: [publisher_arg],
  })

  const configure_policy = async (
    type: string,
    publisher: typeof publisher_arg,
    local_rules: readonly string[]
  ): Promise<void> => {
    const policy = sdk.transfer_policy_transaction(transaction, kiosk_package)
    await policy.create({ type, publisher, skipCheck: true })
    policy.addRoyaltyRule(1000, 10_000_000)
    policy.addPersonalKioskRule()
    policy.addLockRule()
    if (!policy.policy || !policy.policyCap) throw new Error(`Transfer policy for ${type} was not created`)
    const policy_arg = typeof policy.policy === 'string' ? transaction.object(policy.policy) : policy.policy
    const policy_cap_arg =
      typeof policy.policyCap === 'string' ? transaction.object(policy.policyCap) : policy.policyCap
    for (const rule of local_rules)
      transaction.moveCall({
        target: `${package_id}::${rule}::add`,
        arguments: [policy_arg, policy_cap_arg],
      })
    policy.shareAndTransferCap(recipient)
  }
  await configure_policy(item_type, publisher_arg, ['listing_rule', 'lot_rule'])
  await configure_policy(character_type, publisher_arg, ['naked_rule'])
  return transaction
}

export const project_package_id = (receipt: DeploymentReceipt): string => {
  const package_change = changed_objects(receipt).find(
    ({ objectId, idOperation, outputState }) =>
      idOperation === 'Created' && outputState === 'PackageWrite' && !!objectId
  )
  if (!package_change?.objectId) throw new Error('Publication receipt did not contain the package object')
  return package_change.objectId
}

export const project_math_deployment = (receipt: DeploymentReceipt): MathDeployment =>
  Object.freeze({
    package: project_package_id(receipt),
    upgrade_cap: id_of_type(receipt, '::package::UpgradeCap'),
  })

export const project_control_deployment = (receipt: DeploymentReceipt): ControlDeployment =>
  Object.freeze({
    package: project_package_id(receipt),
    upgrade_cap: id_of_type(receipt, '::package::UpgradeCap'),
    admin_cap: id_of_type(receipt, '::admin::AdminCap'),
  })

export const project_seed_deployment = (receipt: DeploymentReceipt): SeedDeployment =>
  Object.freeze({
    package: project_package_id(receipt),
    upgrade_cap: id_of_type(receipt, '::package::UpgradeCap'),
    content_root: shared_pin(receipt, id_of_type(receipt, '::registry::Registry')),
  })

export const project_kiosk_package = (artifact: ContractArtifact, local_packages: readonly string[]): string => {
  const canonical_id = (value: string) => normalizeSuiObjectId(value)
  const excluded = new Set(['0x1', '0x2', ...local_packages].map(canonical_id))
  const candidates = artifact.dependencies.map(canonical_id).filter((dependency) => !excluded.has(dependency))
  if (candidates.length !== 1) throw new Error('Game artifact did not contain exactly one Kiosk dependency')
  return candidates[0]!
}

export const project_bootstrap_deployment = (receipt: DeploymentReceipt, package_id: string): BootstrapDeployment => {
  const shared_type = (type: string): SharedDeploymentPin => {
    const expected_type = normalizeStructTag(type)
    const id = type_entries(receipt).find(([, object_type]) => normalizeStructTag(object_type) === expected_type)?.[0]
    if (!id) throw new Error(`Deployment bootstrap did not create ${type}`)
    return shared_pin(receipt, id)
  }
  const item = `${package_id}::item::Item`
  const character = `${package_id}::character::Character`
  return Object.freeze({
    item_policy: shared_type(`0x2::transfer_policy::TransferPolicy<${item}>`),
    character_policy: shared_type(`0x2::transfer_policy::TransferPolicy<${character}>`),
    item_protected_policy: shared_type(`${package_id}::protected_policy::AresRPG_TransferPolicy<${item}>`),
    character_protected_policy: shared_type(`${package_id}::protected_policy::AresRPG_TransferPolicy<${character}>`),
  })
}

export const project_game_deployment = ({
  receipt,
  kiosk_package,
}: Readonly<{ receipt: DeploymentReceipt; kiosk_package: string }>): GameDeployment => {
  const package_id = project_package_id(receipt)
  const version_id = id_of_type(receipt, '::version::Version')
  const optional_shared = (suffix: string): SharedDeploymentPin | undefined => {
    const id = type_entries(receipt).find(([, type]) => type.endsWith(suffix))?.[0]
    return id ? shared_pin(receipt, id) : undefined
  }
  // Sui validates Publisher capabilities against a type's package, not its witness module.
  // The receipt type map is finality data; unlike an immediate object-content read, it cannot lag.
  const publisher = id_of_type(receipt, '::package::Publisher')
  return Object.freeze({
    package: package_id,
    kiosk_package,
    publisher,
    item_publisher: publisher,
    character_publisher: publisher,
    version: shared_pin(receipt, version_id),
    loot_registry: optional_shared('::loot_box::LootRegistry'),
    name_registry: optional_shared('::character::NameRegistry'),
    friend_registry: optional_shared('::friends::FriendRegistry'),
  })
}
