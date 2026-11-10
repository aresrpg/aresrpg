// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  hosted_challenge_message,
  type HostedChallengeInput,
  type HostedConnectRequest,
  type HostedChallengeEnvelope,
} from '@aresrpg/protocol'

import type { ControlStore, ControlTransaction } from './store.ts'
import {
  public_bot,
  type Account,
  type AuthorizationRequest,
  type Bot,
  type BotConfig,
  type Grant,
  type OAuthClient,
  type OwnerChallenge,
} from './model.ts'
import { hash_secret, random_secret, secret_matches } from './security.ts'
import { validate_owner, type OwnerVerifier } from './owner_proof.ts'

const require_session = (
  request: AuthorizationRequest | null,
  session: string,
  now: number,
  generation: string
): AuthorizationRequest => {
  if (
    !request ||
    request.authority_generation !== generation ||
    request.consumed ||
    request.expires_at <= now ||
    !secret_matches(session, request.session_hash)
  )
    throw new Error('invalid_session')
  return request
}
const require_owner = (request: AuthorizationRequest): string => {
  if (!request.owner) throw new Error('owner_authentication_required')
  return request.owner
}
const owned_bot = (bot: Bot | null, request: AuthorizationRequest): Bot => {
  if (
    !bot ||
    bot.owner !== require_owner(request) ||
    bot.zklogin_public_identifier !== request.zklogin_public_identifier
  )
    throw new Error('bot_not_owned')
  return bot
}
const validate_consent = (bot: Bot, request: AuthorizationRequest, consent: NonNullable<OwnerChallenge['consent']>) => {
  if (Object.hasOwn(consent, 'budget_mist')) throw new Error('invalid_consent')
  if (
    ![
      bot.status === 'ready',
      bot.generation === consent.generation,
      bot.address === consent.address,
      bot.multisig_public_key === consent.multisig_public_key,
    ].every(Boolean) ||
    bot.policy.revision !== consent.policy_revision ||
    !request.scopes.every((scope) => bot.policy.scopes.includes(scope))
  )
    throw new Error('invalid_consent')
}

