// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export type HostedBotDescriptor = Readonly<{
  id: string
  address: string
  multisig_public_key: string
  generation: number
  policy_revision: number
  status: 'ready' | 'paused' | 'returning'
}>
export const same_hosted_bot = (left: HostedBotDescriptor | null, right: HostedBotDescriptor): boolean =>
  left !== null &&
  (['id', 'address', 'multisig_public_key', 'generation', 'policy_revision', 'status'] as const).every(
    (key) => left[key] === right[key]
  )

/** AI-authored presentation only; never executable steps or inferred completion. */
export type HostedObjective = Readonly<{
  title: string
  description?: string
  steps?: readonly string[]
}>
export type HostedAgentActivity = Readonly<{
  issue?: string
  status: 'idle' | 'active' | 'waiting' | 'awaiting_ai' | 'paused' | 'unavailable'
  character_ids: readonly string[]
  objective: HostedObjective | null
}>

/** Current owner-authorized connector access, not actor presence or active inference. */
export type HostedOwnerStatus = Readonly<{
  owner: string
  status: 'connected' | 'disconnected' | 'ambiguous'
  bot: HostedBotDescriptor | null
  recovery_bots: readonly HostedBotDescriptor[]
  expires_at: number | null
  activity?: HostedAgentActivity
}>
export type HostedConnectRequest = Readonly<{
  authorization_id: string
  client_id: string
  client_name: string
  redirect_uri: string
  scopes: readonly string[]
  resource: string
  network: 'mainnet'
}>
export type HostedChallengeInput = Readonly<{
  authorization_id?: string
  owner: string
  zklogin_public_identifier: string
  purpose: 'session' | 'consent'
  bot_id?: string
  policy_revision?: number

  generation?: number
  address?: string
  multisig_public_key?: string
}>
export type HostedChallengeResponse = Readonly<{
  authorization_id: string
  challenge_id: string
  message: string
  expires_at: number
}>
export type HostedVerifyResponse = Readonly<{ owner: string; bots: readonly HostedBotDescriptor[] }>
export type HostedAuthorizeResponse = Readonly<{ redirect_url: string }>
export type HostedProvisionResponse = Readonly<{
  status: 'pending' | 'ready' | 'paused' | 'returning'
  bot?: HostedBotDescriptor
  request_id?: string
}>

export type HostedChallengeEnvelope = Readonly<{
  purpose: 'session' | 'consent'
  issuer: string
  network: 'mainnet'
  authority_generation: string
  authorization_id: string
  session_hash: string
  nonce: string
  owner: string
  zklogin_public_identifier: string
  client_id: string
  redirect_uri: string
  resource: string
  scopes: readonly string[]
  expires_at: number
  consent: Readonly<{
    bot_id: string
    policy_revision: number

    generation: number
    address: string
    multisig_public_key: string
  }> | null
}>
export const hosted_challenge_message = (data: HostedChallengeEnvelope): string =>
  `AresRPG hosted bot ${data.purpose} v1\n${JSON.stringify(data)}`
