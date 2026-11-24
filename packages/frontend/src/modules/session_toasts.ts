// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Failure presentation for the session: raw chain/link failures and a sign-in that did not complete
// become honest player toasts. Split from session.ts (the file-size law); the session observer arms this once.

import { failure_copy_key, player_error_text } from '../i18n/player_error.ts'
import { on_error_translate, on_gas_empty, toast } from '../toast.ts'
import type { SiteContext, SiteState } from '../store.ts'
import { SITE_ADDRESSES } from '../site/routes.ts'

/** A sign-in, or a remembered session's restore, that ended without an account: the reason, or null. */
const failed_sign_in = ({ session }: SiteState, { session: before }: SiteState): string | null =>
  before.sign_in.status === 'connecting' && session.sign_in.status === 'idle' ? session.sign_in.error : null

export const observe_failure_toasts = ({ events, dispatch, get_state, signal }: SiteContext): void => {
  // a tx failed for gas → the dismissible top-up door (never on plain load)
  on_gas_empty(() => get_state().session.wallet && dispatch({ type: 'funding/open' }))
  // raw chain failures a player could never read become one honest sentence each: the
  // version gate (`version::assert_latest`, abort 601) while the game is paused, and a dry run
  // the fixed gas budget could not cover — OUR bug, never the player's empty wallet, so it
  // must not read like one
  on_error_translate((message, raw) => {
    const { copy } = get_state()
    const key = failure_copy_key(message)
    if (!copy) return null
    return key ? copy[key] : raw ? player_error_text(copy, message) : null
  })
  signal.addEventListener('abort', () => {
    on_gas_empty(null)
    on_error_translate(null)
  })
  // The raw reason is translated into the player's sentence by the translator above.
  events.on('STATE_UPDATED', (state, previous) => {
    const reason = failed_sign_in(state, previous)
    if (reason) toast.add(reason, 'error')
  })
  events.on('STATE_UPDATED', (state, previous) => {
    const connected = state.session.wallet
    if (!connected || connected === previous.session.wallet) return
    connected.on_invalidated?.(() => {
      if (signal.aborted || get_state().session.wallet !== connected) return
      const ended = get_state().copy?.wallet_session_ended ?? 'Your wallet session ended. Sign in again.'
      toast.add(ended, 'info')
      dispatch({ type: 'auth/rejected', error: ended })
    })
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
              onClick: () => globalThis.open(SITE_ADDRESSES.discord, '_blank', 'noopener,noreferrer'),
            }),
          ]
        : [])
    )
    dispatch({ type: 'auth/rejected', error: reason })
  })
}
