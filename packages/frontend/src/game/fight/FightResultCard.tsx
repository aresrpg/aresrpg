// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Direct port of deprecated/FightReport + LevelUp. Data adapters live here; the locked visual
// structure and CSS remain recognizable instead of being reinterpreted in utility classes.

import { useEffect, type CSSProperties } from 'react'

import { item_icon, spell_icon } from '../../content/assets.ts'
import { content_catalog, titleize } from '../../content/catalog.ts'
import { spell_name, type AppCopy } from '../../i18n/copy.ts'
import {
  compact_xp,
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
import { fight_settlement_progress, type FightSettlementProgress } from '../../modules/fight_result_view.ts'
import { dispatch_app, useAppStore, type AppState } from '../../store.ts'
import { format_sui } from '../../wallet_amount.ts'
import { play_procedural_cue } from '../audio/procedural_cues.ts'

import './fight_result.css'

const text_of = (copy: AppCopy, key: string): string => copy.fight_hud[key] ?? key
const initial = (name: string): string => name.trim()[0]?.toUpperCase() ?? '?'
const selected_result = (state: AppState) => {
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

const FightSettlementStatus = ({ copy, settlement }: Readonly<{ copy: AppCopy; settlement: SettlementView }>) => {
  const { progress, failed_result } = settlement
  if (progress.total <= 1) return null
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
          <span>{fight_result_error_text(copy.fight_hud, failed_result.error)}</span>
          <button onClick={retry} type="button">
            {text_of(copy, 'result_retry')}
          </button>
        </div>
      )}
    </>
  )
}

const WagerFact = ({ copy, wager }: Readonly<{ copy: AppCopy; wager: FightResult['kolizeum_wager'] }>) => {
  const outcome = kolizeum_wager_outcome(wager)
  if (!outcome) return null
  return (
    <div className="fe-fact fe-fact--wager">
      <span>{text_of(copy, `result_wager_${outcome.kind}`)}</span>
      <b>
        {WAGER_PREFIX[outcome.kind]}
        {format_sui(outcome.mist, 3)} SUI
      </b>
    </div>
  )
}

const ResultRow = ({
  participant,
  enemy,
  defeated,
}: Readonly<{
  participant: ResultParticipant
  enemy: boolean
  defeated: boolean
}>) => {
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
        <span className="fe-row__meta">LV {participant.level_after}</span>
      </div>
      {shows_progress && (
        <>
          <div className="fe-xp" aria-label={`${participant.experience_before} + ${participant.xp_awarded} XP`}>
            <span className="fe-xp__base" style={{ width: `${base_percent}%` }} />
            <span className="fe-xp__gain" style={{ left: `${base_percent}%`, width: `${gained_percent}%` }} />
          </div>
          <span className="fe-xp-next">{span === 0 ? 'MAX' : `${compact_xp(into)} / ${compact_xp(span)} XP`}</span>
          <span className="fe-gain">+{compact_xp(participant.xp_awarded)} XP</span>
        </>
      )}
      <div className="fe-tiles">
        {participant.loot.slice(0, 8).map((loot) => {
          const item_name = content_catalog.item(loot.item_type)?.item.name ?? titleize(loot.item_type)
          return (
            <div aria-label={item_name} className="fe-tile" key={loot.item_type}>
              {item_icon(loot.item_type) ? (
                <img alt="" className="item-icon" src={item_icon(loot.item_type)!} />
              ) : (
                <span className="fe-tile__letter">{initial(loot.item_type)}</span>
              )}
              <span className="fe-tile__qty">×{loot.qty}</span>
              <span className="fe-tile__tooltip" role="tooltip">
                {item_name}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export const FightResultCard = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const result = useAppStore(selected_result)
  const fight = useAppStore((state) => state.fight)
  const results = useAppStore((state) => state.fight_result.current_by_character)
  const selected_character_id = useAppStore((state) => state.session.selected_character_id)
  const available = !result || fight_result_available(fight, result.fight)
  const surface = result ? fight_result_surface(result) : null
  const settlement = settlement_view(results, result)
  const complete = collection_complete(result, settlement)
  const { failed } = settlement
  const own = !result || result.own_seat === null ? null : result.participants[result.own_seat]
  const victory = result ? (own ? result.winner === own.team : result.winner !== null) : false
  const fight_id = result?.fight ?? null
  useEffect(() => {
    if (fight_id && available && surface === 'result') play_procedural_cue(victory ? 'victory' : 'defeat')
  }, [available, fight_id, surface, victory])
  if (!result || !available || surface !== 'result') return null

  const own_team = own?.team ?? result.winner ?? 0
  const party = result.participants.filter(({ team }) => team === own_team)
  const enemies = result.participants.filter(({ team }) => team !== own_team)
  const verdict = text_of(copy, victory ? 'result_victory' : 'result_defeat')
  const close = (): void => {
    // A local-lab result has no roster seat; selection still names its result owner.
    const character_id = own?.character_id ?? selected_character_id
    if (character_id) dispatch_app({ type: 'fight_result/closed', character_id })
  }
  return (
    <section className="fe-stage" aria-label={verdict} aria-modal="true" role="dialog">
      <div className={`result result--fe ${victory ? 'fe--win' : 'fe--loss'}`}>
        <div className="fe-head">
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
              {format_sui(result.gas_spent_mist < 0n ? -result.gas_spent_mist : result.gas_spent_mist, 3)} SUI
            </b>
          </div>
          <WagerFact copy={copy} wager={result.kolizeum_wager} />
        </div>
        <div className="fe-sec">
          <div className="fe-lbl">
            <span>{text_of(copy, 'result_party')}</span>
            <span>{party.length}</span>
          </div>
          <div className="fe-rows">
            {party.map((participant) => (
              <ResultRow defeated={false} enemy={false} key={participant.seat} participant={participant} />
            ))}
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
                <ResultRow defeated={victory} enemy key={participant.seat} participant={participant} />
              ))}
            </div>
          </div>
        )}
        <FightSettlementStatus copy={copy} settlement={settlement} />
        <div className="fe-cta">
          <button disabled={!complete && !failed} onClick={close} type="button">
            {text_of(copy, failed ? 'result_close' : complete ? 'result_continue' : 'result_collecting')}
          </button>
        </div>
      </div>
    </section>
  )
}

