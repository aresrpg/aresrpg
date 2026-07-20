// FIGHT OPENNESS TOGGLE — the HUD control that sets whether the NEXT world fight you start is PUBLIC (anyone in placement may
// join) or GROUP-only (your party). The choice lives in the spawns core atom (D770a W2 — the claim_tx effect
// request carries it); this control renders + flips it through the fight_openness adapter. A two-state
// segmented control (design law: not a switch); the active half is gold. Hidden in a fight (you set it before
// engaging, not mid-board) — mirrors the compass/day-night HUD chrome gate.

import { useTranslation } from 'react-i18next'
import { OPENNESS_PUBLIC, OPENNESS_GROUP } from '@aresrpg/world'

import { use_openness, set_openness } from '../../../../world-shell/fight_openness.js'

/** @returns {import('react').ReactElement} */
export function FightOpennessToggle() {
  const { t } = useTranslation()
  const openness = use_openness()
  return (
    <div className="gw-openness" role="group" aria-label={t('fights.openness_label')}>
      <span className="gw-openness__label">{t('fights.openness_label')}</span>
      <button
        type="button"
        className={`gw-openness__opt${openness === OPENNESS_PUBLIC ? ' gw-openness__opt--on' : ''}`}
        aria-pressed={openness === OPENNESS_PUBLIC}
        onClick={() => set_openness(OPENNESS_PUBLIC)}
      >
        {t('fights.openness_public')}
      </button>
      <button
        type="button"
        className={`gw-openness__opt${openness === OPENNESS_GROUP ? ' gw-openness__opt--on' : ''}`}
        aria-pressed={openness === OPENNESS_GROUP}
        onClick={() => set_openness(OPENNESS_GROUP)}
      >
        {t('fights.openness_group')}
      </button>
    </div>
  )
}