export const create_connect_service = (
  store: ControlStore,
  config: BotConfig,
  verify_owner: OwnerVerifier,
  now = Date.now
) => {
  const session_request = async (id: string, session: string) =>
    require_session(
      await store.read<AuthorizationRequest>(`request:${id}`),
      session,
      now(),
      config.authority_generation
    )
  const details = async (id: string, session: string): Promise<HostedConnectRequest> => {
    const request = await session_request(id, session)
    const client = await store.read<OAuthClient>(`client:${request.client_id}`)
    return {
      authorization_id: id,
      client_id: request.client_id,
      client_name: client?.name ?? 'AresRPG',
      redirect_uri: request.redirect_uri,
      scopes: request.scopes,
      resource: config.resource,
      network: config.network,
    }
  }
  const list_bots = async (id: string, session: string) => {
    const request = await session_request(id, session)
    const owner = require_owner(request)
    const account = await store.read<Account>(`account:${owner}`)
    const bots = await Promise.all((account?.bot_ids ?? []).map((bot_id) => store.read<Bot>(`bot:${bot_id}`)))
    return { owner, bots: bots.filter((bot): bot is Bot => !!bot && bot.owner === owner).map(public_bot) }
  }
  const challenge = async (input: HostedChallengeInput, existing_session: string) => {
    validate_owner(input.owner, input.zklogin_public_identifier)
    if (input.purpose !== 'session' && input.purpose !== 'consent') throw new Error('invalid_request')
    const session = input.authorization_id ? existing_session : random_secret()
    const id = input.authorization_id ?? random_secret()
    const challenge_id = random_secret()
    const keys = [`request:${id}`, `challenge:${challenge_id}`]
    if (input.bot_id) keys.push(`bot:${input.bot_id}`)
    const result = await store.transaction(keys, async (tx) => {
      const request = input.authorization_id
        ? require_session(
            await tx.get<AuthorizationRequest>(`request:${id}`),
            session,
            now(),
            config.authority_generation
          )
        : standalone_request(id, session, config, now())
      const consent = await consent_for(tx, input, request)
      const expires_at = Math.min(request.expires_at, now() + config.challenge_ttl_ms)
      const data: HostedChallengeEnvelope = {
        purpose: input.purpose,
        issuer: config.issuer,
        network: config.network,
        authority_generation: config.authority_generation,
        authorization_id: id,
        session_hash: request.session_hash,
        nonce: challenge_id,
        owner: input.owner,
        zklogin_public_identifier: input.zklogin_public_identifier,
        client_id: request.client_id,
        redirect_uri: request.redirect_uri,
        resource: request.resource,
        scopes: request.scopes,
        expires_at,
        consent: consent ?? null,
      }
      const message = hosted_challenge_message(data)
      await tx.put(`request:${id}`, request)
      await tx.put(`challenge:${challenge_id}`, {
        id: challenge_id,
        authority_generation: config.authority_generation,
        authorization_id: id,
        owner: input.owner,
        zklogin_public_identifier: input.zklogin_public_identifier,
        purpose: input.purpose,
        message,
        expires_at,
        consumed: false,
        consent,
      } satisfies OwnerChallenge)
      return { authorization_id: id, challenge_id, message, expires_at, session_expires_at: request.expires_at }
    })
    const { session_expires_at, ...challenge_result } = result
    return { result: challenge_result, session, expires_at: session_expires_at }
  }
  const load_proof = async (id: string, signature: string, session: string, purpose: OwnerChallenge['purpose']) => {
    const proof = await store.read<OwnerChallenge>(`challenge:${id}`)
    if (
      !proof ||
      proof.authority_generation !== config.authority_generation ||
      proof.consumed ||
      proof.expires_at <= now() ||
      proof.purpose !== purpose
    )
      throw new Error('invalid_challenge')
    await session_request(proof.authorization_id, session)
    await verify_owner(proof, signature)
    return proof
  }
  const verify = async (id: string, signature: string, session: string) => {
    const proof = await load_proof(id, signature, session, 'session')
    const keys = [`request:${proof.authorization_id}`, `challenge:${id}`, `account:${proof.owner}`]
    await store.transaction(keys, async (tx) => {
      const request = await consume_proof(tx, proof, session, now(), config.authority_generation)
      const account = await tx.get<Account>(`account:${proof.owner}`)
      if (account && account.zklogin_public_identifier !== proof.zklogin_public_identifier)
        throw new Error('owner_identity_mismatch')
      await tx.put(
        `account:${proof.owner}`,
        account ??
          ({
            owner: proof.owner,
            zklogin_public_identifier: proof.zklogin_public_identifier,
            bot_ids: [],
          } satisfies Account)
      )
      await tx.put(`request:${request.id}`, {
        ...request,
        owner: proof.owner,
        zklogin_public_identifier: proof.zklogin_public_identifier,
      })
    })
    return list_bots(proof.authorization_id, session)
  }
  const authorize = async (id: string, signature: string, session: string) => {
    if (config.recovery_mode) throw new Error('recovery_mode')
    const proof = await load_proof(id, signature, session, 'consent')
    if (!proof.consent) throw new Error('invalid_consent')
    const initial_request = await session_request(proof.authorization_id, session)
    const client_key = `client:${initial_request.client_id}`
    const grant_id = random_secret()
    const secret = random_secret()
    const keys = [
      `request:${proof.authorization_id}`,
      `challenge:${id}`,
      `bot:${proof.consent.bot_id}`,
      `grant:${grant_id}`,
      client_key,
    ]
    return store.transaction(keys, async (tx) => {
      const request = await consume_proof(tx, proof, session, now(), config.authority_generation)
      const bot = owned_bot(await tx.get<Bot>(`bot:${proof.consent!.bot_id}`), request)
      validate_consent(bot, request, proof.consent!)
      const client = await tx.get<OAuthClient>(client_key)
      if (!client || (client.expires_at !== undefined && client.expires_at <= now())) throw new Error('invalid_client')
      await tx.put(client_key, { id: client.id, name: client.name, redirect_uris: client.redirect_uris })
      const grant: Grant = {
        id: grant_id,
        authority_generation: config.authority_generation,
        owner: bot.owner,
        client_id: request.client_id,
        bot_id: bot.id,
        network: bot.network,
        address: bot.address,
        descriptor: bot.multisig_public_key,
        generation: bot.generation,
        resource: request.resource,
        scopes: request.scopes,
        policy_revision: bot.policy.revision,

        revoked: false,
        code: {
          hash: hash_secret(secret),
          challenge: request.code_challenge,
          redirect_uri: request.redirect_uri,
          expires_at: now() + config.code_ttl_ms,
          used: false,
        },
        family: null,
        access: null,
      }
      await tx.put(`grant:${grant_id}`, grant)
      await tx.put(`request:${request.id}`, { ...request, consumed: true })
      const redirect = new URL(request.redirect_uri)
      redirect.searchParams.set('code', `${grant_id}.${secret}`)
      redirect.searchParams.set('state', request.state)
      redirect.searchParams.set('iss', config.issuer)
      return { redirect_url: redirect.href }
    })
  }
  const cancel = async (id: string, session: string) =>
    store.transaction([`request:${id}`], async (tx) => {
      const request = await tx.get<AuthorizationRequest>(`request:${id}`)
      if (request && secret_matches(session, request.session_hash))
        await tx.put(`request:${id}`, { ...request, consumed: true })
    })
  const owner_session = async (id: string, session: string) => {
    const request = await session_request(id, session)
    require_owner(request)
    return request as AuthorizationRequest & Required<Pick<AuthorizationRequest, 'owner' | 'zklogin_public_identifier'>>
  }
  return { details, challenge, verify, authorize, cancel, list_bots, owner_session }
}

