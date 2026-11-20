// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { HostedBotDescriptor, HostedConnectRequest } from '@aresrpg/protocol'
import type { PendingAuthorization } from '@aresrpg/protocol/hosted-bot-client'

import type { HostedState } from '../agents/hosted_state.ts'

/**
 * The request on screen is the one this tab itself began for this page: same client, same redirect,
 * and that redirect returns to this origin. The pending request lives in this tab's storage, which
 * only this origin's own code can write, so a link from elsewhere can never pass as it.
 */
export const own_request = (
  consent: Readonly<HostedConnectRequest>,
  pending: Readonly<PendingAuthorization> | null,
  origin: string
): boolean =>
  [
    pending !== null,
    consent.client_id === pending?.client_id,
    consent.redirect_uri === pending?.redirect_uri,
    URL.canParse(consent.redirect_uri) && new URL(consent.redirect_uri).origin === origin,
  ].every(Boolean)

/**
 * What the dapp does next without asking: it proves the owner, then approves its own request. An
 * assistant's request never takes this path; it waits for the player on the consent dialog.
 * `refused` is a request that is not this tab's own.
 */
export const silent_step = (
  state: Readonly<HostedState<HostedBotDescriptor>>,
  pending: Readonly<PendingAuthorization> | null,
  origin: string
): 'authenticating' | 'authorizing' | 'refused' | null => {
  if (!state.session || !pending) return null
  if (state.phase === 'idle') return 'authenticating'
  if (state.phase !== 'ready' || !state.consent) return null
  if (!own_request(state.consent, pending, origin)) return 'refused'
  const verified = state.bots.some(({ id }) => id === state.selected && id === state.verified)
  return verified ? 'authorizing' : null
}
