// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE RESUME DOOR's face (#1751 / #1757). A boot onto a character whose seat is still live on chain — and whose
// fight needs a permissionless heal before it can be presented — used to send that heal itself: one gas-burning
// transaction per boot, and a stranded fight walked toward a resolution the player never chose. Now the entry ASKS,
// and this is the asking: rejoin, forfeit, or neither.
//
// A pure renderer of `fight_resume_offer_store` (renders null until an offer stands), mounted by the world HUD like
// the other store-driven surfaces. It decides NOTHING: the three buttons hand a choice back through the store's one
// door, and the entry that parked on it resumes with the answer. Escape / scrim = "not now" — a stray key may never
// forfeit a fight.

import { useSyncExternalStore } from 'react'

import i18n from '../../../../i18n'
import { choose_fight_resume, fight_resume_offer_store } from '../../../../world-shell/fight_resume_offer.js'

import { ConfirmDialog } from './ConfirmDialog.jsx'

export function FightResumeOffer() {
  const offer = useSyncExternalStore(fight_resume_offer_store.subscribe, fight_resume_offer_store.get)
  if (!offer) return null
  return (
    <ConfirmDialog
      open
      title={i18n.t('fights.resume_offer_title')}
      message={i18n.t('fights.resume_offer_message')}
      confirm_label={i18n.t('fights.resume_offer_rejoin')}
      secondary_label={i18n.t('fights.resume_offer_forfeit')}
      on_secondary={() => choose_fight_resume('forfeit')}
      cancel_label={i18n.t('fights.resume_offer_later')}
      on_confirm={() => choose_fight_resume('rejoin')}
      on_cancel={() => choose_fight_resume('later')}
    />
  )
}
