// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { suins, SuinsTransaction, type SuinsClient, type PackageInfo } from '@mysten/suins'
import { bcs } from '@mysten/sui/bcs'
import type { SuiClientTypes } from '@mysten/sui/client'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { isValidSuiNSName, normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'

import type { Sdk } from './client.ts'
import { receipt_digest } from './cache.ts'
import { canonical_suins_name } from './suins.ts'

export type OwnedSuinsName = Readonly<{ name: string; object_id: string; nft_id: string; subname: boolean }>
export type SuinsSnapshot = Readonly<{ default_name: string | null; names: readonly OwnedSuinsName[] }>
export type SuinsSelection = Readonly<{ name: string; digest?: string }>
export type SuinsActions = Readonly<{
  managed: boolean
  snapshot: () => Promise<SuinsSnapshot>
  validate_parent: (name: string, before_sign: () => void) => Promise<void>
  apply_parent: (name: string, agent_address: string, before_sign: () => void) => Promise<SuinsSelection>
}>

type RegistrationType = Readonly<{ type: string; subname: boolean }>

const registration_name = (
  object: SuiClientTypes.Object<{ json: true }>,
  registration: RegistrationType,
  owner: string,
  now: number
): OwnedSuinsName | null => {
  if (
    object.owner.$kind !== 'AddressOwner' ||
    normalizeSuiAddress(object.owner.AddressOwner) !== owner ||
    normalizeStructTag(object.type) !== registration.type
  )
    throw new Error('SuiNS registration ownership changed')
  if (!object.json) throw new Error('SuiNS registration data is missing')
  const fields = (registration.subname ? object.json.nft : object.json) as Record<string, unknown>
  const name = fields.domain_name
  const expiration = Number(fields.expiration_timestamp_ms)
  if (
    ![typeof name === 'string', typeof fields.id === 'string'].every(Boolean) ||
    !Number.isSafeInteger(expiration) ||
    !isValidSuiNSName(String(name))
  )
    throw new Error('SuiNS registration data is invalid')
  return expiration > now
    ? {
        name: canonical_suins_name(String(name)),
        object_id: object.objectId,
        nft_id: normalizeSuiAddress(String(fields.id)),
        subname: registration.subname,
      }
    : null
}

const registration_types = async (
  client: SuiGrpcClient,
  config: PackageInfo,
  signal: AbortSignal
): Promise<readonly RegistrationType[]> => {
  const { response } = await client.movePackageService.getDatatype(
    {
      packageId: config.packageId,
      moduleName: 'subdomain_registration',
      name: 'SubDomainRegistration',
    },
    { abort: signal }
  )
  const defining_id = response.datatype?.definingId
  if (!defining_id) throw new Error('SuiNS subname registration type is unavailable')
  return [
    { type: normalizeStructTag(`${config.packageIdV1}::suins_registration::SuinsRegistration`), subname: false },
    { type: normalizeStructTag(`${defining_id}::subdomain_registration::SubDomainRegistration`), subname: true },
  ]
}

const read_registrations = async (
  client: SuiGrpcClient,
  owner: string,
  registration: RegistrationType,
  now: number,
  signal: AbortSignal
): Promise<readonly OwnedSuinsName[]> => {
  const names: OwnedSuinsName[] = []
  let cursor: string | null | undefined
  do {
    const page = await client.core.listOwnedObjects({
      owner,
      type: registration.type,
      cursor,
      signal,
      include: { json: true },
    })
    names.push(
      ...page.objects
        .map((object) => registration_name(object, registration, owner, now))
        .filter((name) => name !== null)
    )
    if (page.hasNextPage && (!page.cursor || page.cursor === cursor))
      throw new Error('SuiNS registration pagination stalled')
    cursor = page.hasNextPage ? page.cursor : null
  } while (cursor)
  return names
}

const read_default = async (client: SuiGrpcClient, address: string, signal: AbortSignal): Promise<string | null> => {
  try {
    const { data } = await client.core.defaultNameServiceName({ address, signal })
    if (!data.name) return null
    const name = canonical_suins_name(data.name)
    const target = await client.core.resolveNameServiceAddress({ name, signal })
    return target.address && normalizeSuiAddress(target.address) === address ? name : null
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'NOT_FOUND') return null
    throw error
  }
}

type NameRecord = NonNullable<Awaited<ReturnType<SuinsClient['getNameRecord']>>>
type LeafChange = 'none' | 'create' | 'replace'
const refuse = (reason: 'invalid_parent' | 'collision' | 'metadata' | 'unsupported'): never => {
  throw new Error(`SuiNS ${reason}`, { cause: reason })
}

// Configured deployment's SubDomainConfig, read fresh rather than copying its mutable limits.
export const subdomain_config = bcs.struct('SubDomainConfig', {
  allowed_tlds: bcs.vector(bcs.string()),
  max_depth: bcs.u8(),
  min_label_size: bcs.u8(),
  minimum_duration: bcs.u64(),
})
type SubdomainConfig = ReturnType<typeof subdomain_config.parse>
const read_config = async (client: SuiGrpcClient, config: PackageInfo): Promise<SubdomainConfig> => {
  const { dynamicField } = await client.core.getDynamicField({
    parentId: config.suins,
    name: {
      type: `${config.packageIdV1}::suins::ConfigKey<${config.subNamesPackageId}::config::SubDomainConfig>`,
      bcs: new Uint8Array([0]),
    },
    signal: AbortSignal.timeout(10_000),
  })
  return subdomain_config.parse(dynamicField.value.bcs)
}
const eligible_parent = (
  parent: OwnedSuinsName,
  record: NameRecord | null,
  config: SubdomainConfig,
  now: number
): boolean =>
  !!record &&
  [
    normalizeSuiAddress(record.nftId) === parent.nft_id,
    record.expirationTimestampMs > now,
    !parent.subname || Object.hasOwn(record.data, 'S_AC'),
    config.allowed_tlds.includes(parent.name.split('.').at(-1)!),
    parent.name.split('.').length + 1 <= config.max_depth,
    'aresrpg'.length >= config.min_label_size,
  ].every(Boolean)

