// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useTranslation } from 'react-i18next'

import { use_sponsor_allowance } from '../rpc/use_sponsor_allowance'

// PreFightAllowanceHint — a NON-BLOCKING advisory shown near a fight-start control when the connected
// player's daily free-gameplay allowance may not cover a whole fight. It NEVER gates the action — gameplay
// is never limited; past the allowance the player simply self-pays. It only warns that a
// fight could flip to the player's own gas partway. Render it ONLY where the player is about to fight
// (so the allowance poll runs solely while relevant), e.g. beside the dungeon "Enter" button.
//
// A fight is many per-turn sponsored txs (~0.02–0.1 SUI total). We use the CONSERVATIVE high end so the
// warning fires EARLY rather than let a fight run out of free gas mid-way. Advisory precision is fine —
// the sponsor is the real arbiter and self-pay is the seamless fallback.
const EST_FIGHT_COST_MIST = 100_000_000n // 0.1 SUI

export function PreFightAllowanceHint() {
  const { t } = useTranslation()
  const allowance = use_sponsor_allowance()

  // No hint when logged out, before real data loads, or when there's clearly enough free gameplay left.
  if (!allowance || allowance.resets_at == null) return null
  if (allowance.remaining_mist >= EST_FIGHT_COST_MIST) return null

  return (
    <span
      style={{
        display: 'block',
        marginTop: 8,
        fontSize: 10,
        lineHeight: 1.4,
        letterSpacing: '0.04em',
        color: '#f59e0b',
        opacity: 0.9,
      }}
    >
      {t('sponsor.prefight_hint')}
    </span>
  )
}