export const FightLevelUpCard = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const result = useAppStore(selected_result)
  const fight = useAppStore((state) => state.fight)
  const characters = useAppStore(({ session }) => session.characters)
  const own = result && result.own_seat !== null ? result.participants[result.own_seat] : null
  const visible = Boolean(
    result?.level_up_open && fight_result_available(fight, result.fight) && own && own.level_after > own.level_before
  )
  useEffect(() => {
    if (visible) play_procedural_cue('level_up')
  }, [result?.fight, own?.level_after, visible])
  if (!result || !own || !visible) return null
  const levels_gained = own.level_after - own.level_before
  const character = characters.find(({ id }) => id === own.character_id)
  const classe = character?.classe ?? ''
  const class_name = classe ? titleize(classe) : own.name
  const class_title = classe ? copy.simulator_page[`class_${classe}_title`] : null
  const unlocked_spell = content_catalog.spells
    .filter(
      (spell) =>
        spell.classe === classe && spell.unlock_level > own.level_before && spell.unlock_level <= own.level_after
    )
    .toSorted((left, right) => right.unlock_level - left.unlock_level)[0]
  const unlocked_worlds = content_catalog.worlds.filter(
    ({ entry_level }) => entry_level > own.level_before && entry_level <= own.level_after
  )
  const acknowledge = (): void => {
    if (own.character_id) dispatch_app({ type: 'fight_result/level_acknowledged', character_id: own.character_id })
  }
  const allocate = (): void => {
    acknowledge()
    if (own.character_id) dispatch_app({ type: 'character/select', character_id: own.character_id })
    dispatch_app({ type: 'path/open', pathname: '/characters/stats' })
  }
  return (
    <section className="lvlup-stage" aria-label={text_of(copy, 'level_up_title')} aria-modal="true" role="dialog">
      <div className="result result--fe result--level-up radiant">
        <svg aria-hidden="true" height="0" width="0">
          <defs>
            <symbol id="fight-level-filigree" viewBox="0 0 64 64">
              <path
                d="M6 48 6 16Q6 6 16 6h32"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.15"
              />
              <path d="M6 30q13 0 13-13Q19 6 6 6" fill="none" opacity="0.7" stroke="currentColor" strokeWidth="0.9" />
              <path d="m6 1 5 5-5 5-5-5Z" fill="currentColor" />
              <circle cx="48" cy="6" fill="currentColor" r="1.7" />
              <circle cx="6" cy="48" fill="currentColor" r="1.7" />
            </symbol>
          </defs>
        </svg>
        {['tl', 'tr', 'bl', 'br'].map((corner) => (
          <svg aria-hidden="true" className={`rad-crn rad-crn--${corner}`} key={corner} viewBox="0 0 64 64">
            <use href="#fight-level-filigree" />
          </svg>
        ))}
        <div className="lvllabel">{text_of(copy, 'level_up_title')}</div>
        <div className="lvlhero">
          <div aria-hidden="true" className="rad-rays" />
          <div aria-hidden="true" className="rad-glow" />
          {[
            ['-168px', '-108px', '420ms'],
            ['172px', '-96px', '460ms'],
            ['198px', '-4px', '500ms'],
            ['-196px', '20px', '540ms'],
            ['-120px', '138px', '460ms'],
            ['130px', '148px', '500ms'],
            ['4px', '-172px', '580ms'],
          ].map(([x, y, delay], index) => (
            <span
              aria-hidden="true"
              className={`rad-spark${index % 2 ? ' rad-spark--em' : ''}`}
              key={`${x}:${y}`}
              style={{ '--x': x, '--y': y, '--d': delay } as CSSProperties}
            />
          ))}
          <div className="rad-numwrap">
            <span className="rad-pre">{text_of(copy, 'level_up_reached')}</span>
            <div className="rad-num" data-level={own.level_after}>
              {own.level_after}
            </div>
          </div>
        </div>
        <div className="lvlcap">
          {class_name}
          {class_title && class_title !== class_name ? ` · ${class_title}` : ''}
        </div>
        <hr className="lvl-hr" />
        <div className="lvl-rewards">
          <div className="lvl-reward">
            <svg aria-hidden="true" className="lvl-reward__icon" fill="currentColor" viewBox="0 0 24 24">
              <path d="m12 2 2.6 6.9L21 10l-5.2 4.2 1.8 6.8-5.6-3.9L6.4 21l1.8-6.8L3 10l6.4-1.1Z" />
            </svg>
            <b>+{levels_gained * 5}</b>
            <small>{text_of(copy, 'level_up_stat_points')}</small>
          </div>
          <div className="lvl-reward">
            <svg aria-hidden="true" className="lvl-reward__icon" fill="currentColor" viewBox="0 0 24 24">
              <path d="m12 2 1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6Z" />
            </svg>
            <b>+{levels_gained}</b>
            <small>{text_of(copy, 'level_up_spell_points')}</small>
          </div>
        </div>
        {unlocked_spell && (
          <div className="lvl-unlock">
            <div className="lvl-unlock__well">
              {spell_icon(unlocked_spell.classe, unlocked_spell.name) ? (
                <img alt="" src={spell_icon(unlocked_spell.classe, unlocked_spell.name)!} />
              ) : (
                <span aria-hidden="true">✦</span>
              )}
            </div>
            <div>
              <small>{text_of(copy, 'level_up_new_spell')}</small>
              <strong>{spell_name(copy, unlocked_spell.name)}</strong>
              <span className="lvl-unlock__meta">{titleize(unlocked_spell.classe)}</span>
            </div>
            <b>{unlocked_spell.levels[0]?.ap_cost ?? 0} AP</b>
          </div>
        )}
        {unlocked_worlds.length > 0 && (
          <div className="lvl-unlock">
            <div className="lvl-unlock__well">
              <svg aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18" />
              </svg>
            </div>
            <div>
              <small>{text_of(copy, 'level_up_new_worlds')}</small>
              <strong>{unlocked_worlds.map(({ world }) => titleize(world)).join(' · ')}</strong>
              <span className="lvl-unlock__meta">{text_of(copy, 'level_up_worlds_note')}</span>
            </div>
          </div>
        )}
        <div className="fe-cta lvl-cta">
          <button className="lvl-cta__allocate" onClick={allocate} type="button">
            {text_of(copy, 'level_up_allocate')}
          </button>
          <button className="lvl-cta__later" onClick={acknowledge} type="button">
            {text_of(copy, 'level_up_later')}
          </button>
        </div>
      </div>
    </section>
  )
}
