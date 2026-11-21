// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { HostedConnectRequest } from '@aresrpg/protocol'
import type { PendingAuthorization } from '@aresrpg/protocol/hosted-bot-client'

import type { HostedStep } from '../agents/hosted_state.ts'

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

/** The sentence of each wait of a connection, as a key of the dapp's copy. */
const STEP_LABEL: Readonly<Record<HostedStep, string>> = {
  proving: 'connect_proving',
  creating: 'connect_creating',
  checking: 'connect_checking',
  naming: 'connect_naming',
  approving: 'connect_approving',
  returning: 'connect_returning',
}
/** What the consent step waits for: a step of the connection, or before any step the sign-in being restored. */
export const consent_label = (step: HostedStep | null, signing_in: boolean): string => {
  if (step) return STEP_LABEL[step]
  return signing_in ? 'signing_in' : 'connect_busy'
}
