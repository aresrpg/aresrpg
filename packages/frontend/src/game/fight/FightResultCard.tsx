// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Button } from '@aresrpg/ui'

import { useNumbers } from '../../i18n/useNumbers.ts'

import { useText } from '../../i18n/useText.ts'

import { Text } from '../../i18n/Text.tsx'
import { KaresLogo } from '../../components/KaresLogo.tsx'

import type { SeedItem } from '../../content/catalog.ts'
import { type AppCopy } from '../../i18n/copy.ts'
import {
  fight_result_available,
  fight_result_complete,
  fight_result_surface,
  format_fight_duration,
  kolizeum_wager_outcome,
  result_participant_shows_progress,
  result_xp_progress,
  type FightResult,
  type ResultParticipant,
} from '../../modules/fight_result.ts'
import { fight_result_error_text } from '../../modules/fight_result_error.ts'
import {
  fight_level_up_visible,
  fight_settlement_progress,
  type FightSettlementProgress,
} from '../../modules/fight_result_view.ts'
import { dispatch_app, useAppStore, type AppState } from '../../store.ts'

import { FightLoot } from './FightLoot.tsx'

import { CharacterLevelUpView } from './CharacterLevelUpView.tsx'
import './fight_result.css'

const text_of = (copy: AppCopy, key: string): string => copy.fight_hud[key] ?? key
const selected_result = (state: AppState, supplied?: FightResult | null) => {
  if (supplied !== undefined) return supplied
  const character_id = state.session.selected_character_id
  return character_id ? (state.fight_result.current_by_character[character_id] ?? null) : null
}

const WAGER_PREFIX = Object.freeze({ won: '+', lost: '-', even: '' })
type SettlementView = Readonly<{
  progress: FightSettlementProgress
  failed_result: FightResult | null
  all_settled: boolean
  failed: boolean
}>

const failed_settlement_result = (
  results: Readonly<Record<string, FightResult>>,
  character_id: string | null
): FightResult | null => (character_id ? (results[character_id] ?? null) : null)

const settlements_complete = ({ completed, total }: FightSettlementProgress): boolean =>
  total === 0 || completed === total

const settlement_failed = (result: FightResult | null): boolean => result?.error !== null && result?.error !== undefined

const settlement_view = (
  results: Readonly<Record<string, FightResult>>,
  result: FightResult | null
): SettlementView => {
  const progress = fight_settlement_progress(results, result?.fight ?? '')
  const failed_result = failed_settlement_result(results, progress.failed_character)
  return Object.freeze({
    progress,
    failed_result,
    all_settled: settlements_complete(progress),
    failed: settlement_failed(failed_result),
  })
}

const collection_complete = (result: FightResult | null, settlement: SettlementView): boolean =>
  fight_result_complete(result) && settlement.all_settled

const settlement_text = (copy: AppCopy, settlement: SettlementView): string => {
  const { progress } = settlement
  const label = progress.failed_character
    ? text_of(copy, 'result_collecting_failed')
    : settlement.all_settled
      ? text_of(copy, 'result_collecting_complete')
      : text_of(copy, 'result_collecting_progress')
  return label.replace('{completed}', String(progress.completed)).replace('{total}', String(progress.total))
}

export const FightSettlementStatus = ({
  copy,
  settlement,
}: Readonly<{ copy: AppCopy; settlement: SettlementView }>) => {
  const { progress, failed_result } = settlement
  if (progress.total === 0) return null
  const label = settlement_text(copy, settlement)
  const retry = (): void => {
    if (progress.failed_character) dispatch_app({ type: 'fight_result/retry', character_id: progress.failed_character })
  }
  return (
    <>
      <div className={`fe-settlement${settlement.failed ? ' failed' : settlement.all_settled ? ' complete' : ''}`}>
        <div className="fe-settlement__label">
          <span>{label}</span>
          <b>
            {progress.completed}/{progress.total}
          </b>
        </div>
        <div
          aria-label={label}
          aria-valuemax={progress.total}
          aria-valuemin={0}
          aria-valuenow={progress.completed}
          className="fe-settlement__bar"
          role="progressbar"
        >
          <span style={{ width: `${(progress.completed / progress.total) * 100}%` }} />
        </div>
      </div>
      {failed_result?.error && (
        <div className="fe-error">
          <span>{fight_result_error_text(copy.fight_hud, failed_result.error, copy.kares_page)}</span>
          <button onClick={retry} type="button">
            {text_of(copy, 'result_retry')}
          </button>
        </div>
      )}
    </>
  )
}

