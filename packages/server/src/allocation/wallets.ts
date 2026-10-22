// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { parseSerializedSignature } from '@mysten/sui/cryptography'
import type { Redis } from 'ioredis'
import {
  campaign,
  share_version,
  MAX_ALLOCATION_WALLETS,
  normalize_address,
  type AllocationWallet,
} from '@aresrpg/immutable/allocation'

import { verify_wallet_message } from '../auth.ts'

import { key, read_campaign } from './store.ts'
import { random_id } from './x.ts'

const collection = (owner: string): string => key(`verified:${owner}`)
export const verified_wallets = async (redis: Redis, owner: string): Promise<readonly AllocationWallet[]> => {
  // The ordinary socket admission already verified the game-wallet signature.
  await redis.hsetnx(collection(owner), owner, JSON.stringify({ address: owner, label: '' }))
  return Object.values(await redis.hgetall(collection(owner)))
    .map((value) => JSON.parse(value) as AllocationWallet)
    .sort((a, b) => Number(b.address === owner) - Number(a.address === owner) || a.address.localeCompare(b.address))
}
export const require_wallet = async (redis: Redis, owner: string, address: string): Promise<void> => {
  if (!(await redis.hexists(collection(owner), address))) throw new Error('unauthorized')
}
export const wallet_challenge = async (redis: Redis, owner: string, address: string, label: string, origin: string) => {
  const normalized = normalize_address(address)
  const wallets = await verified_wallets(redis, owner)
  if (wallets.length >= MAX_ALLOCATION_WALLETS && !wallets.some((wallet) => wallet.address === normalized))
    throw new Error('wallet_limit')
  const nonce = random_id()
  const message = JSON.stringify({
    domain: origin,
    campaign: campaign.id,
    action: 'verify_wallet',
    owner,
    address: normalized,
    nonce,
  })
  await redis.set(
    key(`wallet_challenge:${nonce}`),
    JSON.stringify({ owner, address: normalized, label, message }),
    'EX',
    300
  )
  return { action: 'wallet_challenge' as const, nonce, message }
}
const ADD_WALLET = `
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 and redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
return 1
`
export const verify_wallet = async (
  redis: Redis,
  owner: string,
  nonce: string,
  signature: string,
  verify = verify_wallet_message
): Promise<void> => {
  if (!/^[a-f0-9]{64}$/.test(nonce)) throw new Error('unauthorized')
  const value = await redis.getdel(key(`wallet_challenge:${nonce}`))
  if (!value) throw new Error('unauthorized')
  const proof = JSON.parse(value) as { owner: string; address: string; label: string; message: string }
  if (proof.owner !== owner || !(await verify(proof.message, signature, proof.address))) throw new Error('unauthorized')
  const wallet: AllocationWallet = {
    address: proof.address,
    label: proof.address === owner ? '' : proof.label,
    game_wallet: parseSerializedSignature(signature).signatureScheme === 'ZkLogin',
  }
  if (
    !(await redis.eval(ADD_WALLET, 1, collection(owner), proof.address, JSON.stringify(wallet), MAX_ALLOCATION_WALLETS))
  )
    throw new Error('wallet_limit')
}
export const remove_wallet = async (redis: Redis, owner: string, address: string): Promise<void> => {
  if (address === owner) throw new Error('invalid_request')
  await redis.hdel(collection(owner), address)
}
/** Only a verified owner can create a deliberately public, address-free card link. */
export const share_wallet = async (redis: Redis, owner: string, address: string, origin: string): Promise<string> => {
  await require_wallet(redis, owner, address)
  const share_key = key(`share_owner:${owner}:${address}`)
  const candidate = random_id()
  await redis.set(share_key, candidate, 'NX')
  const token = (await redis.get(share_key))!
  await redis.set(key(`share:${token}`), address)
  const current = await read_campaign(redis)
  const version = share_version(
    current.phase,
    current.awards.find((award) => award.address === address)
  )
  return `${origin}/api/allocation?action=preview&token=${token}&v=${version}`
}
export const shared_address = async (redis: Redis, token: string | null): Promise<string> => {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error('unauthorized')
  const address = await redis.get(key(`share:${token}`))
  if (!address) throw new Error('unauthorized')
  return address
}
