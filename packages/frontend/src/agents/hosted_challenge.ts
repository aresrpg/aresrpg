// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  validate_hosted_challenge,
  type HostedChallengeInput,
  type HostedChallengeResponse,
  type HostedConnectRequest,
} from '@aresrpg/protocol'

import type { AuthSession } from '../auth.ts'

export type HostedSigningIntent = Readonly<{
  input: HostedChallengeInput
  consent: HostedConnectRequest | null
  issuer: string
  web_origin: string
}>
export const sign_hosted_message = async <T>(
  challenge: HostedChallengeResponse,
  intent: HostedSigningIntent,
  sign: (message: Uint8Array) => Promise<T>
): Promise<T> => {
  if (!Number.isFinite(challenge.expires_at) || challenge.expires_at <= Date.now()) throw new Error('Expired challenge')
  validate_hosted_challenge(challenge, intent, Date.now())
  const signed = await sign(new TextEncoder().encode(challenge.message))
  if (challenge.expires_at <= Date.now()) throw new Error('Expired challenge')
  return signed
}

/** The Google account's identity for an owner proof. Only a zkLogin account can prove ownership to the bot. */
export const hosted_owner_identity = (wallet: Pick<AuthSession, 'identity' | 'read_agent_pairing_request'>) => {
  const request = wallet.read_agent_pairing_request?.(crypto.randomUUID())
  if (wallet.identity !== 'zklogin' || !request) throw new Error('Google wallet required')
  return request
}

type HostedPost = <T>(path: string, body?: Readonly<unknown>) => Promise<T>
/** One owner-proof signature: ask the bot for a challenge, check it against this exact request, sign it.
 * `check` runs between the awaited steps so a caller can stop when its account changed;
 * `retain` receives the authorization id just before the account signs. */
export const sign_hosted_challenge_with = async (
  post: HostedPost,
  wallet: Pick<AuthSession, 'sign_personal_message'>,
  input: HostedChallengeInput,
  /** Read after the bot answered, so a request that is refused never touches the page. */
  context: () => Omit<HostedSigningIntent, 'input'>,
  {
    check = () => undefined,
    retain = () => undefined,
  }: Readonly<{ check?: () => void; retain?: (id: string) => void }> = {}
) => {
  check()
  const challenge = await post<HostedChallengeResponse>('/connect/challenge', input)
  check()
  const { signature } = await sign_hosted_message(challenge, { input, ...context() }, (bytes) => {
    retain(challenge.authorization_id)
    return wallet.sign_personal_message(bytes)
  })
  check()
  return { challenge_id: challenge.challenge_id, signature, authorization_id: challenge.authorization_id }
}

/** Display the registered destination, never a self-asserted OAuth client brand. */
export const hosted_consent_destination = (redirect_uri: string): string => {
  const url = new URL(redirect_uri)
  if ([url.protocol !== 'https:', url.username, url.password, url.hash].some(Boolean))
    throw new Error('Invalid consent callback')
  // Exact stable callback documented at https://developers.openai.com/plugins/build/auth.
  // Recognition changes presentation only; it grants no trust or authorization to the client.
  return url.href === 'https://chatgpt.com/connector_platform_oauth_redirect' ? 'ChatGPT' : url.host
}
