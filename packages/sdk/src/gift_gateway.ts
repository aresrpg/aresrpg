// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { Signer } from '@mysten/sui/cryptography'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { SuiGraphQLClient } from '@mysten/sui/graphql'
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'
import { toBase64 } from '@mysten/sui/utils'

import { SDK, sui_transport } from './client.ts'
import { build_gift_transaction, create_gift_reader } from './gift_sponsor.ts'
import { build_gift_transport } from './gift_transport.ts'
import {
  GiftError,
  decode_gift_request,
  gift_request_message,
  GIFT_AUTH_LIFETIME_MS,
  GIFT_GAS_LIMIT_MIST,
  type GiftRequest,
  type SponsoredGift,
} from './gift_contract.ts'
import type { GiftPolicy } from './gift_provenance.ts'
import { bounded_request } from './transaction_execution.ts'
import { read_sponsored_transaction } from './sponsored_execution.ts'

export type GiftGatewayOptions = Readonly<{
  policy: GiftPolicy
  private_key?: string
  rpc_url?: string
  graphql_url?: string
  signer?: Pick<Signer, 'toSuiAddress' | 'signTransaction'>
  now?: () => number
  client?: SuiGrpcClient
  graphql?: SuiGraphQLClient
}>
const MAX_REQUEST_BYTES = 24_000

const response = (body: object, status = 200): Response =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', allow: 'POST' },
  })

const bounded_json = async (
  body: ReadableStream<Uint8Array> | null,
  limit: number
): Promise<Record<string, unknown>> => {
  if (!body) throw new GiftError('invalid')
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new GiftError('invalid')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GiftError('invalid')
  return value as Record<string, unknown>
}

const sponsor = (options: GiftGatewayOptions): Pick<Signer, 'toSuiAddress' | 'signTransaction'> => {
  if (options.signer) return options.signer
  if (!options.private_key) throw new GiftError('sponsor_unavailable')
  return Ed25519Keypair.fromSecretKey(options.private_key)
}

const valid_signature = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 16_000

const authorize = async (
  options: GiftGatewayOptions,
  client: SuiGrpcClient,
  body: Readonly<Record<string, unknown>>
): Promise<GiftRequest> => {
  if (Object.keys(body).some((key) => !['request', 'signature'].includes(key))) throw new GiftError('invalid')
  const request = decode_gift_request(body.request)
  if (
    request.network !== options.policy.pins.network ||
    Math.abs((options.now ?? Date.now)() - request.time) > GIFT_AUTH_LIFETIME_MS
  )
    throw new GiftError('unauthorized')
  // Status exposes public chain state and cannot allocate sponsored gas.
  if (request.action === 'status') return request
  if (!valid_signature(body.signature)) throw new GiftError('invalid')
  try {
    const key = await verifyPersonalMessageSignature(gift_request_message(request), body.signature, { client })
    if (!key.verifyAddress(request.address)) throw new GiftError('unauthorized')
  } catch {
    throw new GiftError('unauthorized')
  }
  return request
}

const prepare = async (options: GiftGatewayOptions, client: SuiGrpcClient, request: GiftRequest): Promise<Response> => {
  const graphql =
    options.graphql ??
    new SuiGraphQLClient({
      network: request.network,
      url: options.graphql_url ?? `https://graphql.${request.network}.sui.io/graphql`,
    })
  const status = await create_gift_reader(client, graphql, options.policy, request.address)(request.proof)
  if (request.action === 'status') return response(status)
  const sdk = SDK({
    client: sui_transport(client),
    network: request.network,
    address: request.address,
    pins: options.policy.pins,
  })
  const { tx, kind } =
    request.action === 'transfer'
      ? await build_gift_transport(client, options.policy, request.address, request.sender!, status)
      : await build_gift_transaction(sdk, options.policy, request.address, request.action, status)
  const signer = sponsor(options)
  const funded = Transaction.fromKind(kind)
  funded.setSender(tx.getData().sender!)
  funded.setGasOwner(signer.toSuiAddress())
  funded.setGasBudget(GIFT_GAS_LIMIT_MIST)
  let raw: Uint8Array
  try {
    raw = await bounded_request(() => funded.build({ client }), 15_000)
  } catch (error) {
    console.warn(
      'Gift sponsor could not fund the transaction.',
      error instanceof Error ? error.message : 'Unknown error'
    )
    throw new GiftError('sponsor_unavailable')
  }
  const prepared = { bytes: toBase64(raw), digest: TransactionDataBuilder.getDigestFromBytes(raw) }
  const { transaction: resolved } = read_sponsored_transaction(prepared, tx.getData().sender!, request.address)
  const returned_kind = await resolved.build({ onlyTransactionKind: true })
  if (toBase64(returned_kind) !== toBase64(kind)) throw new GiftError('sponsor_unavailable')
  const simulation = await client.core.simulateTransaction({ transaction: raw, include: { effects: true } })
  if (!simulation.Transaction?.effects.status.success) throw new GiftError('ineligible')
  const { signature: sponsor_signature } = await signer.signTransaction(raw)
  return response({ ...prepared, sponsor_signature, status } satisfies SponsoredGift)
}

export const create_gift_gateway =
  (options: GiftGatewayOptions) =>
  async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return response({ error: 'invalid' }, 405)
    if (request.headers.get('origin') !== new URL(request.url).origin) return response({ error: 'unauthorized' }, 403)
    try {
      const body = await bounded_json(request.body, MAX_REQUEST_BYTES)
      const { network } = options.policy.pins
      if (network !== 'mainnet' && network !== 'testnet') throw new GiftError('unavailable')
      const client =
        options.client ??
        new SuiGrpcClient({ network, baseUrl: options.rpc_url ?? `https://fullnode.${network}.sui.io:443` })
      const intent = await authorize(options, client, body)
      return await prepare(options, client, intent)
    } catch (error) {
      const code = error instanceof GiftError ? error.code : error instanceof SyntaxError ? 'invalid' : 'unavailable'
      console.warn('Gift request refused.', { code })
      const status = { invalid: 400, ineligible: 403, unauthorized: 401, unavailable: 503, sponsor_unavailable: 503 }[
        code
      ]
      return response({ error: code }, status)
    }
  }
