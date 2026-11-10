// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ControlStore } from './store.ts'
import {
  assert_live_grant,
  type AuthorizationRequest,
  type Bot,
  type BotConfig,
  type Grant,
  type OAuthClient,
} from './model.ts'
import { index_owner_grant } from './owner_status.ts'
import { hash_secret, opaque_parts, random_secret, require_string, secret_matches } from './security.ts'

const valid_redirect = (value: unknown): boolean => {
  if (typeof value !== 'string') return false
  const url = URL.parse(value)
  return !!url && [url.protocol === 'https:', !url.username, !url.password, !url.hash].every(Boolean)
}
const validate_exchange = (
  grant: Grant,
  secret: string,
  input: Readonly<Record<string, unknown>>,
  refreshing: boolean,
  now: number
) => {
  if (refreshing) {
    if (!grant.family) throw new Error('invalid_grant')
    if (!secret_matches(secret, grant.family.hash) || grant.family.expires_at <= now) throw new Error('invalid_grant')
    return
  }
  const verifier = require_string(input.code_verifier)
  const valid = [
    /^[A-Za-z0-9._~-]{43,128}$/.test(verifier),
    !grant.code.used,
    grant.code.expires_at > now,
    secret_matches(secret, grant.code.hash),
    hash_secret(verifier) === grant.code.challenge,
    input.redirect_uri === grant.code.redirect_uri,
  ].every(Boolean)
  if (!valid) throw new Error('invalid_grant')
}
const rotated_grant = (grant: Grant, config: BotConfig, access: string, refresh: string, now: number): Grant => {
  const { family } = grant
  return {
    ...grant,
    code: { ...grant.code, used: true },
    access: { hash: hash_secret(access), expires_at: now + config.access_ttl_ms },
    family: {
      generation: (family?.generation ?? 0) + 1,
      hash: hash_secret(refresh),
      expires_at: family?.expires_at ?? now + config.refresh_ttl_ms,
      used_hashes: family ? [...family.used_hashes, family.hash] : [],
    },
  }
}
export const create_oauth_service = (store: ControlStore, config: BotConfig, now = Date.now) => {
  const register = async (input: Readonly<Record<string, unknown>>) => {
    const uris = input.redirect_uris
    if (input.token_endpoint_auth_method !== 'none' || !Array.isArray(uris)) throw new Error('invalid_client_metadata')
    if (!uris.length || uris.length > config.max_redirect_uris || !uris.every(valid_redirect))
      throw new Error('invalid_client_metadata')
    const client: OAuthClient = {
      id: random_secret(),
      expires_at: now() + config.request_ttl_ms,
      name: require_string(input.client_name),
      redirect_uris: [...new Set(uris as string[])],
    }
    await store.transaction([`client:${client.id}`], (tx) => tx.put(`client:${client.id}`, client))
    return {
      client_id: client.id,
      client_name: client.name,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }
  }
  const begin = async (query: URLSearchParams) => {
    const client = await store.read<OAuthClient>(`client:${require_string(query.get('client_id'))}`)
    const redirect_uri = require_string(query.get('redirect_uri'))
    if (
      !client ||
      (client.expires_at !== undefined && client.expires_at <= now()) ||
      !client.redirect_uris.includes(redirect_uri)
    )
      throw new Error('invalid_redirect_uri')
    const scopes = [...new Set(require_string(query.get('scope')).split(' '))]
    const valid = [
      query.get('response_type') === 'code',
      query.get('code_challenge_method') === 'S256',
      /^[A-Za-z0-9_-]{43}$/.test(query.get('code_challenge') ?? ''),
      query.get('resource') === config.resource,
      scopes.every((scope) => config.scopes.includes(scope)),
    ].every(Boolean)
    if (!valid) throw new Error('invalid_request')
    const session = random_secret()
    const request: AuthorizationRequest = {
      id: random_secret(),
      authority_generation: config.authority_generation,
      session_hash: hash_secret(session),
      client_id: client.id,
      redirect_uri,
      state: require_string(query.get('state')),
      resource: config.resource,
      scopes,
      code_challenge: query.get('code_challenge')!,
      expires_at: now() + config.request_ttl_ms,
    }
    await store.transaction([`request:${request.id}`], (tx) => tx.put(`request:${request.id}`, request))
    const location = new URL('/world', config.web_origin)
    location.searchParams.set('intent', 'connect-agent')
    location.searchParams.set('authorization_id', request.id)
    return { location: location.href, session, authorization_id: request.id, expires_at: request.expires_at }
  }
  const authenticate = async (token: string): Promise<Grant> => {
    const [id, secret] = opaque_parts(token)
    const grant = await store.read<Grant>(`grant:${id}`)
    if (!grant?.access || !secret_matches(secret, grant.access.hash) || grant.access.expires_at <= now())
      throw new Error('invalid_token')
    assert_live_grant(config, grant, await store.read<Bot>(`bot:${grant.bot_id}`), now())
    return grant
  }
  const exchange = async (input: Readonly<Record<string, unknown>>) => {
    const refreshing = input.grant_type === 'refresh_token'
    if (!refreshing && input.grant_type !== 'authorization_code') throw new Error('unsupported_grant_type')
    const [id, secret] = opaque_parts(require_string(refreshing ? input.refresh_token : input.code))
    const initial = await store.read<Grant>(`grant:${id}`)
    if (!initial) throw new Error('invalid_grant')
    const result = await store.transaction(
      [`grant:${id}`, `bot:${initial.bot_id}`, `account:${initial.owner}`],
      async (tx) => {
        const grant = await tx.get<Grant>(`grant:${id}`)
        if (!grant) throw new Error('invalid_grant')
        if (grant.client_id !== input.client_id || input.resource !== grant.resource) throw new Error('invalid_grant')
        assert_live_grant(config, grant, await tx.get<Bot>(`bot:${grant.bot_id}`), now())
        if (refreshing && grant.family?.used_hashes.includes(hash_secret(secret))) {
          await tx.put(`grant:${id}`, { ...grant, revoked: true, access: null, family: null })
          return null
        }
        validate_exchange(grant, secret, input, refreshing, now())
        const access = random_secret()
        const refresh = random_secret()
        await tx.put(`grant:${id}`, rotated_grant(grant, config, access, refresh, now()))
        await index_owner_grant(tx, grant)
        return {
          access_token: `${id}.${access}`,
          token_type: 'Bearer',
          expires_in: Math.floor(config.access_ttl_ms / 1000),
          refresh_token: `${id}.${refresh}`,
          scope: grant.scopes.join(' '),
        }
      }
    )
    if (!result) throw new Error('invalid_grant')
    return result
  }
  const revoke = async (input: Readonly<Record<string, unknown>>) => {
    const [id, secret] = opaque_parts(require_string(input.token))
    await store.transaction([`grant:${id}`], async (tx) => {
      const grant = await tx.get<Grant>(`grant:${id}`)
      if (!grant || grant.client_id !== input.client_id) return
      const hashes = [grant.access?.hash, grant.family?.hash, ...(grant.family?.used_hashes ?? [])]
      if (hashes.some((hash) => hash && secret_matches(secret, hash)))
        await tx.put(`grant:${id}`, { ...grant, revoked: true, access: null, family: null })
    })
  }
  return { register, begin, authenticate, exchange, revoke }
}
