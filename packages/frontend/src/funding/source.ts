// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SessionState } from '../modules/session.ts'
import type { ExternalSession } from '../wallet/external_session.ts'

import { funding_recipient_current, type FundingAuthorization } from './recipient.ts'

/** Own-wallet funding is offered only for an authorized, different agent destination. */
export const funding_owner_source = (session: SessionState, recipient: string, authorization?: FundingAuthorization) =>
  authorization &&
  session.wallet?.identity === 'zklogin' &&
  session.wallet.address !== recipient &&
  funding_recipient_current(session, recipient, authorization)
    ? session.wallet
    : null

export const funding_source_current = (
  state: Readonly<{ session: SessionState; external_wallet: Readonly<{ session: ExternalSession | null }> }>,
  source: ExternalSession,
  recipient: string,
  authorization?: FundingAuthorization
): boolean =>
  source === state.external_wallet.session || source === funding_owner_source(state.session, recipient, authorization)

/** Source preference is local to the checkout; unavailable own-wallet authority falls back to external funding. */
export const selected_funding_source = (
  owner: ExternalSession | null,
  external: ExternalSession | null,
  prefer_external: boolean
) => (prefer_external ? external : (owner ?? external))
