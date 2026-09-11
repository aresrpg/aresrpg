// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { suins, SuinsTransaction, type PackageInfo } from '@mysten/suins'
import type { SuiClientTypes } from '@mysten/sui/client'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { isValidSuiNSName, normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'

import type { Sdk } from './client.ts'
import { receipt_digest } from './cache.ts'
import { canonical_suins_name } from './suins.ts'

export type OwnedSuinsName = Readonly<{ name: string; object_id: string; subname: boolean }>
export type SuinsSnapshot = Readonly<{ default_name: string | null; names: readonly OwnedSuinsName[] }>
export type SuinsSelection =
  | Readonly<{ ok: false; reason: 'invalid_name' | 'not_targeted' }>
  | Readonly<{ ok: true; name: string; digest: string }>
export type SuinsActions = Readonly<{
  snapshot: () => Promise<SuinsSnapshot>
  set_default: (name: string) => Promise<SuinsSelection>
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
  if (typeof name !== 'string' || !isValidSuiNSName(name) || !Number.isSafeInteger(expiration))
    throw new Error('SuiNS registration data is invalid')
  return expiration > now
    ? { name: canonical_suins_name(name), object_id: object.objectId, subname: registration.subname }
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

/** The game wallet selects its public default; NFT custody is only needed to change a target. */
export const suins_actions = ({
  client,
  sdk,
  address,
  now = Date.now,
}: Readonly<{
  client: SuiGrpcClient
  sdk: Pick<Sdk, 'execute'>
  address: string
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
  return Object.freeze({
    snapshot: async () => {
      const signal = AbortSignal.timeout(10_000)
      const [default_name, names] = await Promise.all([read_default(client, owner, signal), read_owned(signal)])
      return { default_name, names }
    },
    set_default: async (input) => {
      const name = canonical_suins_name(input)
      if (!isValidSuiNSName(name)) return { ok: false, reason: 'invalid_name' }
      const signal = AbortSignal.timeout(10_000)
      const target = await client.core.resolveNameServiceAddress({ name, signal })
      const owned =
        target.address && normalizeSuiAddress(target.address) === owner
          ? null
          : (await read_owned(signal)).find((candidate) => candidate.name === name)
      if (owned === undefined) return { ok: false, reason: 'not_targeted' }
      const transaction = new Transaction()
      const builder = new SuinsTransaction(service, transaction)
      if (owned) builder.setTargetAddress({ nft: owned.object_id, address: owner, isSubname: owned.subname })
      builder.setDefault(name)
      const receipt = await sdk.execute(transaction, { budget: 'estimate' })
      return { ok: true, name, digest: receipt_digest(receipt) }
    },
  })
}
