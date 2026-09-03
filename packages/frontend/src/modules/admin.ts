// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The public admin surface is read-only analytics plus royalty-wallet actions. Package and
// content publication have no browser path.

import { initial_admin_state, type AdminInput, type AdminState } from '../admin/admin_state.ts'
import { reduce_admin_overview } from '../admin/admin_overview.ts'
import { observe_admin_wallet, reduce_admin_wallet } from '../admin/admin_wallet.ts'
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
  const wallet = reduce_admin_wallet(admin, input)
  if (wallet) return with_admin(state, wallet)
  if (input.type === 'auth/disconnected' || input.type === 'auth/rejected')
    return with_admin(state, initial_admin_state())
  return state
}

const observe = ({ events, dispatch, signal, get_state }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  observe_admin_wallet({ events, dispatch, signal, get_state })
  events.on('STATE_UPDATED', (state) => {
    const input = admin_dashboard_input(state)
    if (input) dispatch(input)
  })
}

export default Object.freeze({ name: 'admin', reduce, observe }) satisfies AppModule