const standalone_request = (id: string, session: string, config: BotConfig, now: number): AuthorizationRequest => ({
  id,
  authority_generation: config.authority_generation,
  session_hash: hash_secret(session),
  client_id: 'first-party',
  redirect_uri: config.web_origin,
  state: '',
  resource: config.resource,
  scopes: [],
  code_challenge: '',
  expires_at: now + config.request_ttl_ms,
})
const consent_for = async (tx: ControlTransaction, input: HostedChallengeInput, request: AuthorizationRequest) => {
  if (input.purpose === 'session') return undefined
  if (
    request.client_id === 'first-party' ||
    input.owner !== request.owner ||
    input.zklogin_public_identifier !== request.zklogin_public_identifier ||
    !input.bot_id ||
    [input.policy_revision, input.generation, input.address, input.multisig_public_key].some(
      (value) => value === undefined
    )
  )
    throw new Error('invalid_consent')
  const bot = owned_bot(await tx.get<Bot>(`bot:${input.bot_id}`), request)
  const consent = {
    bot_id: bot.id,
    policy_revision: input.policy_revision!,

    generation: input.generation!,
    address: input.address!,
    multisig_public_key: input.multisig_public_key!,
  }
  validate_consent(bot, request, consent)
  return consent
}
const consume_proof = async (
  tx: ControlTransaction,
  proof: OwnerChallenge,
  session: string,
  now: number,
  generation: string
) => {
  const current = await tx.get<OwnerChallenge>(`challenge:${proof.id}`)
  const request = require_session(
    await tx.get<AuthorizationRequest>(`request:${proof.authorization_id}`),
    session,
    now,
    generation
  )
  if (
    !current ||
    current.authority_generation !== generation ||
    current.consumed ||
    current.message !== proof.message ||
    current.expires_at <= now
  )
    throw new Error('invalid_challenge')
  await tx.put(`challenge:${proof.id}`, { ...current, consumed: true })
  return request
}
