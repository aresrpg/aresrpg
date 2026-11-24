// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The public admin surface is read-only analytics plus royalty-wallet actions. Package and
// content publication have no browser path.

import type { ClientPacket } from '@aresrpg/protocol'

import { initial_admin_state, type AdminInput, type AdminState } from '../admin/admin_state.ts'
import { reduce_admin_overview } from '../admin/admin_overview.ts'
import { send_admin_dashboard_requests } from '../admin/admin_requests.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'

export { initial_admin_state }
export type { AdminInput, AdminState }

export const admin_overview_ready_to_load = (state: Readonly<AppState>): boolean =>
  state.navigation.page === 'admin' && state.session.link_status === 'ready' && state.admin.overview.status === 'idle'

const admin_dashboard_input = (state: Readonly<AppState>): AdminInput | null => {
  if (admin_overview_ready_to_load(state)) return Object.freeze({ type: 'admin/overview_refresh' })
  return null
}

const with_admin = (state: AppState, admin: AdminState): AppState => Object.freeze({ ...state, admin })

const reduce = (state: AppState, input: AppInput): AppState => {
  const { admin } = state
  const overview = reduce_admin_overview(admin, input)
  if (overview) return with_admin(state, overview)
  if (input.type === 'auth/disconnected' || input.type === 'auth/rejected')
    return with_admin(state, initial_admin_state())
  return state
}

const observe: NonNullable<AppModule['observe']> = ({ events, dispatch, get_state, next_request_id }) => {
  /** A request leaves only over an accepted link; one that cannot leave fails at once. */
  const send = (packet: Readonly<ClientPacket>): boolean => {
    if (!['connected', 'ready'].includes(get_state().session.link_status)) return false
    dispatch({ type: 'server/send', packet })
    return true
  }
  events.on('STATE_UPDATED', (state, previous) => {
    const input = admin_dashboard_input(state)
    if (input) dispatch(input)
    send_admin_dashboard_requests({ state, previous, send, dispatch, next_id: next_request_id })
  })
}

export default Object.freeze({
  name: 'admin',
  initial: () => ({ admin: initial_admin_state() }),
  reduce,
  observe,
}) satisfies AppModule
