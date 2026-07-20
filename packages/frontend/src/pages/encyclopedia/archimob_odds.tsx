// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ARCHIMOB SPAWN-ODDS chip — the bestiary detail's "0.5% chance to spawn as an archimob" line. Archimob
// eligibility is an AUTHORED per-mob fact (world_corpus.ts CorpusMob/CorpusMobFacts `role`): only a mob
// whose kit was authored with `role: 'archi'` has an archimob variant, so ONLY those may advertise the
// odds — previously the chip showed on every mob, even ones with no archi variant. The 0.5% itself is
// the global spawn dial (see bestiary_tab.tsx ARCHIMOB_CHANCE_PERCENT) — this component only gates its
// visibility on real eligibility, never invents the number.
import { Dices } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function ArchimobOdds({ eligible, chance }: { eligible: boolean; chance: number }) {
  const { t } = useTranslation()
  if (!eligible) return null
  return (
    <div
      className="flex items-center gap-1.5 text-[9px] tracking-[0.1em] px-2 py-1.5"
      style={{ color: '#6b7280' }}
      title={t('entity.archimob_odds_tooltip')}
      data-archimob-odds
    >
      <Dices size={11} className="shrink-0" style={{ opacity: 0.4 }} />
      <span style={{ color: '#c8963c' }}>{chance}%</span>
      <span className="uppercase">{t('entity.archimob_odds')}</span>
    </div>
  )
}
