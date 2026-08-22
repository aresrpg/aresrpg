// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Direct port of deprecated/FightReport + LevelUp. Data adapters live here; the locked visual
// structure and CSS remain recognizable instead of being reinterpreted in utility classes.

import { useEffect, type CSSProperties } from 'react'

import { item_icon, spell_icon } from '../../content/assets.ts'
import { content_catalog, titleize } from '../../content/catalog.ts'
import type { AppCopy } from '../../i18n/copy.ts'
import {
  fight_result_available,
  fight_result_complete,
  fight_result_surface,
  result_participant_shows_progress,
  result_xp_progress,
  type ResultParticipant,
} from '../../modules/fight_result.ts'
import { dispatch_app, useAppStore } from '../../store.ts'
import { play_procedural_cue } from '../audio/procedural_cues.ts'

import './fight_result.css'

const text_of = (copy: AppCopy, key: string): string => copy.fight_hud[key] ?? key
const initial = (name: string): string => name.trim()[0]?.toUpperCase() ?? '?'

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
          <span className="fe-xp-next">
            {span === 0 ? 'MAX' : `${into.toLocaleString()} / ${span.toLocaleString()} XP`}
          </span>
          <span className="fe-gain">+{participant.xp_awarded.toLocaleString()} XP</span>
        </>
      )}
      <div className="fe-tiles">
        {participant.loot.slice(0, 8).map((loot) => (
          <div className="fe-tile" key={loot.item_type} title={loot.item_type.replaceAll('_', ' ')}>
            {item_icon(loot.item_type) ? (
              <img alt="" className="item-icon" src={item_icon(loot.item_type)!} />
            ) : (
              <span className="fe-tile__letter">{initial(loot.item_type)}</span>
            )}
            <span className="fe-tile__qty">×{loot.qty}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export const FightResultCard = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const result_state = useAppStore(({ fight_result }) => fight_result)
  const fight = useAppStore((state) => state.fight)
  const result = result_state.current
  const available = !result || fight_result_available(fight, result.fight)
  const surface = result ? fight_result_surface(result) : null
  const complete = fight_result_complete(result_state)
  const own = !result || result.own_seat === null ? null : result.participants[result.own_seat]
  const victory = result ? (own ? result.winner === own.team : result.winner !== null) : false
  const fight_id = result?.fight ?? null
  useEffect(() => {
    if (fight_id && available && surface === 'result') play_procedural_cue(victory ? 'victory' : 'defeat')
  }, [available, fight_id, surface, victory])
  if (!result || !available || !result.result_open) return null

  const own_team = own?.team ?? result.winner ?? 0
  const party = result.participants.filter(({ team }) => team === own_team)
  const enemies = result.participants.filter(({ team }) => team !== own_team)
  const verdict = text_of(copy, victory ? 'result_victory' : 'result_defeat')
  const close = (): void => {
    dispatch_app({ type: 'fight/watch', fight: null })
    dispatch_app({ type: 'fight_result/closed' })
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
        <div className="fe-sec">
          <div className="fe-lbl">
            <span>{text_of(copy, 'result_party')}</span>
            <span>{party.length}</span>
          </div>
          <div className={`fe-rows${party.length > 4 ? ' fe-rows--grid' : ''}`}>
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
            <div className={`fe-rows${enemies.length > 4 ? ' fe-rows--grid' : ''}`}>
              {enemies.map((participant) => (
                <ResultRow defeated={victory} enemy key={participant.seat} participant={participant} />
              ))}
            </div>
          </div>
        )}
        {result.error && (
          <div className="fe-error">
            <span>{result.error}</span>
            <button onClick={() => dispatch_app({ type: 'fight_result/retry' })} type="button">
              {text_of(copy, 'result_retry')}
            </button>
          </div>
        )}
        <div className="fe-cta">
          <button disabled={!complete} onClick={close} type="button">
            {text_of(copy, complete ? 'result_continue' : 'result_collecting')}
          </button>
        </div>
      </div>
    </section>
  )
}

export const FightLevelUpCard = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const result = useAppStore(({ fight_result }) => fight_result.current)
  const characters = useAppStore(({ session }) => session.characters)
  const own = result && result.own_seat !== null ? result.participants[result.own_seat] : null
  const visible = Boolean(result?.level_up_open && own && own.level_after > own.level_before)
  useEffect(() => {
    if (visible) play_procedural_cue('level_up')
  }, [result?.fight, own?.level_after, visible])
  if (!result || !own || !visible) return null
  const levels_gained = own.level_after - own.level_before
  const character = characters.find(({ id }) => id === own.character_id)
  const classe = character?.classe ?? ''
  const unlocked_spell = content_catalog.spells
    .filter(
      (spell) =>
        spell.classe === classe && spell.unlock_level > own.level_before && spell.unlock_level <= own.level_after
    )
    .toSorted((left, right) => right.unlock_level - left.unlock_level)[0]
  const acknowledge = (): void => dispatch_app({ type: 'fight_result/level_acknowledged' })
  return (
    <section className="lvlup-stage" aria-label={text_of(copy, 'level_up_title')} aria-modal="true" role="dialog">
      <div className="result result--fe result--level-up radiant">
        <svg aria-hidden="true" height="0" width="0">
          <defs>
            <symbol id="fight-level-filigree" viewBox="0 0 64 64">
              <path d="M6 48V16Q6 6 16 6h32" fill="none" stroke="currentColor" strokeLinecap="round" />
              <path d="M6 30q13 0 13-13Q19 6 6 6" fill="none" opacity="0.7" stroke="currentColor" />
              <path d="m6 1 5 5-5 5-5-5Z" fill="currentColor" />
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
            ['-168px', '-108px'],
            ['172px', '-96px'],
            ['198px', '-4px'],
            ['-196px', '20px'],
            ['-120px', '138px'],
            ['130px', '148px'],
          ].map(([x, y], index) => (
            <span
              aria-hidden="true"
              className={`rad-spark${index % 2 ? ' rad-spark--em' : ''}`}
              key={`${x}:${y}`}
              style={{ '--x': x, '--y': y, '--d': `${420 + index * 35}ms` } as CSSProperties}
            />
          ))}
          <div className="rad-numwrap">
            <span className="rad-pre">{text_of(copy, 'level_up_reached')}</span>
            <div className="rad-num" data-level={own.level_after}>
              {own.level_after}
            </div>
          </div>
        </div>
        <div className="lvlcap">{classe ? titleize(classe) : own.name}</div>
        <hr className="lvl-hr" />
        <div className="lvl-rewards">
          <div className="lvl-reward">
            <span aria-hidden="true">✦</span>
            <b>+{levels_gained * 5}</b>
            <small>{text_of(copy, 'level_up_stat_points')}</small>
          </div>
          <div className="lvl-reward">
            <span aria-hidden="true">✧</span>
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
              <strong>{unlocked_spell.name}</strong>
            </div>
            <b>{unlocked_spell.levels[0]?.ap_cost ?? 0} AP</b>
          </div>
        )}
        <div className="fe-cta lvl-cta">
          <button onClick={acknowledge} type="button">
            {text_of(copy, 'level_up_continue')}
          </button>
        </div>
      </div>
    </section>
  )
}
