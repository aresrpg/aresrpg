// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
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
export type BotConsent = Readonly<{
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
export const assert_live_grant = (config: BotConfig, grant: Grant, bot: Bot | null, now = Date.now()) => {
  // Obsolete bounded consent must never silently gain the new authority semantics.
  if (
    [
      Object.hasOwn(grant, 'budget_mist'),
      config.recovery_mode,
      grant.revoked,
      grant.authority_generation !== config.authority_generation,
    ].some(Boolean)
  )
    throw new Error('invalid_token')
  if (grant.family && grant.family.expires_at <= now) throw new Error('invalid_token')
  if (!bot) throw new Error('invalid_token')
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