const WagerFact = ({ copy, wager }: Readonly<{ copy: AppCopy; wager: FightResult['kolizeum_wager'] }>) => {
  const localized_numbers = useNumbers()
  const outcome = kolizeum_wager_outcome(wager)
  if (!outcome) return null
  return (
    <div className="fe-fact fe-fact--wager">
      <span>{text_of(copy, `result_wager_${outcome.kind}`)}</span>
      <b>
        {WAGER_PREFIX[outcome.kind]}
        {localized_numbers.sui(outcome.mist, 3)} SUI
      </b>
    </div>
  )
}

const ResultRow = ({
  participant,
  enemy,
  defeated,
  copy,
  item_ids,
  items,
}: Readonly<{
  copy: AppCopy
  item_ids?: readonly string[]
  items?: readonly SeedItem[]
  participant: ResultParticipant
  enemy: boolean
  defeated: boolean
}>) => {
  const numbers = useNumbers()
  const ui = useText()
  const alive = !participant.dead && !defeated
  const state = alive ? 'alive' : enemy ? 'defeated' : 'dead'
  const shows_progress = result_participant_shows_progress(participant)
  const { base_percent, gained_percent, into, span } = result_xp_progress(
    participant.experience_before,
    participant.experience_after
  )
  return (
    <div className={`fe-row fe-row--${state}${shows_progress ? '' : ' fe-row--no-progress'}`}>
      <div className="fe-row__name">
        <span className="fe-row__nametext">{participant.name}</span>
        <span className="fe-row__meta">
          <Text path="encyclopedia_page.level_short" values={{ level: participant.level_after }} />
        </span>
      </div>
      {shows_progress && (
        <>
          <div
            className="fe-xp"
            aria-label={`${participant.experience_before} ${ui('ui.experience_gain', { amount: participant.xp_awarded, unit: ui('ui.xp') })}`}
          >
            <span className="fe-xp__base" style={{ width: `${base_percent}%` }} />
            <span className="fe-xp__gain" style={{ left: `${base_percent}%`, width: `${gained_percent}%` }} />
          </div>
          <span className="fe-xp-next">
            {span === 0
              ? ui('ui.experience_max')
              : ui('ui.vitals', { current: numbers.compact(into), maximum: numbers.compact(span), unit: ui('ui.xp') })}
          </span>
          <span className="fe-gain">
            +{numbers.compact(participant.xp_awarded)} <Text path="ui.xp" />
          </span>
        </>
      )}
      <div className="fe-tiles">
        {participant.kares > 0n && (
          <div aria-label="KARES" className="fe-tile">
            <KaresLogo size={32} />
            <span className="fe-tile__qty">×{numbers.amount(participant.kares)}</span>
            <span className="fe-tile__tooltip" role="tooltip">
              KARES
            </span>
          </div>
        )}
        {participant.loot.slice(0, 8).map((loot) => (
          <FightLoot key={loot.item_type} loot={loot} copy={copy} items={items} item_ids={item_ids} />
        ))}
      </div>
    </div>
  )
}