const challenge_fields = [
  'purpose',
  'issuer',
  'network',
  'authority_generation',
  'authorization_id',
  'session_hash',
  'nonce',
  'owner',
  'zklogin_public_identifier',
  'client_id',
  'redirect_uri',
  'resource',
  'scopes',
  'expires_at',
  'consent',
]
const consent_fields = ['bot_id', 'policy_revision', 'generation', 'address', 'multisig_public_key'] as const
const valid_consent = (value: unknown): boolean => {
  if (value === null) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  return [
    Object.keys(data).length === consent_fields.length,
    Object.keys(data).every((key) => consent_fields.includes(key as (typeof consent_fields)[number])),
    ['bot_id', 'address', 'multisig_public_key'].every((key) => typeof data[key] === 'string' && data[key].length > 0),
    ['generation', 'policy_revision'].every((key) => Number.isSafeInteger(data[key]) && Number(data[key]) > 0),
  ].every(Boolean)
}
export const parse_hosted_challenge = (message: string): HostedChallengeEnvelope => {
  const separator = message.indexOf('\n')
  const value: unknown = JSON.parse(message.slice(separator + 1))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_hosted_challenge')
  const data = value as HostedChallengeEnvelope
  const strings = [
    'issuer',
    'authority_generation',
    'authorization_id',
    'session_hash',
    'nonce',
    'owner',
    'zklogin_public_identifier',
    'client_id',
    'redirect_uri',
    'resource',
  ] as const
  const valid = [
    Object.keys(data).length === challenge_fields.length,
    Object.keys(data).every((key) => challenge_fields.includes(key)),
    ['session', 'consent'].includes(data.purpose),
    data.network === 'mainnet',
    strings.every((key) => typeof data[key] === 'string' && data[key].length > 0),
    Array.isArray(data.scopes) && data.scopes.every((scope) => typeof scope === 'string'),
    Number.isSafeInteger(data.expires_at),
    valid_consent(data.consent),
  ].every(Boolean)
  if (!valid || message.slice(0, separator) !== `AresRPG hosted bot ${data.purpose} v1`)
    throw new Error('invalid_hosted_challenge')
  return data
}
/** Browser signing validates the exact local review, not an arbitrary message returned by an endpoint. */
export const validate_hosted_challenge = (
  response: HostedChallengeResponse,
  expected: Readonly<{
    input: HostedChallengeInput
    consent: HostedConnectRequest | null
    issuer: string
    web_origin: string
  }>,
  now: number
): HostedChallengeEnvelope => {
  const data = parse_hosted_challenge(response.message)
  const { input, consent, issuer, web_origin } = expected
  if (input.purpose === 'consent' && !consent) throw new Error('hosted_consent_review_missing')
  if (consent && consent.authorization_id !== data.authorization_id) throw new Error('hosted_challenge_review_mismatch')
  const request = consent ?? {
    authorization_id: response.authorization_id,
    client_id: 'first-party',
    redirect_uri: web_origin,
    resource: `${issuer}/mcp`,
    scopes: [],
  }
  const live = [
    data.purpose,
    data.issuer,
    data.network,
    data.authorization_id,
    data.nonce,
    data.owner,
    data.zklogin_public_identifier,
    data.client_id,
    data.redirect_uri,
    data.resource,
    data.expires_at,
  ]
  const reviewed = [
    input.purpose,
    issuer,
    'mainnet',
    input.authorization_id ?? request.authorization_id,
    response.challenge_id,
    input.owner,
    input.zklogin_public_identifier,
    request.client_id,
    request.redirect_uri,
    request.resource,
    response.expires_at,
  ]
  if (
    ![
      live.every((field, index) => field === reviewed[index]),
      response.authorization_id === data.authorization_id,
      data.expires_at > now,
      JSON.stringify(data.scopes) === JSON.stringify(request.scopes),
    ].every(Boolean)
  )
    throw new Error('hosted_challenge_review_mismatch')
  validate_reviewed_consent(data, input)
  return data
}

const validate_reviewed_consent = (data: HostedChallengeEnvelope, input: HostedChallengeInput) => {
  const reviewed_consent =
    input.purpose === 'consent'
      ? {
          bot_id: input.bot_id,
          policy_revision: input.policy_revision,

          generation: input.generation,
          address: input.address,
          multisig_public_key: input.multisig_public_key,
        }
      : null
  const matches =
    reviewed_consent === null
      ? data.consent === null
      : data.consent !== null &&
        valid_consent(reviewed_consent) &&
        consent_fields.every((key) => data.consent![key] === reviewed_consent[key])
  if (!matches) throw new Error('hosted_consent_review_mismatch')
}

/** Owner-requested return uses the existing actor journal as its drain barrier. */
export type HostedReturnResponse = Readonly<{
  bot: HostedBotDescriptor
  phase: 'draining' | 'stopped' | 'complete'
}>
