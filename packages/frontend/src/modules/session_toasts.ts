// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Failure presentation for the session: raw chain/link failures become honest player toasts.
// Split from session.ts (the file-size law); the session observer arms this once.

import { env } from '../env.ts'
import { on_error_translate, on_gas_empty, toast } from '../toast.ts'
import type { AppModule } from '../store.ts'

export const observe_failure_toasts = ({
  events,
  dispatch,
  get_state,
  signal,
}: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  // a tx failed for gas → the dismissible top-up door (never on plain load)
  on_gas_empty(() => get_state().session.wallet && dispatch({ type: 'dialog/open', dialog: 'top_up' }))
  // two raw chain failures a player could never read become one honest sentence each: the
  // version gate (`version::assert_latest`, abort 601) while the game is paused, and a dry run
  // the fixed gas budget could not cover — OUR bug, never the player's empty wallet, so it
  // must not read like one
  on_error_translate((message) => {
    const { copy } = get_state()
    if (message.includes('::version::assert_latest')) return copy?.game_paused_toast ?? null
    return message.includes('gas budget exceeded') ? (copy?.gas_budget_toast ?? null) : null
  })
  signal.addEventListener('abort', () => {
    on_gas_empty(null)
    on_error_translate(null)
  })
  events.on('link/rejected', ({ reason }) => {
    const { copy } = get_state()
    toast.persistent(
      copy?.address_verification_failed ?? 'We could not verify this wallet address.',
      'error',
      ...(copy
        ? [
            Object.freeze({
              label: copy.join_discord,
              onClick: () => globalThis.open(env.discord_url, '_blank', 'noopener,noreferrer'),
            }),
          ]
        : [])
    )
    dispatch({ type: 'auth/rejected', error: reason })
  })
}