/** Deployed leaf replacement resets metadata, so all unknown keys are protected too. */
export const leaf_change = (
  record: NameRecord | null,
  parent_nft: string,
  target: string | undefined,
  now: number
): LeafChange => {
  if (!record) return 'create'
  const leaf = record.expirationTimestampMs === 0
  const lineage = normalizeSuiAddress(record.nftId) === parent_nft
  const targeted = target === undefined || normalizeSuiAddress(record.targetAddress) === target
  if ([leaf, lineage, targeted].every(Boolean)) return 'none'
  if ([!leaf, record.expirationTimestampMs >= now].every(Boolean)) return refuse('collision')
  if (Object.keys(record.data).length) return refuse('metadata')
  return leaf && lineage ? 'replace' : 'create'
}

/** Only managed application leaves are written; external-wallet defaults are read-only. */
export const suins_actions = ({
  client,
  sdk,
  address,
  managed = false,
  now = Date.now,
}: Readonly<{
  client: SuiGrpcClient
  sdk: Pick<Sdk, 'execute'>
  address: string
  managed?: boolean
  now?: () => number
}>): SuinsActions => {
  const service = client.$extend(suins()).suins
  const owner = normalizeSuiAddress(address)
  const read_owned = async (signal: AbortSignal): Promise<readonly OwnedSuinsName[]> => {
    const types = await registration_types(client, service.config, signal)
    const timestamp = now()
    const pages = await Promise.all(types.map((type) => read_registrations(client, owner, type, timestamp, signal)))
    return pages.flat().toSorted((a, b) => a.name.localeCompare(b.name))
  }
  const inspect = async (input: string, agent: string | undefined, current: () => void) => {
    current()
    if (!managed) return refuse('unsupported')
    const name = canonical_suins_name(input)
    if (!isValidSuiNSName(name)) return refuse('invalid_parent')
    const [owned, config, record] = await Promise.all([
      read_owned(AbortSignal.timeout(10_000)),
      read_config(client, service.config),
      service.getNameRecord(name),
    ])
    current()
    const parent = owned.find((candidate) => candidate.name === name)
    if (!parent || !eligible_parent(parent, record, config, now())) return refuse('invalid_parent')
    const leaves = [
      { name: `aresrpg.${name}`, target: owner },
      { name: `aresrpgagent.${name}`, target: agent },
    ]
    const records = await Promise.all(leaves.map((leaf) => service.getNameRecord(leaf.name)))
    current()
    return {
      parent,
      leaves: leaves.map((leaf, index) => ({
        ...leaf,
        change: leaf_change(records[index]!, parent.nft_id, leaf.target, now()),
      })),
    }
  }
  return Object.freeze({
    managed,
    snapshot: async () => {
      const signal = AbortSignal.timeout(10_000)
      const default_name = await read_default(client, owner, signal)
      if (!managed) return { default_name, names: [] }
      const [owned, config] = await Promise.all([read_owned(signal), read_config(client, service.config)])
      const records = await Promise.all(owned.map((parent) => service.getNameRecord(parent.name)))
      return {
        default_name,
        names: owned.filter((parent, index) => eligible_parent(parent, records[index]!, config, now())),
      }
    },
    validate_parent: async (input, before_sign) => {
      await inspect(input, undefined, before_sign)
    },
    apply_parent: async (input, agent_address, before_sign) => {
      const agent = normalizeSuiAddress(agent_address)
      const { parent, leaves } = await inspect(input, agent, before_sign)
      const { name } = leaves[0]!
      const current_default = await read_default(client, owner, AbortSignal.timeout(10_000))
      before_sign()
      if (leaves.every((leaf) => leaf.change === 'none') && current_default === name) return { name }
      const transaction = new Transaction()
      const builder = new SuinsTransaction(service, transaction)
      for (const leaf of leaves) {
        if (leaf.change === 'none') continue
        if (leaf.change === 'replace') builder.removeLeafSubName({ parentNft: parent.object_id, name: leaf.name })
        builder.createLeafSubName({ parentNft: parent.object_id, name: leaf.name, targetAddress: leaf.target! })
      }
      if (current_default !== name || leaves[0]!.change !== 'none') builder.setDefault(name)
      const receipt = await sdk.execute(transaction, { budget: 'estimate', before_sign })
      return { name, digest: receipt_digest(receipt) }
    },
  })
}

/** The retained multisig executor signs its own reverse record; no parent NFT or transfer is involved. */
export const set_agent_suins_default = async (
  client: SuiGrpcClient,
  sdk: Pick<Sdk, 'execute'>,
  address: string,
  input: string,
  before_sign: () => void
): Promise<void> => {
  before_sign()
  const name = canonical_suins_name(input)
  if (!isValidSuiNSName(name) || !name.startsWith('aresrpgagent.')) return refuse('invalid_parent')
  const owner = normalizeSuiAddress(address)
  const signal = AbortSignal.timeout(10_000)
  const target = await client.core.resolveNameServiceAddress({ name, signal })
  before_sign()
  if (!target.address || normalizeSuiAddress(target.address) !== owner) return refuse('invalid_parent')
  const current_default = await read_default(client, owner, signal)
  before_sign()
  if (current_default === name) return
  const transaction = new Transaction()
  new SuinsTransaction(client.$extend(suins()).suins, transaction).setDefault(name)
  await sdk.execute(transaction, { budget: 'estimate', before_sign })
}
