// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { parse_agent_pairing_request } from '@aresrpg/sdk/agent-pairing'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'
import { ZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

import type { ControlTransaction } from './store.ts'

export type BotPolicy = Readonly<{ revision: number; scopes: readonly string[] }>
export type Bot = Readonly<{
  id: string
  owner: string
  zklogin_public_identifier: string
  network: 'mainnet'
  address: string
  multisig_public_key: string
  key_id: string
  generation: number
  status: 'ready' | 'paused' | 'returning'
  policy: BotPolicy
}>
export type Account = Readonly<{
  owner: string
  zklogin_public_identifier: string
  bot_ids: readonly string[]
  grant_ids?: readonly string[]
  grants_indexed?: boolean
}>
export type OAuthClient = Readonly<{ id: string; name: string; redirect_uris: readonly string[]; expires_at?: number }>
export type AuthorizationRequest = Readonly<{
  id: string
  authority_generation: string
  session_hash: string
  client_id: string
  redirect_uri: string
  state: string
  resource: string
  scopes: readonly string[]
  code_challenge: string
  expires_at: number
  owner?: string
  zklogin_public_identifier?: string
  consumed?: boolean
}>
type BotConsent = Readonly<{
  bot_id: string
  policy_revision: number

  generation: number
  address: string
  multisig_public_key: string
}>
export type OwnerChallenge = Readonly<{
  id: string
  authority_generation: string
  authorization_id: string
  owner: string
  zklogin_public_identifier: string
  purpose: 'session' | 'consent'
  message: string
  expires_at: number
  consumed: boolean
  consent?: BotConsent
}>
export type Grant = Readonly<{
  id: string
  authority_generation: string
  owner: string
  client_id: string
  bot_id: string
  network: 'mainnet'
  address: string
  descriptor: string
  generation: number
  resource: string
  scopes: readonly string[]
  policy_revision: number

  revoked: boolean
  code: Readonly<{ hash: string; challenge: string; redirect_uri: string; expires_at: number; used: boolean }>
  family: Readonly<{ generation: number; hash: string; expires_at: number; used_hashes: readonly string[] }> | null
  access: Readonly<{ hash: string; expires_at: number }> | null
}>
export type BotConfig = Readonly<{
  issuer: string
  resource: string
  web_origin: string
  network: 'mainnet'
  authority_generation: string
  observation_freshness_ms: number
  refusal_retry_ms: number
  request_ttl_ms: number
  challenge_ttl_ms: number
  code_ttl_ms: number
  access_ttl_ms: number
  refresh_ttl_ms: number
  max_body_bytes: number
  max_redirect_uris: number
  scopes: readonly string[]
  recovery_mode: boolean
}>
export const public_bot = (bot: Bot) => ({
  id: bot.id,
  address: bot.address,
  multisig_public_key: bot.multisig_public_key,
  generation: bot.generation,
  policy_revision: bot.policy.revision,
  status: bot.status,
})
/** A fault of the grant itself. Obsolete bounded consent must never silently gain the new authority semantics. */
const grant_fault = (config: BotConfig, grant: Grant, now: number) =>
  [
    Object.hasOwn(grant, 'budget_mist'),
    grant.revoked,
    grant.authority_generation !== config.authority_generation,
    grant.family && grant.family.expires_at <= now,
  ].some(Boolean)
export const assert_live_grant = (config: BotConfig, grant: Grant, bot: Bot | null, now = Date.now()) => {
  // Recovery is a temporary state of the whole service and says nothing about this grant: a client
  // keeps its grant and retries later. Only a fault of the grant itself asks for a new consent.
  if (config.recovery_mode) throw new Error('service_unavailable')
  if (grant_fault(config, grant, now) || !bot) throw new Error('invalid_token')
  const live = [
    bot.id,
    bot.status,
    bot.owner,
    bot.network,
    bot.address,
    bot.multisig_public_key,
    bot.generation,
    bot.policy.revision,
    config.resource,
    config.network,
  ]
  const pinned = [
    grant.bot_id,
    'ready',
    grant.owner,
    grant.network,
    grant.address,
    grant.descriptor,
    grant.generation,
    grant.policy_revision,
    grant.resource,
    grant.network,
  ]
  if (
    !live.every((value, index) => value === pinned[index]) ||
    !grant.scopes.every((scope) => bot.policy.scopes.includes(scope))
  )
    throw new Error('invalid_token')
}
/** The scope each control operation needs. MCP tools, the cross-process route and the operations
 * themselves read it here. */
export const CONTROL_SCOPES = {
  observe: 'bot:observe',
  accept: 'bot:play',
  status: 'bot:observe',
  pause: 'bot:pause',
  resume: 'bot:pause',
  validate_behavior: 'bot:observe',
  behavior_status: 'bot:observe',
  start_behavior: 'bot:play',
  replace_behavior: 'bot:play',
  stop_behavior: 'bot:pause',
  validate_combat_profile: 'bot:observe',
} as const
export type ControlMethod = keyof typeof CONTROL_SCOPES
export type Scope = (typeof CONTROL_SCOPES)[ControlMethod]
export const control_method = (value: unknown): value is ControlMethod =>
  typeof value === 'string' && Object.hasOwn(CONTROL_SCOPES, value)
/** The grant as stored now, live under its bot and holding the scope; a null scope asks liveness
 * only. An operation passes its transaction reader, so the check commits with its write. */
export const authorize = async (
  read: ControlTransaction['get'],
  config: BotConfig,
  grant: Pick<Grant, 'id' | 'bot_id' | 'address'>,
  scope: Scope | null,
  now: number
) => {
  const current = await read<Grant>(`grant:${grant.id}`)
  if (!current || current.bot_id !== grant.bot_id || current.address !== grant.address) throw new Error('invalid_token')
  const bot = await read<Bot>(`bot:${grant.bot_id}`)
  assert_live_grant(config, current, bot, now)
  if (scope && !current.scopes.includes(scope)) throw new Error('insufficient_scope')
  return Object.freeze({ grant: current, bot: bot! })
}
/** A grant that died or lacks the scope is a fact its caller reports; any other fault is raised. */
export const authority_fault = (error: unknown) => {
  if (error instanceof Error && ['invalid_token', 'insufficient_scope'].includes(error.message)) return error.message
  throw error
}

export const random_secret = () => randomBytes(32).toString('base64url')
export const hash_secret = (value: string) => createHash('sha256').update(value).digest('base64url')
export const secret_matches = (value: string, expected: string) => {
  const actual = Buffer.from(hash_secret(value))
  const target = Buffer.from(expected)
  return actual.length === target.length && timingSafeEqual(actual, target)
}
export const opaque_parts = (token: string): readonly [string, string] => {
  const parts = token.split('.')
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]{43}$/.test(part))) throw new Error('invalid_token')
  return [parts[0]!, parts[1]!]
}
export const require_string = (value: unknown): string => {
  if (typeof value !== 'string' || !value) throw new Error('invalid_request')
  return value
}

