// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { env } from '../env.ts'
import type { SessionState } from '../modules/session.ts'
import { useAppStore } from '../store.ts'

import { owner_answer, owner_answered, owner_checkable, owner_reachable, type OwnerAnswer } from './owner_state.ts'

/** The one reading of the owner check on this page: what is known, and whether it is a real answer. */
const read_owner = (session: SessionState): Readonly<{ answer: OwnerAnswer; answered: boolean }> => {
  // A render outside a browser has no address, so it has no consent link either.
  const search = typeof location === 'undefined' ? '' : location.search
  const checkable = owner_checkable(session.wallet, env.bot_service_url, search)
  const reachable = owner_reachable(session.wallet, env.bot_service_url)
  return {
    answer: owner_answer(session, checkable, reachable),
    answered: owner_answered(session, checkable, reachable),
  }
}

/** What is known about this account's agent on this page: the one reading every agent control shows. */
export const useOwnerAnswer = (): OwnerAnswer => useAppStore(({ session }) => read_owner(session).answer)

/** The setup opens by itself only on a real "not connected": a check without an answer opens nothing. */
export const useSetupOpensItself = (): boolean =>
  useAppStore(({ session }) => {
    const { answer, answered } = read_owner(session)
    return answered && answer === 'not_connected'
  })