export const FightResultCard = ({
  copy,
  result: supplied_result,
  on_close,
  items,
}: Readonly<{ copy: AppCopy; result?: FightResult | null; on_close?: () => void; items?: readonly SeedItem[] }>) => {
  const localized_numbers = useNumbers()
  const result = useAppStore((state) => selected_result(state, supplied_result))
  const fight = useAppStore((state) => state.fight)
  const results = useAppStore((state) => state.fight_result.current_by_character)
  const characters = useAppStore((state) => state.session.characters)
  const selected_character_id = useAppStore((state) => state.session.selected_character_id)
  const available = !result || fight_result_available(fight, result.fight)
  const surface = result ? fight_result_surface(result) : null
  const settlement = settlement_view(results, result)
  const complete = collection_complete(result, settlement)
  const { failed } = settlement
  const own = !result || result.own_seat === null ? null : result.participants[result.own_seat]
  const victory = result ? (own ? result.winner === own.team : result.winner !== null) : false
  if (!result || !available || surface !== 'result') return null

  const own_team = own?.team ?? result.winner ?? 0
  const party = result.participants.filter(({ team }) => team === own_team)
  const enemies = result.participants.filter(({ team }) => team !== own_team)
  const verdict = text_of(copy, victory ? 'result_victory' : 'result_defeat')
  const close = (): void => {
    if (on_close) return on_close()
    // A local-lab result has no roster seat; selection still names its result owner.
    const character_id = own?.character_id ?? selected_character_id
    if (character_id) dispatch_app({ type: 'fight_result/closed', character_id })
  }
  return (
    <>
      <section className="fe-stage" aria-label={verdict} aria-modal="true" role="dialog">
        <div className={`aui-window result result--fe ${victory ? 'fe--win' : 'fe--loss'}`}>
          <div className="aui-window-header fe-head">
            <div className="fe-title">{verdict}</div>
            <div className="fe-sub">
              {text_of(copy, 'result_title')} · {verdict}
            </div>
          </div>
          <div className="fe-divider" aria-hidden="true">
            ◇
          </div>
          <div className="fe-facts">
            <div className="fe-fact">
              <span>{text_of(copy, 'result_duration')}</span>
              <b>{result.duration_ms === null ? '—' : format_fight_duration(result.duration_ms)}</b>
            </div>
            <div className="fe-fact">
              <span>{text_of(copy, 'result_gas_spent')}</span>
              <b>
                {result.gas_spent_mist < 0n ? '-' : ''}
                {localized_numbers.sui(
                  result.gas_spent_mist < 0n ? -result.gas_spent_mist : result.gas_spent_mist,
                  3
                )}{' '}
                SUI
              </b>
            </div>
            <WagerFact copy={copy} wager={result.kolizeum_wager} />
          </div>
          <div className="fe-sec">
            <div className="fe-lbl">
              <span>{text_of(copy, 'result_party')}</span>
              <span>{party.length}</span>
            </div>
            <div className="fe-rows fe-rows--party">
              {party.map((participant) => {
                const receipt =
                  participant.character_id === own?.character_id ? result : results[participant.character_id ?? '']
                const item_ids = receipt?.fight === result.fight ? receipt.loot_item_ids : undefined
                return (
                  <ResultRow
                    items={items}
                    copy={copy}
                    item_ids={
                      characters.some(({ id }) => id === participant.character_id) ? (item_ids ?? []) : undefined
                    }
                    defeated={false}
                    enemy={false}
                    key={participant.seat}
                    participant={participant}
                  />
                )
              })}
            </div>
          </div>
          {enemies.length > 0 && (
            <div className="fe-sec">
              <div className="fe-lbl">
                <span>{text_of(copy, 'result_enemies')}</span>
                <span>{enemies.length}</span>
              </div>
              <div className="fe-rows">
                {enemies.map((participant) => (
                  <ResultRow
                    items={items}
                    copy={copy}
                    defeated={victory}
                    enemy
                    key={participant.seat}
                    participant={participant}
                  />
                ))}
              </div>
            </div>
          )}
          <FightSettlementStatus copy={copy} settlement={settlement} />
          <div className="fe-cta">
            <Button tone="primary" disabled={!complete && !failed} onClick={close}>
              {text_of(copy, failed ? 'result_close' : complete ? 'result_continue' : 'result_collecting')}
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}

export const FightLevelUpCard = ({
  copy,
  result: supplied_result,
  on_acknowledge,
  on_allocate,
  can_allocate,
}: Readonly<{
  copy: AppCopy
  result?: FightResult | null
  on_acknowledge?: () => void
  on_allocate?: () => void
  can_allocate?: boolean
}>) => {
  const result = useAppStore((state) => selected_result(state, supplied_result))
  const fight = useAppStore((state) => state.fight)
  const characters = useAppStore(({ session }) => session.characters)
  const own = result && result.own_seat !== null ? result.participants[result.own_seat] : null
  const visible = Boolean(result && fight_result_available(fight, result.fight) && fight_level_up_visible(result))
  if (!result || !own || !visible) return null
  const character = characters.find(({ id }) => id === own.character_id) ?? { classe: '' }
  const acknowledge = (): void => {
    if (on_acknowledge) return on_acknowledge()
    if (own.character_id) dispatch_app({ type: 'fight_result/level_acknowledged', character_id: own.character_id })
  }
  const allocate = (): void => {
    if (on_allocate) return on_allocate()
    acknowledge()
    if (own.character_id) dispatch_app({ type: 'character/select', character_id: own.character_id })
    dispatch_app({ type: 'dialog/open', dialog: 'character_stats' })
  }
  return (
    <CharacterLevelUpView
      copy={copy}
      name={own.name}
      classe={character.classe}
      before={own.level_before}
      after={own.level_after}
      close={acknowledge}
      allocate={can_allocate === false ? undefined : allocate}
    />
  )
}