export type OwnerVerifier = (challenge: OwnerChallenge, signature: string) => Promise<void>
/** A hosted bot's owner is one canonical Google zkLogin identity on mainnet. */
export const google_owner = (owner: string, identifier: string) => {
  parse_agent_pairing_request({
    version: 1,
    nonce: '00000000-0000-4000-8000-000000000000',
    network: 'mainnet',
    owner,
    zklogin_public_identifier: identifier,
  })
  const google = ZkLoginPublicIdentifier.fromBytes(fromBase64(identifier), { address: owner })
  if (google.toSuiAddress() !== owner) throw new Error('CANONICAL_GOOGLE_OWNER_REQUIRED')
  return google
}
export const create_owner_verifier =
  (client: NonNullable<Parameters<typeof verifyPersonalMessageSignature>[2]>['client']): OwnerVerifier =>
  async (challenge, signature) => {
    google_owner(challenge.owner, challenge.zklogin_public_identifier)
    if (fromBase64(signature)[0] !== 5) throw new Error('google_login_required')
    const key = await verifyPersonalMessageSignature(new TextEncoder().encode(challenge.message), signature, {
      client,
      address: challenge.owner,
    })
    if (key.flag() !== 5 || toBase64(key.toRawBytes()) !== challenge.zklogin_public_identifier)
      throw new Error('owner_identity_mismatch')
  }
