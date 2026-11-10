// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  validate_hosted_challenge,
  type HostedChallengeInput,
  type HostedChallengeResponse,
  type HostedConnectRequest,
} from '@aresrpg/protocol'

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

/** Display the registered destination, never a self-asserted OAuth client brand. */
export const hosted_consent_destination = (redirect_uri: string): string => {
  const url = new URL(redirect_uri)
  if ([url.protocol !== 'https:', url.username, url.password, url.hash].some(Boolean))
    throw new Error('Invalid consent callback')
  // Exact stable callback documented at https://developers.openai.com/plugins/build/auth.
  // Recognition changes presentation only; it grants no trust or authorization to the client.
  return url.href === 'https://chatgpt.com/connector_platform_oauth_redirect' ? 'ChatGPT' : url.host
}
