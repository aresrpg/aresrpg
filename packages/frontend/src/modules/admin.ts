// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The site's admin page: read-only analytics plus royalty-wallet actions, for the admin address alone. Package
// and content publication have no browser path.

import type { ClientPacket } from '@aresrpg/protocol'

import { initial_admin_state, type AdminInput, type AdminState } from '../admin/admin_state.ts'
import { reduce_admin_overview } from '../admin/admin_overview.ts'
import { send_admin_dashboard_requests } from '../admin/admin_requests.ts'
import { is_admin_address } from '../admin_access.ts'
import { SITE_ADDRESSES } from '../site/routes.ts'
import type { SiteState } from '../site_modules.ts'
import type { AppInput, SiteModule } from '../store.ts'

export { initial_admin_state }
export type { AdminInput, AdminState }

/** Whether this address is the admin page and the account may see it. */
export const admin_page_open = (state: Readonly<Pick<SiteState, 'location' | 'session'>>): boolean =>
  state.location.pathname === SITE_ADDRESSES.admin && is_admin_address(state.session.wallet?.address ?? null)

export const admin_overview_ready_to_load = (state: Readonly<SiteState>): boolean =>
  admin_page_open(state) && state.session.link_status === 'ready' && state.admin.overview.status === 'idle'

const admin_dashboard_input = (state: Readonly<SiteState>): AdminInput | null => {
  if (admin_overview_ready_to_load(state)) return Object.freeze({ type: 'admin/overview_refresh' })
  return null
}

const with_admin = <S extends SiteState>(state: S, admin: AdminState): S => Object.freeze({ ...state, admin })

const reduce = <S extends SiteState>(state: S, input: AppInput): S => {
  const { admin } = state
  const overview = reduce_admin_overview(admin, input)
  if (overview) return with_admin(state, overview)
  if (input.type === 'auth/disconnected' || input.type === 'auth/rejected')
    return with_admin(state, initial_admin_state())
  return state
}

const observe: NonNullable<SiteModule['observe']> = ({ events, dispatch, get_state, next_request_id }) => {
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
}) satisfies SiteModule
