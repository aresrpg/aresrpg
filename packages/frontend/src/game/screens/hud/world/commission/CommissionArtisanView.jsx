// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ARTISAN view — the incoming commission queue. Reads /v1/commissions (the live `{ as_artisan, as_customer }`
// shape) through the chain-decoupled stub and renders `as_artisan` (other players asking ME to craft): each
// row is the customer, the requested recipe (icon + name), the offered payment, and an ACCEPT CRAFT action.
// Accepting goes through the stub (commission_actions.accept_craft) so the view is complete + demoable now;
// when the Move v2 commission lane lands, only commission_actions.js changes.

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { use_toast } from '../../../../../toast'
import { ItemIcon } from '../../ItemIcon.jsx'
import { artisan_net_mist } from './commission_logic.js'
import { list_commissions, accept_craft, from_mist } from './commission_actions.js'

/** @returns {import('react').JSX.Element} */
export function CommissionArtisanView() {
  const { t } = useTranslation()
  const [requests, set_requests] = useState(/** @type {import('./commission_actions.js').Commission[]} */ ([]))
  const [loading, set_loading] = useState(true)
  const [pending_id, set_pending_id] = useState(/** @type {string | null} */ (null))
  useEffect(() => {
    let alive = true
    list_commissions().then(({ as_artisan }) => {
      if (!alive) return
      set_requests(as_artisan)
      set_loading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  const on_accept = async (/** @type {import('./commission_actions.js').Commission} */ commission) => {
    if (pending_id) return
    set_pending_id(commission.id)
    try {
      await accept_craft({ commission_id: commission.id })
      use_toast.getState().add(t('commission.accepted', { recipe: commission.recipe_name }), 'info')
      // Optimistic: the accepted request leaves the queue (the real read would repaint from /v1 on the next poll).
      set_requests(prev => prev.filter(r => r.id !== commission.id))
    } catch (error) {
      // no-silent-failure law: humanized copy to the player, raw error to the console.
      use_toast.getState().add(error?.message || t('commission.accept_failed'), 'error')
    } finally {
      set_pending_id(null)
    }
  }

  if (loading) {
    return (
      <div className="gw-cm__view">
        <div className="gw-cm__loading">{t('commission.loading')}</div>
      </div>
    )
  }
  if (requests.length === 0) {
    return (
      <div className="gw-cm__view">
        <div className="gw-cm__empty">{t('commission.no_requests')}</div>
      </div>
    )
  }

  return (
    <div className="gw-cm__view">
      <div className="gw-cm__body">
        <div className="gw-cm__section-h">{t('commission.incoming_head')}</div>
        <div className="gw-cm__reqs">
          {requests.map(commission => {
            const sui = from_mist(commission.payment_mist)
            const free = sui <= 0
            // Honest money split (PLATFORM CUTS): the artisan nets 90% of the escrow,
            // floor-rounded exactly like the chain (artisan_net_mist) — mirrors the customer view's math 1:1.
            const net_sui = from_mist(artisan_net_mist(commission.payment_mist))
            return (
              <div key={commission.id} className="gw-cm__req">
                <span className="gw-cm__req-icon">
                  <ItemIcon
                    item={{
                      icon: commission.recipe_icon,
                      id: commission.recipe_id,
                      category: commission.recipe_category,
                    }}
                    alt={commission.recipe_name}
                  />
                </span>
                <span className="gw-cm__req-id">
                  <span className="gw-cm__req-recipe">{commission.recipe_name}</span>
                  <span className="gw-cm__req-from">
                    {t('commission.from_customer', { customer: commission.customer_name })}
                  </span>
                </span>
                <span className={`gw-cm__req-pay${free ? ' is-free' : ''}`}>
                  <span>{free ? t('commission.free') : t('commission.payment_of', { amount: sui })}</span>
                  {!free && (
                    <span className="gw-cm__req-net">{t('commission.you_receive', { amount: net_sui })}</span>
                  )}
                </span>
                <button
                  type="button"
                  className="gw-cm__btn"
                  disabled={pending_id === commission.id}
                  onClick={() => on_accept(commission)}
                >
                  {pending_id === commission.id ? t('commission.accepting') : t('commission.accept_craft')}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
