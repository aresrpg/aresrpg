// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The home page's one call to the hosted bot: put the signed-in Google account on the Telegram waitlist.
// The bot stores an address only for a browser that proved it owns it, with the same signed session
// challenge Connect Your Agent uses. Nothing is paired, provisioned or granted here.
import { hosted_owner_identity, sign_hosted_challenge_with } from '../agents/hosted_challenge.ts'
import type { AuthSession } from '../auth.ts'
import { env } from '../env.ts'

type Service = Readonly<{ origin: string; web_origin: string; fetcher: typeof fetch }>

const post_json = async <T>({ origin, fetcher }: Service, path: string, body: unknown): Promise<T> => {
  const response = await fetcher(new URL(path, origin), {
    method: 'POST',
    credentials: 'include',
    signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`waitlist_request_refused_${response.status}`)
  return response.json() as Promise<T>
}

export const join_telegram_waitlist = async (
  wallet: AuthSession,
  service: Service = { origin: env.bot_service_url, web_origin: window.location.origin, fetcher: fetch }
): Promise<void> => {
  if (!service.origin) throw new Error('bot_service_unconfigured')
  const identity = hosted_owner_identity(wallet)
  const post = <T>(path: string, body: unknown) => post_json<T>(service, path, body)
  const proof = await sign_hosted_challenge_with(
    post,
    wallet,
    { owner: identity.owner, zklogin_public_identifier: identity.zklogin_public_identifier, purpose: 'session' },
    () => ({ consent: null, issuer: service.origin, web_origin: service.web_origin })
  )
  await post('/connect/verify', { challenge_id: proof.challenge_id, signature: proof.signature })
  await post('/connect/waitlist', { authorization_id: proof.authorization_id })
}
