// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  characteristic_allocation_quote,
  characteristic_cost_step,
  characteristic_names,
  type CharacteristicValues,
} from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'
import { Button, ProgressBar, vital_art } from '@aresrpg/ui'

import { character_icon } from '../content/assets.ts'
import { titleize } from '../content/catalog.ts'
import { action_points, equipment_bonus, movement_points } from '../game/character_stats.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { stat_identities } from '../visual_identity.ts'

import { useStats } from './useStats.ts'

export default function StatsTab({
  character,
  copy,
  raise_stats,
}: Readonly<{
  character: Readonly<CharacterRow>
  copy: AppCopy
  raise_stats?: (spending: CharacteristicValues) => void
}>) {
  const {
    t,
    numbers,
    alloc,
    set_alloc,
    reset,
    pending_tx,
    locked,
    classe,
    current,
    quote,
    remaining,
    has_pending,
    can_confirm,
    max_health,
    health,
    confirm,
    into,
    span,
    percent,
  } = useStats({ character, copy, raise_stats })
  return (
    <section className="aui-character-sheet" data-tutorial-target="character_stats">
      <header className="aui-character-identity">
        <span className="aui-character-portrait">
          <img src={character_icon(character.classe, character.sex) ?? undefined} alt="" />
        </span>
        <div>
          <h2>{character.name}</h2>
          <p>
            {titleize(character.classe)} · {t('stats.level', { level: character.level })}
          </p>
        </div>
      </header>
      <div className="aui-character-vitals">
        <div>
          <img src={vital_art.health} alt="" />
          <span>{t('stats.health')}</span>
          <strong>
            {health}
            <small> / {max_health}</small>
          </strong>
        </div>
        <div>
          <img src={vital_art.action} alt="" />
          <span>{t('stats.action')}</span>
          <strong>{action_points(character)}</strong>
        </div>
        <div>
          <img src={vital_art.movement} alt="" />
          <span>{t('stats.move')}</span>
          <strong>{movement_points(character)}</strong>
        </div>
      </div>
      <div className="aui-character-experience">
        <ProgressBar
          label={t('common.experience')}
          value={percent}
          max={100}
          detail={
            span === 0
              ? `${numbers.number(Number(character.experience))} ${copy.ui.xp} · ${copy.ui.experience_max}`
              : `${numbers.number(into)} / ${numbers.number(span)} ${copy.ui.xp}`
          }
        />
      </div>
      <div className="aui-character-statistics">
        <h3>{t('stats.characteristics')}</h3>
        <div className="aui-attribute-list">
          {characteristic_names.map((stat) => {
            const label = t(`stat.${stat}`)
            const gain = quote?.gains[stat] ?? 0
            const bonus = equipment_bonus(character, stat)
            const { step, next } = classe
              ? {
                  step: characteristic_cost_step(classe, stat, character[stat] + gain),
                  next: characteristic_allocation_quote(classe, current, { ...alloc, [stat]: alloc[stat] + 1 }),
                }
              : { step: null, next: null }
            return (
              <div className="aui-attribute-row" key={stat} data-stat={stat}>
                <img src={stat_identities[stat].icon} alt="" />
                <div className="aui-attribute-copy">
                  <div className="aui-attribute-title">
                    <strong>{label}</strong>
                    <small>{step && t('stats.point_cost', { cost: step.cost, gain: step.gain })}</small>
                  </div>
                  <p>{t(`stats.description.${stat}`)}</p>
                </div>
                <strong className="aui-attribute-value">
                  <span>{character[stat] + gain}</span>
                  <small className="aui-attribute-bonus">
                    {bonus === 0 ? null : ` (${numbers.number(bonus, { signDisplay: 'always' })})`}
                  </small>
                </strong>
                <div className="aui-attribute-actions">
                  <div>
                    <Button
                      aria-label={t('stats.remove_point', { stat: label })}
                      disabled={alloc[stat] <= 0 || locked}
                      onClick={() => set_alloc({ ...alloc, [stat]: Math.max(0, alloc[stat] - 1) })}
                    >
                      −
                    </Button>
                    <Button
                      aria-label={t('stats.add_point', { stat: label })}
                      disabled={!next || next.cost > character.available_points || locked}
                      onClick={() => set_alloc({ ...alloc, [stat]: alloc[stat] + 1 })}
                    >
                      +
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="aui-character-defenses">
        {(['fire', 'water', 'earth', 'air'] as const).map((element) => (
          <span key={element}>
            {t(`stats.element.${element}`)}
            <strong>{equipment_bonus(character, `${element}_resistance`)}%</strong>
          </span>
        ))}
        <span>
          {t('stat.critical_hit')}
          <strong>{equipment_bonus(character, 'critical')}</strong>
        </span>
        <span>
          {t('stat.raw_damage')}
          <strong>{equipment_bonus(character, 'raw_damage')}</strong>
        </span>
      </div>
      <footer className="aui-character-points">
        <span>
          <strong>{remaining}</strong> {t('stats.points_to_assign')}
        </span>
        <Button onClick={reset} disabled={!has_pending || locked}>
          {t('stats.reset')}
        </Button>
        <Button tone="primary" onClick={confirm} busy={pending_tx} disabled={!can_confirm}>
          {t('common.confirm')}
        </Button>
      </footer>
    </section>
  )
}
