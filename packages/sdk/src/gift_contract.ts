// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { isValidSuiAddress, isValidTransactionDigest } from '@mysten/sui/utils'

export const GIFT_API_PATH = '/api/gift'
export const GIFT_AUTH_LIFETIME_MS = 5 * 60_000
export const GIFT_GAS_LIMIT_MIST = 100_000_000n
export const GIFT_ACTIONS = ['redeem', 'open', 'collect'] as const
export type GiftAction = (typeof GIFT_ACTIONS)[number]
export type GiftProof = Readonly<{ giftcard: string; redeem?: string; open?: string; collect?: string }>
export type GiftRequest = Readonly<{
  action: GiftAction | 'status' | 'transfer'
  network: 'mainnet' | 'testnet'
  address: string
  time: number
  proof: GiftProof | null
  sender?: string
}>
export type GiftStatus = Readonly<{
  stage: 'missing' | 'available' | 'voucher' | 'crate' | 'reward' | 'collected'
  proof: GiftProof | null
  kiosk?: string
  crate?: string
  claim?: string
  reward_template?: string
  amount?: number
  item?: string
}>
export type SponsoredGift = Readonly<{ bytes: string; digest: string; sponsor_signature: string; status: GiftStatus }>
export type GiftErrorCode = 'invalid' | 'ineligible' | 'unavailable' | 'unauthorized' | 'sponsor_unavailable'

export class GiftError extends Error {
  readonly code: GiftErrorCode
  constructor(code: GiftErrorCode, options?: ErrorOptions) {
    super(`Gift ${code}`, options)
    // eslint-disable-next-line functional/no-this-expressions -- Error subclasses retain their typed failure code.
    this.code = code
  }
}

const is_record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const exact_keys = (value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key))

const valid_address = (value: unknown): value is string => typeof value === 'string' && isValidSuiAddress(value)

const valid_digest = (value: unknown): value is string => typeof value === 'string' && isValidTransactionDigest(value)

export const decode_gift_proof = (value: unknown): GiftProof => {
  if (!is_record(value) || !exact_keys(value, ['giftcard', ...GIFT_ACTIONS]) || !valid_address(value.giftcard))
    throw new GiftError('invalid')
  for (const action of GIFT_ACTIONS)
    if (value[action] !== undefined && !valid_digest(value[action])) throw new GiftError('invalid')
  if ((value.open && !value.redeem) || (value.collect && !value.open)) throw new GiftError('invalid')
  return value as GiftProof
}

export const decode_gift_request = (value: unknown): GiftRequest => {
  if (!is_record(value) || !exact_keys(value, ['action', 'network', 'address', 'time', 'proof', 'sender']))
    throw new GiftError('invalid')
  const valid = [
    ['status', 'transfer', ...GIFT_ACTIONS].includes(value.action as string),
    ['mainnet', 'testnet'].includes(value.network as string),
    valid_address(value.address),
    Number.isSafeInteger(value.time),
    value.action === 'transfer' ? valid_address(value.sender) : value.sender === undefined,
  ].every(Boolean)
  if (!valid) throw new GiftError('invalid')
  const proof = value.proof === null ? null : decode_gift_proof(value.proof)
  if (value.action !== 'status' && !proof) throw new GiftError('invalid')
  return { ...(value as GiftRequest), proof }
}

/** Canonical bytes bind the complete intent; caller-supplied message bytes are never accepted. */
export const gift_request_message = (request: GiftRequest): Uint8Array =>
  new TextEncoder().encode(
    `aresrpg::gift:v1:${JSON.stringify({
      action: request.action,
      network: request.network,
      address: request.address,
      time: request.time,
      ...(request.sender ? { sender: request.sender } : {}),
      proof: request.proof
        ? {
            giftcard: request.proof.giftcard,
            redeem: request.proof.redeem,
            open: request.proof.open,
            collect: request.proof.collect,
          }
        : null,
    })}`
  )

export const decode_gift_status = (value: unknown): GiftStatus => {
  if (
    !is_record(value) ||
    !['missing', 'available', 'voucher', 'crate', 'reward', 'collected'].includes(value.stage as string)
  )
    throw new GiftError('invalid')
  const proof = value.proof === null ? null : decode_gift_proof(value.proof)
  if (value.stage !== 'missing' && !proof) throw new GiftError('invalid')
  for (const key of ['kiosk', 'crate', 'claim', 'reward_template', 'item'])
    if (value[key] !== undefined && !valid_address(value[key])) throw new GiftError('invalid')
  if (value.amount !== undefined && value.amount !== 1) throw new GiftError('invalid')
  return { ...(value as GiftStatus), proof }
}
