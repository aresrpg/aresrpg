// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button, NativeModal } from '@aresrpg/ui'
import { Check, Sparkles, Trophy } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { SuiLogo } from '../components/SuiLogo.tsx'
import { KaresLogo } from '../components/KaresLogo.tsx'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { copy_text, type CopyText } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import {
  combined_tournament_rewards,
  tournament_presentation_available,
  type CollectedReward,
} from '../modules/tournament_rewards.ts'

import { tournament_item } from './TournamentReward.tsx'
import { useRewardReveal } from './useRewardReveal.ts'
import './rewards.css'

const RewardCard = ({ reward, visible, t }: Readonly<{ reward: CollectedReward; visible: boolean; t: CopyText }>) => {
  const numbers = useNumbers()
  const item = reward.asset === 'item' ? tournament_item(reward.template) : null
  const amount = reward.asset === 'item' ? numbers.number(reward.amount) : numbers.sui(reward.amount, 9)
  const icon = item ? item_detail_icon(item.item_type) : null
  const visual = {
    sui: { name: 'SUI', art: <SuiLogo size={64} /> },
    kares: { name: 'KARES', art: <KaresLogo size={64} /> },
    item: { name: item?.name ?? t('unknown_item'), art: icon ? <img src={icon} alt="" /> : <Trophy size={64} /> },
  }[reward.asset]
  return (
    <li className="tourney-reveal-reward" data-asset={reward.asset} data-visible={visible} aria-hidden={!visible}>
      <span className="tourney-reveal-check">
        <Check size={14} />
      </span>
      <div className="tourney-reveal-art">{visual.art}</div>
      <strong>+{amount}</strong>
      <span>{visual.name}</span>
    </li>
  )
}

const RewardReveal = ({
  rewards,
  active,
  t,
}: Readonly<{ rewards: readonly CollectedReward[]; active: boolean; t: CopyText }>) => {
  const { visible, reveal_all } = useRewardReveal(rewards.length, active)
  const grid = useRef<HTMLOListElement>(null)
  useEffect(() => {
    if (active && visible > 0)
      grid.current?.children.item(visible - 1)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active, visible])
  const close = (): void => dispatch_app({ type: 'tournament/rewards_closed' })
  if (!active) return null
  return (
    <NativeModal label={t('rewards_collected')} close={close} className="tourney-reveal-modal">
      <div className="tourney-reveal-surface">
        <section className="tourney-reveal-panel">
          <header className="tourney-reveal-heading">
            <span className="tourney-reveal-emblem">
              <Trophy size={36} />
            </span>
            <p>{t('results')}</p>
            <h2>{t('rewards_collected')}</h2>
            <span>{t('rewards_arrived')}</span>
          </header>
          <ol className="tourney-reveal-grid" ref={grid}>
            {rewards.map((reward, index) => (
              <RewardCard
                key={reward.asset === 'item' ? reward.template : reward.asset}
                reward={reward}
                visible={index < visible}
                t={t}
              />
            ))}
          </ol>
          <footer className="tourney-reveal-footer">
            <span role="status">{t('rewards_revealed', { shown: visible, total: rewards.length })}</span>
            {visible < rewards.length && (
              <Button onClick={reveal_all}>
                <Sparkles size={15} />
                {t('reveal_all')}
              </Button>
            )}
            <Button tone="primary" onClick={close}>
              {t('reward_continue')}
            </Button>
          </footer>
        </section>
      </div>
    </NativeModal>
  )
}

export const TournamentRewards = () => {
  const copy = useAppStore((state) => state.copy)
  const collections = useAppStore((state) => state.tournament.collections)
  const reveal = useAppStore((state) => state.tournament.reward_reveal)
  const active = useAppStore(tournament_presentation_available)
  if (!copy || reveal.length === 0) return null
  const rewards = combined_tournament_rewards(collections.filter((row) => reveal.includes(row.digest)))
  return <RewardReveal key={reveal.join(':')} rewards={rewards} active={active} t={copy_text(copy.tournament_page)} />
}
