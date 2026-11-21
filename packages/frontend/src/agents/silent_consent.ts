// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { HostedBotDescriptor, HostedConnectRequest } from '@aresrpg/protocol'

import type { HostedState } from './hosted_state.ts'

/** Whether a request is one of our own, which our own page may approve without asking. */
export type TrustedRequest = (consent: Readonly<HostedConnectRequest>) => boolean

/**
 * The request returns to our Telegram service. The bot delivers a code only to the redirect a request
 * registered, so a request that names our Telegram callback can only link a chat that our Telegram
 * service chose. `consent` must be the bot's own description of the request, never a hint from the
 * address. Without the configured callback no request is Telegram's.
 */
export const telegram_request = (consent: Readonly<Pick<HostedConnectRequest, 'redirect_uri'>>, callback_url: string) =>
  callback_url !== '' && URL.canParse(consent.redirect_uri) && new URL(consent.redirect_uri).href === callback_url

/**
 * What a page of ours does next without asking: it proves the owner, then approves a request it
 * trusts. This is the one rule for every consent that needs no screen; each caller only says which
 * request it trusts (`null`: none, so nothing starts). An assistant's request never takes this path:
 * it waits for the player on the consent dialog. `refused` is a request the caller does not trust.
 */
export const silent_step = (
  state: Readonly<HostedState<HostedBotDescriptor>>,
  trusted: TrustedRequest | null
): 'authenticating' | 'authorizing' | 'refused' | null => {
  if (!state.session || !trusted) return null
  if (state.phase === 'idle') return 'authenticating'
  if (state.phase !== 'ready' || !state.consent) return null
  if (!trusted(state.consent)) return 'refused'
  const verified = state.bots.some(({ id }) => id === state.selected && id === state.verified)
  return verified ? 'authorizing' : null
}
