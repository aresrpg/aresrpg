// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The ROOM-CLEARED reward recap. NON-GATING (one-toast / no-modal constitution): when a room
// clears, the fight board unmounts and the player free-roams the plane; this slides a compact "what you found"
// card in from the top-right off the store's `room_recap` slice (set by dungeon_store._claim_cleared_room after
// the silent background #33 claim). It NEVER blocks movement or the next-cluster click — it self-dismisses on a
// timer, and clears the instant the next room starts (sync_engine drops room_recap on the fresh board spawn).

import { useEffect } from 'react'
import { note_card_shown } from '../../../../fight-engine/fight_end_machine.js' // D153 C14
import { useTranslation } from 'react-i18next'

import { use_dungeon } from '../../../../world-shell/dungeon_store.js'

const RECAP_MS = 7000 // how long the non-gating recap lingers before auto-dismissing

/** @returns {import('react').ReactElement | null} */
export function RewardRecap() {
  const { t } = useTranslation()
  const recap = use_dungeon((s) => s.room_recap)
  // D153 C14: the recap IS the non-terminal card — mounting it advances the machine VICTORY_RESOLVED→CARD_SHOWN.
  useEffect(() => {
    if (recap) note_card_shown()
  }, [recap])
  const dismiss = use_dungeon((s) => s.dismiss_recap)

  // Auto-dismiss after RECAP_MS (re-armed per distinct recap — a new room clear resets the timer). Non-gating,
  // so there is no confirm; it just fades on its own (or is cleared by the next room's board spawn).
  useEffect(() => {
    if (!recap) return
    const id = setTimeout(dismiss, RECAP_MS)
    return () => clearTimeout(id)
  }, [recap, dismiss])

  if (!recap) return null

  return (
    <div className="gw-recap gw-panel" role="status" onClick={dismiss}>
      <span className="gw-recap__title">{t('dungeons.room_cleared')}</span>
      <div className="gw-recap__rewards">
        {recap.xp > 0 && <span className="gw-recap__xp">{t('dungeons.recap_xp', { xp: recap.xp })}</span>}
        {recap.item_qty > 0 && (
          <span className="gw-recap__loot">{t('dungeons.recap_loot', { count: recap.item_qty })}</span>
        )}
        {recap.xp <= 0 && recap.item_qty <= 0 && (
          <span className="gw-recap__xp">{t('dungeons.recap_none')}</span>
        )}
      </div>
      <span className="gw-recap__hint">{t('dungeons.recap_hint')}</span>
    </div>
  )
}
