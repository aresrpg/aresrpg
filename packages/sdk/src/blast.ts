// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { SuiClientTypes } from '@mysten/sui/client'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { isValidSuiObjectId, normalizeStructTag, normalizeSuiObjectId, SUI_TYPE_ARG } from '@mysten/sui/utils'

import { resolve_pins, type Pins, type DeploymentNetwork } from './pins.ts'
import { kares_coin_type } from './kares_ptb.ts'

const LIFECYCLES = ['Pending', 'Open', 'Funded', 'Migrated', 'Cancelled'] as const
export type BlastLifecycle = (typeof LIFECYCLES)[number]

const u64 = (value: unknown): bigint => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) > (1n << 64n) - 1n)
    throw new Error('Blast presale contains an invalid chain integer')
  return BigInt(value)
}

export type BlastPhase = 'soon' | 'live' | 'closing' | 'funded' | 'complete' | 'cancelled'
export type BlastSnapshot = Readonly<{
  version: string
  clock_ms: bigint
  phase: BlastPhase
  committed: bigint
  target: bigint
  progress_bps: number
}>
export type BlastConfig = Readonly<{ id: string; package_original: string; url: string; coin_type: string }>
export const BLAST_URL = 'https://www.blast.fun/'

export const blast_url = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Blast sale link is missing')
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    !['blast.fun', 'www.blast.fun'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error('Blast sale link must belong to blast.fun over HTTPS')
  return url.href
}

export const blast_config = (pins: Pins): BlastConfig | null => {
  if (pins.blast_presale === undefined || pins.blast_presale === null) return null
  const value = pins.blast_presale as Partial<BlastConfig>
  if (
    !value ||
    typeof value.id !== 'string' ||
    !isValidSuiObjectId(value.id) ||
    typeof value.package_original !== 'string' ||
    !isValidSuiObjectId(value.package_original)
  )
    throw new Error('Blast presale identity is malformed')
  return {
    id: normalizeSuiObjectId(value.id),
    package_original: normalizeSuiObjectId(value.package_original),
    url: blast_url(value.url),
    coin_type: kares_coin_type(pins.kares_coin_type),
  }
}

export type BlastPresale = Readonly<{
  lifecycle: BlastLifecycle
  total_commitments: bigint
  raise_target: bigint
  end_ms: bigint
}>
export const project_blast_presale = (sale: BlastPresale, clock_ms: bigint, version: string): BlastSnapshot => {
  if (sale.raise_target <= 0n) throw new Error('Blast presale has no funding target')
  const phases = {
    Pending: 'soon',
    Open: clock_ms >= sale.end_ms ? 'closing' : 'live',
    Funded: 'funded',
    Migrated: 'complete',
    Cancelled: 'cancelled',
  } as const
  const raised = sale.total_commitments < sale.raise_target ? sale.total_commitments : sale.raise_target
  return {
    version,
    clock_ms,
    phase: phases[sale.lifecycle],
    committed: sale.total_commitments,
    target: sale.raise_target,
    progress_bps: Number((raised * 10_000n) / sale.raise_target),
  }
}

/** Sui decodes the Move layout. Only presentation fields cross this read boundary. */
export const decode_blast_presale = (json: Readonly<Record<string, unknown>>): BlastPresale => {
  const { lifecycle } = json
  const variant = lifecycle && typeof lifecycle === 'object' ? Reflect.get(lifecycle, '@variant') : null
  if (!LIFECYCLES.some((value) => value === variant)) throw new Error('Unknown Blast presale lifecycle')
  return {
    lifecycle: variant as BlastLifecycle,
    total_commitments: u64(json.total_commitments),
    raise_target: u64(json.raise_target),
    end_ms: u64(json.end_ms),
  }
}

const canonical_json = (
  object: SuiClientTypes.Object<{ json: true }> | Error | undefined,
  id: string,
  type: string
) => {
  if (!object || object instanceof Error) throw new Error('Blast presale read is unavailable')
  if (
    object.objectId !== id ||
    object.owner.$kind !== 'Shared' ||
    normalizeStructTag(object.type) !== normalizeStructTag(type) ||
    !object.json
  )
    throw new Error('Unexpected Blast presale or clock object')
  return { json: object.json, version: object.version }
}

/** A wallet-free read of one pinned SUI presale. It cannot create, start, settle, or fund a sale. */
export const create_blast_reader = (
  options: Readonly<{ network: DeploymentNetwork; rpc_url?: string; pins?: Pins }>,
  transport?: SuiGrpcClient
) => {
  const config = blast_config(resolve_pins(options.network, options.pins))
  const client =
    transport ??
    new SuiGrpcClient({
      network: options.network,
      baseUrl: options.rpc_url ?? `https://fullnode.${options.network}.sui.io:443`,
    })
  if (client.network !== options.network) throw new Error('Blast reader belongs to another network')
  return {
    url: config?.url ?? BLAST_URL,
    configured: config !== null,
    read: async (): Promise<BlastSnapshot | null> => {
      if (!config) return null
      const { objects } = await client.core.getObjects({
        objectIds: [config.id, normalizeSuiObjectId('0x6')],
        include: { json: true },
      })
      const type = `${config.package_original}::blast_presale::Presale<${config.coin_type},${SUI_TYPE_ARG}>`
      const sale = canonical_json(objects[0], config.id, type)
      const clock = canonical_json(objects[1], normalizeSuiObjectId('0x6'), '0x2::clock::Clock')
      return project_blast_presale(decode_blast_presale(sale.json), u64(clock.json.timestamp_ms), sale.version)
    },
  }
}
