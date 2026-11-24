// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { env } from '../env.ts'
import { useSiteStore } from '../store.ts'

import { owner_answer, owner_checkable, owner_reachable, type OwnerAnswer } from './owner_state.ts'

/** What is known about this account's agent on the address shown: the one reading every agent control shows. */
export const useOwnerAnswer = (): OwnerAnswer =>
  useSiteStore(({ session, location }) =>
    owner_answer(
      session,
      owner_checkable(session.wallet, env.bot_service_url, location.search),
      owner_reachable(session.wallet, env.bot_service_url)
    )
  )
