// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Award, Medal, Trophy } from 'lucide-react'
import { Button } from '@aresrpg/ui'
import { tournament_coin_claims, type TournamentRow } from '@aresrpg/protocol'

import type { CopyText } from '../i18n/copy.ts'
import { tournament_podium, tournament_refund_available } from '../modules/tournament_selectors.ts'

import { TournamentCoin, TournamentPool } from './TournamentControls.tsx'
import { TournamentStanding } from './TournamentStanding.tsx'
import { TournamentReward } from './TournamentReward.tsx'
import { TournamentContribution } from './TournamentContribution.tsx'
import { character_label, tournament_act, tournament_name } from './presentation.ts'
import type { TournamentView } from './useTournamentView.ts'

type Tier = ReturnType<typeof tournament_podium>[number]
const rank_icons = [Trophy, Medal, Award, Award, Award] as const

const PodiumTier = ({ row, tier, t }: Readonly<{ row: TournamentRow; tier: Tier; t: CopyText }>) => {
  const RankIcon = rank_icons[tier.place - 1]!
  return (
    <article className={`tourney-pedestal is-place-${tier.place}`}>
      <header className="tourney-rank">
        <span className="tourney-rank-emblem">
          <RankIcon aria-hidden="true" />
        </span>
        <div>
          <small>{tier.place === 5 ? t('joint_fifth') : t('place_number', { place: tier.place })}</small>
          <strong aria-hidden="true">{tier.place}</strong>
        </div>
      </header>
      <h3 data-awarded={tier.teams.length > 0}>
        {tier.teams.length
          ? tier.teams.map((index) => tournament_name(row.teams[index].name)).join(', ')
          : t(tier.final ? 'not_awarded' : 'to_be_decided')}
      </h3>
      <div className="tourney-tier-coins">
        {tier.sui > 0n && <TournamentCoin amount={tier.sui} asset="SUI" reveal />}
        {tier.kares > 0n && <TournamentCoin amount={tier.kares} asset="KARES" reveal />}
        {!tier.final && (
          <small>
            {t('allocation_percent', {
              sui: row.sui_bps[tier.place - 1] / 100,
              kares: row.token_bps[tier.place - 1] / 100,
            })}
          </small>
        )}
      </div>
      {tier.items.length > 0 && (
        <div className="tourney-tier-items">
          <small>{t('items')}</small>
          {tier.items.map((reward) => (
            <TournamentReward key={reward.index} template={reward.template} amount={reward.amount} />
          ))}
        </div>
      )}
    </article>
  )
}

const PersonalRewards = ({
  row,
  tiers,
  view,
  t,
}: Readonly<{
  row: TournamentRow
  tiers: readonly Tier[]
  view: TournamentView
  t: CopyText
}>) => {
  const owned = tiers.flatMap((tier) =>
    tier.seats
      .filter((seat) => seat.member.owner === view.viewer.address)
      .map((seat) => ({ ...seat, items: tier.items }))
  )
  const disabled = !view.can_write
  if (!owned.length) return null
  return (
    <section className="tourney-personal-rewards" aria-label={t('your_rewards')}>
      <h3>{t('your_rewards')}</h3>
      {owned.map(({ member, team, seat, sui, kares, items }) => {
        const due = tournament_coin_claims(row, team, seat)
        return (
          <article className="tourney-personal-seat" key={member.character}>
            <b>{character_label(member.name, member.character)}</b>
            <div className="tourney-personal-coins">
              {sui > 0n && (
                <span>
                  <TournamentCoin amount={sui} asset="SUI" reveal />
                  <small>{t(member.sui_claimed ? 'claimed' : 'unclaimed')}</small>
                </span>
              )}
              {kares > 0n && (
                <span>
                  <TournamentCoin amount={kares} asset="KARES" reveal />
                  <small>{t(member.token_claimed ? 'claimed' : 'unclaimed')}</small>
                </span>
              )}
              {(due.sui > 0n || due.kares > 0n) && (
                <Button disabled={disabled} onClick={() => tournament_act(row.id, { kind: 'coins', team, seat })}>
                  {t('claim_coins')}
                </Button>
              )}
            </div>
            {items.map((reward) => (
              <div className="tourney-personal-item" key={reward.index}>
                <TournamentReward template={reward.template} amount={reward.amount} />
                {(BigInt(member.items_claimed) & (1n << BigInt(reward.index))) !== 0n ? (
                  <small>{t('claimed')}</small>
                ) : (
                  <Button
                    disabled={disabled}
                    onClick={() => tournament_act(row.id, { kind: 'item', team, seat, reward: reward.index })}
                  >
                    {t('claim')}
                  </Button>
                )}
              </div>
            ))}
          </article>
        )
      })}
      <p className="tourney-note">{t('claim_notice')}</p>
    </section>
  )
}

export const TournamentPodium = ({
  row,
  view,
  t,
}: Readonly<{ row: TournamentRow; view: TournamentView; t: CopyText }>) => {
  const tiers = tournament_podium(row)
  const open = row.status === 'open' && !view.registration_expired
  return (
    <section className="tourney-podium">
      <TournamentStanding row={row} address={view.viewer.address} t={t} />
      <header className="tourney-section-heading">
        <div>
          <small>{t(row.status === 'open' ? 'prize_pool' : 'frozen_pool')}</small>
          <TournamentPool row={row} t={t} reveal />
        </div>
        <small>{t('no_platform_fee')}</small>
      </header>
      {row.status !== 'cancelled' && (
        <>
          {row.status === 'finished' && !tiers[0].teams.length && <p className="tourney-notice">{t('no_champion')}</p>}
          <PersonalRewards row={row} tiers={tiers} view={view} t={t} />
          <div className="tourney-pedestals">
            {[1, 0, 2, 3, 4].map((index) => (
              <PodiumTier key={index} row={row} tier={tiers[index]} t={t} />
            ))}
          </div>
          <p className="tourney-note">{t('split_notice')}</p>
        </>
      )}
      {tournament_refund_available(row) && (
        <Button disabled={!view.can_write} onClick={() => tournament_act(row.id, { kind: 'refund' })}>
          {t('refund_pool')}
        </Button>
      )}
      {open && <TournamentContribution row={row} view={view} t={t} />}
    </section>
  )
}
