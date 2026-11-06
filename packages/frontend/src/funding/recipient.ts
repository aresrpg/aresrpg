// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { owner_agent_identity } from '@aresrpg/sdk/agent-recall'
import type { AgentPairingIdentity } from '@aresrpg/protocol'

import type { SessionState } from '../modules/session.ts'
export type FundingAuthorization = Readonly<{
  wallet: NonNullable<SessionState['wallet']>
  serial: number
  recipient: string
}> &
  (
    | Readonly<{ character_id: string; pairing?: never }>
    | Readonly<{ character_id: null; pairing: AgentPairingIdentity }>
  )
/** Recovery funding uses the same canonical Google-member proof as Recall, independently of spectating.
 * The request reads public metadata; it neither pairs nor signs. */
export const recall_funding_authorization = (
  session: SessionState,
  pairing: AgentPairingIdentity
): FundingAuthorization | null => {
  const { wallet } = session
  if (wallet?.identity !== 'zklogin' || !wallet.read_agent_pairing_request) return null
  try {
    const request = wallet.read_agent_pairing_request(crypto.randomUUID())
    if (!request || request.owner !== wallet.address) return null
    owner_agent_identity(pairing, request)
    return {
      wallet,
      serial: session.agent_view.serial,
      recipient: pairing.address,
      character_id: null,
      pairing: Object.freeze({ ...pairing }),
    }
  } catch (error) {
    console.warn('Recall funding recipient verification failed.', error)
    return null
  }
}
/** Server-accepted observation is the authorization boundary; saved pairing alone is insufficient. */
export const agent_funding_authorization = (session: SessionState): FundingAuthorization | null => {
  if (!session.wallet || session.link_status !== 'ready' || session.agent_view.status !== 'ready') return null
  if (
    !session.agent_view.request ||
    !session.agent_view.characters.some((row) => row.id === session.selected_character_id)
  )
    return null
  return {
    wallet: session.wallet,
    serial: session.agent_view.serial,
    recipient: session.agent_view.request.pairing.address,
    character_id: session.selected_character_id!,
  }
}
export const funding_recipient_current = (
  session: SessionState,
  recipient: string,
  authorization?: FundingAuthorization
): boolean => {
  if (!authorization) return session.wallet?.address === recipient
  const current = authorization.pairing
    ? recall_funding_authorization(session, authorization.pairing)
    : agent_funding_authorization(session)
  return [
    current?.wallet === authorization.wallet,
    current?.serial === authorization.serial,
    current?.recipient === authorization.recipient,
    authorization.recipient === recipient,
    current?.character_id === authorization.character_id,
  ].every(Boolean)
}
