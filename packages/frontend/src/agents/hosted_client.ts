// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type {
  HostedAuthorizeResponse,
  HostedBotDescriptor,
  HostedChallengeInput,
  HostedChallengeResponse,
  HostedConnectRequest,
  HostedProvisionResponse,
  HostedVerifyResponse,
} from '@aresrpg/protocol'
import { verify_agent_pairing, type AgentPairingResponse } from '@aresrpg/sdk/agent-pairing'

import type { AuthSession } from '../auth.ts'
import { browser_auth_storage } from '../auth_storage.ts'
import { read_app_state, dispatch_app } from '../store.ts'

import { sign_hosted_message } from './hosted_challenge.ts'
import { complete_agent_pairing } from './pairing_storage.ts'

export type HostedClient = ReturnType<typeof create_hosted_client>
export const create_hosted_client = (origin: string, signal: Readonly<AbortSignal>, fetcher: typeof fetch = fetch) => {
  const request = async <T>(path: string, body?: Readonly<unknown>): Promise<T> => {
    signal.throwIfAborted()
    const response = await fetcher(new URL(path, origin), {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    signal.throwIfAborted()
    if (!response.ok) throw new Error(`Hosted service request failed (${response.status})`)
    return response.json() as Promise<T>
  }
  return { request, signal, origin }
}
export const current_wallet = (wallet: AuthSession, signal: Readonly<AbortSignal>): void => {
  signal.throwIfAborted()
  if (read_app_state().session.wallet !== wallet) throw new Error('Wallet changed')
}
export const sign_hosted_challenge = async (
  client: Readonly<HostedClient>,
  wallet: AuthSession,
  input: HostedChallengeInput,
  retain: (id: string) => void,
  consent: HostedConnectRequest | null
) => {
  current_wallet(wallet, client.signal)
  const challenge = await client.request<HostedChallengeResponse>('/connect/challenge', input)
  current_wallet(wallet, client.signal)
  const { signature } = await sign_hosted_message(
    challenge,
    { input, consent, issuer: client.origin, web_origin: window.location.origin },
    (bytes) => {
      retain(challenge.authorization_id)
      return wallet.sign_personal_message(bytes)
    }
  )
  current_wallet(wallet, client.signal)
  return { challenge_id: challenge.challenge_id, signature, authorization_id: challenge.authorization_id }
}
const pairing_request = (wallet: AuthSession) => {
  const request = wallet.read_agent_pairing_request?.(crypto.randomUUID())
  if (wallet.identity !== 'zklogin' || !request) throw new Error('Google wallet required')
  return request
}
export const authenticate_hosted = async (
  client: Readonly<HostedClient>,
  wallet: AuthSession,
  authorization_id: string | null,
  retain: (id: string) => void
) => {
  const pairing = pairing_request(wallet)
  const consent = authorization_id
    ? await client.request<HostedConnectRequest>(
        `/connect/request?authorization_id=${encodeURIComponent(authorization_id)}`
      )
    : null
  if (
    consent &&
    ![
      consent.network === 'mainnet',
      Array.isArray(consent.scopes),
      consent.resource === new URL('/mcp', client.origin).href,
    ].every(Boolean)
  )
    throw new Error('Invalid consent request')
  const signed = await sign_hosted_challenge(
    client,
    wallet,
    {
      authorization_id: authorization_id ?? undefined,
      owner: pairing.owner,
      zklogin_public_identifier: pairing.zklogin_public_identifier,
      purpose: 'session',
    },
    retain,
    consent
  )
  const result = await client.request<HostedVerifyResponse>('/connect/verify', {
    challenge_id: signed.challenge_id,
    signature: signed.signature,
  })
  current_wallet(wallet, client.signal)
  if (result.owner !== wallet.address || !Array.isArray(result.bots)) throw new Error('Owner mismatch')
  return { authorization_id: signed.authorization_id, bots: result.bots, consent }
}

const pause = (signal: Readonly<AbortSignal>) =>
  new Promise<void>((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', aborted)
      resolve()
    }, 1000)
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) aborted()
  })
export const provision_hosted = async (
  client: Readonly<HostedClient>,
  authorization_id: string
): Promise<HostedBotDescriptor> => {
  const result = await client.request<HostedProvisionResponse>('/connect/bots', { authorization_id })
  if (result.status === 'ready' && result.bot?.status === 'ready') return result.bot
  if (result.status !== 'pending') throw new Error('Hosted signer unavailable')
  await pause(client.signal)
  return provision_hosted(client, authorization_id)
}
export const verify_hosted_bot = async (
  client: Readonly<HostedClient>,
  wallet: AuthSession,
  authorization_id: string,
  bot: HostedBotDescriptor
) => {
  current_wallet(wallet, client.signal)
  const request = pairing_request(wallet)
  if (bot.status !== 'ready') throw new Error('Hosted signer unavailable')
  const poll = async (): Promise<AgentPairingResponse> => {
    const result = await client.request<{ status: 'pending' | 'ready'; proof?: AgentPairingResponse }>(
      '/connect/proof',
      { authorization_id, bot_id: bot.id, request }
    )
    if (result.status === 'ready' && result.proof) return result.proof
    if (result.status !== 'pending') throw new Error('Invalid signer proof')
    await pause(client.signal)
    return poll()
  }
  const identity = await verify_agent_pairing(request, await poll())
  current_wallet(wallet, client.signal)
  if (identity.address !== bot.address || identity.multisig_public_key !== bot.multisig_public_key)
    throw new Error('Hosted descriptor mismatch')
  const failure = complete_agent_pairing(browser_auth_storage(), request, identity)
  if (failure) throw new Error(`Hosted recovery unavailable: ${failure}`)
  dispatch_app({ type: 'agent/pairing_verified', wallet, pairing: identity })
}
export const authorize_hosted = async (
  client: Readonly<HostedClient>,
  wallet: AuthSession,
  authorization_id: string,
  bot: HostedBotDescriptor,

  consent: HostedConnectRequest
) => {
  const pairing = pairing_request(wallet)
  const signed = await sign_hosted_challenge(
    client,
    wallet,
    {
      authorization_id,
      owner: pairing.owner,
      zklogin_public_identifier: pairing.zklogin_public_identifier,
      purpose: 'consent',
      bot_id: bot.id,
      policy_revision: bot.policy_revision,
      generation: bot.generation,
      address: bot.address,
      multisig_public_key: bot.multisig_public_key,
    },
    () => undefined,
    consent
  )
  const result = await client.request<HostedAuthorizeResponse>('/connect/authorize', {
    challenge_id: signed.challenge_id,
    signature: signed.signature,
  })
  current_wallet(wallet, client.signal)
  const redirect = new URL(result.redirect_url)
  const registered = new URL(consent.redirect_uri)
  if (redirect.origin !== registered.origin || redirect.pathname !== registered.pathname)
    throw new Error('Unexpected OAuth redirect')
  return redirect.href
}
