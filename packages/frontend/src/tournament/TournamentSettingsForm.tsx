// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useMemo, useState } from 'react'
import { Button } from '@aresrpg/ui'
import { item_is_stackable, max_level as MAX_LEVEL } from '@aresrpg/immutable'
import type { TournamentSettings } from '@aresrpg/sdk/tournament-admin'

import { encyclopedia_catalog } from '../content/catalog.ts'
import { item_icon } from '../content/assets.ts'
import { SearchPickerModal } from '../components/SearchPickerModal.tsx'
import { rolled_item_types } from '../modules/claims.ts'
import type { CopyText } from '../i18n/copy.ts'
import { parse_kolizeum_pledge } from '../modules/kolizeum.ts'
import { minimum_tournament_teams } from '../modules/tournament_selectors.ts'

import { TournamentEntryFee } from './TournamentControls.tsx'
import { parse_prize_percentages, prize_percentage_balance } from './percentages.ts'
import { tournament_item, TournamentReward } from './TournamentReward.tsx'

type Reward = TournamentSettings['rewards'][number]

export type TournamentDraft = Readonly<{
  name: string
  format: 1 | 3 | 6
  deadline: string
  entry_fee: string
  level_limit: string
  sui: readonly string[]
  kares: readonly string[]
  rewards: readonly Reward[]
}>

export const initial_tournament_draft = (): TournamentDraft => ({
  name: '',
  format: 3,
  deadline: '',
  entry_fee: '0',
  level_limit: '',
  sui: ['60', '25', '10', '5', '0'],
  kares: ['60', '25', '10', '5', '0'],
  rewards: [],
})

export const parse_level_limit = (value: string): number | null | undefined => {
  if (value.trim() === '') return null
  const level = Number(value)
  return [Number.isInteger(level), level >= 1, level <= MAX_LEVEL].every(Boolean) ? level : undefined
}

const AllocationBalance = ({
  values,
  asset,
  t,
}: Readonly<{ values: readonly string[]; asset: string; t: CopyText }>) => {
  const remaining = prize_percentage_balance(values)
  return (
    <p className={`tourney-allocation${remaining !== 0 ? ' is-invalid' : ''}`} role="status">
      <b>{asset}</b>
      <span>
        {remaining === null
          ? t('invalid_percentage')
          : t(remaining < 0 ? 'allocation_excess' : 'allocation_remaining', { amount: Math.abs(remaining) / 100 })}
      </span>
    </p>
  )
}

