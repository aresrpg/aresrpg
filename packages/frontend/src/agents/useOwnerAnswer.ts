// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { env } from '../env.ts'
import { useAppStore } from '../store.ts'

import { owner_answer, owner_answered, owner_checkable, type OwnerAnswer } from './owner_state.ts'

/** What is known about this account's agent on this page: the one reading every agent control shows. */
export const useOwnerAnswer = (): OwnerAnswer =>
  useAppStore(({ session }) => {
    // A render outside a browser has no address, so it has no consent link either.
    const search = typeof location === 'undefined' ? '' : location.search
    return owner_answer(session, owner_checkable(session.wallet, env.bot_service_url, search))
  })

/** The setup opens by itself only on a real "not connected": a failed check has no answer and opens nothing. */
export const useSetupOpensItself = (): boolean =>
  useAppStore(({ session }) => {
    const search = typeof location === 'undefined' ? '' : location.search
    const checkable = owner_checkable(session.wallet, env.bot_service_url, search)
    return owner_answered(session, checkable) && owner_answer(session, checkable) === 'not_connected'
  })