const PrizeSplit = ({
  sui,
  kares,
  set_sui,
  set_kares,
  t,
}: Readonly<{
  sui: readonly string[]
  kares: readonly string[]
  set_sui: (value: readonly string[]) => void
  set_kares: (value: readonly string[]) => void
  t: CopyText
}>) => (
  <section className="tourney-admin-column">
    <h3>{t('prize_split')}</h3>
    <table className="tourney-admin-split">
      <thead>
        <tr>
          <th>{t('place')}</th>
          <th>SUI %</th>
          <th>KARES %</th>
        </tr>
      </thead>
      <tbody>
        {sui.map((value, index) => (
          <tr key={index}>
            <td>{index === 4 ? t('joint_fifth') : index + 1}</td>
            <td>
              <input
                aria-label={`SUI ${index + 1}`}
                inputMode="decimal"
                value={value}
                onChange={(e) => set_sui(sui.map((v, i) => (i === index ? e.target.value : v)))}
              />
            </td>
            <td>
              <input
                aria-label={`KARES ${index + 1}`}
                inputMode="decimal"
                value={kares[index]}
                onChange={(e) => set_kares(kares.map((v, i) => (i === index ? e.target.value : v)))}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    <AllocationBalance values={sui} asset="SUI" t={t} />
    <AllocationBalance values={kares} asset="KARES" t={t} />
    <p className="tourney-note">{t('allocation_notice')}</p>
  </section>
)

const RewardSettings = ({
  rewards,
  change,
  t,
}: Readonly<{ rewards: readonly Reward[]; change: (rewards: readonly Reward[]) => void; t: CopyText }>) => {
  const [picking, set_picking] = useState(false)
  const options = useMemo(
    () =>
      [...rolled_item_types()].flatMap(([id, type]) => {
        const item = encyclopedia_catalog.item(type)?.item
        return item ? [{ id, label: item.name, category: item.category, icon: item_icon(type) }] : []
      }),
    []
  )
  return (
    <section className="tourney-admin-column tourney-admin-rewards">
      <h3>{t('items')}</h3>
      <p className="tourney-note">{t('rolled_items_notice')}</p>
      {rewards.length > 0 && (
        <div className="tourney-admin-item-head" aria-hidden="true">
          <span />
          <span>{t('place')}</span>
          <span>{t('quantity_short')}</span>
          <span />
        </div>
      )}
      {rewards.map((reward, index) => (
        <div className="tourney-admin-item" key={index}>
          <TournamentReward template={reward.template} amount={reward.amount} />
          <label className="aui-field">
            <select
              aria-label={t('reward_place', { number: index + 1 })}
              value={reward.place}
              onChange={(e) =>
                change(rewards.map((r, i) => (i === index ? { ...r, place: Number(e.target.value) } : r)))
              }
            >
              {[1, 2, 3, 4, 5].map((place) => (
                <option key={place} value={place}>
                  {place}
                </option>
              ))}
            </select>
          </label>
          <label className="aui-field">
            <input
              aria-label={t('reward_quantity', { number: index + 1 })}
              type="number"
              min={1}
              max={item_is_stackable(tournament_item(reward.template)?.category ?? '') ? 10 : 1}
              value={reward.amount}
              onChange={(e) =>
                change(rewards.map((r, i) => (i === index ? { ...r, amount: Number(e.target.value) } : r)))
              }
            />
          </label>
          <Button
            aria-label={t('remove_reward', { number: index + 1 })}
            onClick={() => change(rewards.filter((_, i) => i !== index))}
          >
            ×
          </Button>
        </div>
      ))}
      <Button disabled={rewards.length >= 10 || options.length === 0} onClick={() => set_picking(true)}>
        {t('add_item')}
      </Button>
      {picking && (
        <SearchPickerModal
          title={t('choose_item')}
          items={options}
          value=""
          on_close={() => set_picking(false)}
          copy={{
            search: () => t('search_items'),
            all: t('all_items'),
            no_results: t('no_items'),
            results: (count, total) => `${count} / ${total}`,
            selected: (name) => name,
            new_label: t('new_item'),
          }}
          on_select={(template) => {
            change([...rewards, { template, place: 1, amount: 1 }])
            set_picking(false)
          }}
        />
      )}
    </section>
  )
}

export const valid_tournament_rewards = (rewards: readonly Reward[]): boolean =>
  rewards.length <= 10 &&
  rewards.every((reward) => {
    const item = tournament_item(reward.template)
    return (
      item !== null &&
      Number.isInteger(reward.place) &&
      reward.place >= 1 &&
      reward.place <= 5 &&
      Number.isInteger(reward.amount) &&
      reward.amount >= 1 &&
      reward.amount <= (item_is_stackable(item.category) ? 10 : 1)
    )
  })

export const TournamentSettingsForm = ({
  admin,
  draft,
  change,
  disabled,
  now,
  review,
  t,
}: Readonly<{
  admin: string
  draft: TournamentDraft
  change: (draft: TournamentDraft) => void
  disabled: boolean
  now: number | null
  review: (settings: TournamentSettings) => void
  t: CopyText
}>) => {
  const { name, format, deadline, entry_fee, level_limit, sui, kares, rewards } = draft
  const sui_bps = parse_prize_percentages(sui)
  const token_bps = parse_prize_percentages(kares)
  const start_before_ms = Date.parse(deadline)
  const entry_fee_mist = parse_kolizeum_pledge(entry_fee)
  const max_level = parse_level_limit(level_limit)
  const valid = [
    name.trim().length > 0,
    new TextEncoder().encode(name.trim()).length <= 80,
    now !== null,
    start_before_ms > (now ?? Infinity),
    sui_bps !== null,
    token_bps !== null,
    valid_tournament_rewards(rewards),
    entry_fee_mist !== null,
    max_level !== undefined,
    (entry_fee_mist ?? 0n) < 1n << 64n,
    /^0x[\da-f]{1,64}$/i.test(admin),
  ].every(Boolean)
  const minimum = sui_bps && token_bps ? minimum_tournament_teams({ sui_bps, token_bps, rewards }) : null
  return (
    <>
      <div className="tourney-admin-grid">
        <section className="tourney-admin-column">
          <h3>{t('organizer_event')}</h3>
          <label className="aui-field">
            {t('name')}
            <input maxLength={80} value={name} onChange={(e) => change({ ...draft, name: e.target.value })} />
          </label>
          <label className="aui-field tourney-admin-format">
            {t('format')}
            <select value={format} onChange={(e) => change({ ...draft, format: Number(e.target.value) as 1 | 3 | 6 })}>
              {[1, 3, 6].map((size) => (
                <option value={size} key={size}>
                  {size}v{size}
                </option>
              ))}
            </select>
          </label>
          <label className="aui-field">
            {t('deadline')}
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => change({ ...draft, deadline: e.target.value })}
            />
          </label>
          <small>{t('timezone', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</small>
          <p className="tourney-note">{t('latest_start_notice')}</p>
          <label className="aui-field">
            {t('entry_fee_label')}
            <input
              inputMode="decimal"
              value={entry_fee}
              onChange={(event) => change({ ...draft, entry_fee: event.target.value })}
            />
          </label>
          <p className="tourney-note">{t('entry_fee_setting')}</p>
          <label className="aui-field">
            {t('level_limit_label')}
            <input
              type="number"
              min={1}
              max={MAX_LEVEL}
              step={1}
              placeholder={t('level_unrestricted')}
              value={level_limit}
              onChange={(event) => change({ ...draft, level_limit: event.target.value })}
            />
          </label>
          <p className="tourney-note">{t('level_limit_notice')}</p>
        </section>
        <PrizeSplit
          sui={sui}
          kares={kares}
          set_sui={(sui) => change({ ...draft, sui })}
          set_kares={(kares) => change({ ...draft, kares })}
          t={t}
        />
        <RewardSettings rewards={rewards} change={(rewards) => change({ ...draft, rewards })} t={t} />
      </div>
      <div className="tourney-admin-review tourney-create-summary">
        {entry_fee_mist !== null && <TournamentEntryFee amount={entry_fee_mist} t={t} />}
        <p>{minimum === null ? t('invalid_percentage') : t('minimum_teams', { count: minimum })}</p>
        <p className="tourney-note">{t('minimum_notice')}</p>
        <p className="tourney-note">{t('immutable_notice')}</p>
        <Button
          tone="primary"
          disabled={disabled || !valid}
          onClick={() => {
            if (valid && sui_bps && token_bps)
              review({
                admin,
                name: name.trim(),
                format,
                start_before_ms,
                entry_fee_mist: entry_fee_mist!,
                max_level: max_level!,
                sui_bps,
                token_bps,
                rewards,
              })
          }}
        >
          {t('create_event')}
        </Button>
      </div>
    </>
  )
}
