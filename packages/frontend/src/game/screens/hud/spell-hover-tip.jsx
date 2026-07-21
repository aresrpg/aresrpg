// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The single seeded-spell detail card for the fight hotbar. Pointer hover previews it above a socket. Its facts
// and effects come from the same chain projection + shared effect grammar as the grimoire, so there is no
// second spell-info source to drift.

import { element_color } from './element-colors.js'
import { seed_effect_line, seed_el_label } from './seed-effect-line.js'
import { spell_effects } from './spellbook-data.js'

/**
 * PURE: one seeded spell row to the exact facts displayed by the hotbar card.
 * @param {(key: string, params?: object) => string} t
 * @param {{ kind?: string, levels?: Array<object> } | null | undefined} spell
 * @returns {{ ap: number, range_txt: string, crit_txt: string, cooldown_txt: string, subline: string,
 *   color: string, effects: Array<{ text: string, color: string }> }}
 */
export const spell_hover_facts = (t, spell) => {
  const level = spell?.levels?.[0] ?? null
  const [range_min, range_max] = level?.range ?? [0, 0]
  const element = level?.effects?.find((effect) => effect.kind === 'DAMAGE')?.element ?? null
  const subline = element
    ? `${seed_el_label(t, element)} · ${t('spells.damage')}`
    : t(spell?.kind === 'heal' ? 'spells.heal' : 'spells.buff')
  const none = t('fight.none')

  return {
    ap: level?.ap ?? 0,
    range_txt: range_min === range_max ? `${range_min}` : `${range_min}-${range_max}`,
    crit_txt: level?.crit_rate > 0 ? `1 / ${level.crit_rate}` : none,
    cooldown_txt: level?.cooldown > 0 ? `${level.cooldown} ${t('spells.turns')}` : none,
    subline,
    color: element_color(element),
    effects: spell_effects(level).map((effect) => ({
      text: seed_effect_line(t, effect),
      color: effect.color,
    })),
  }
}

/**
 * Full spell detail inside the hotbar's anchored Tooltip.
 * `cd_left` (#368, silent-refusal law) — turns still on cooldown (0 = not on cooldown): the SAME fact
 * DeckCluster's cast_gate greys the socket with (draft_budget.cooldown_display, one home) — surfaces WHY the
 * greyed affordance refuses a cast attempt, right here at hover, reusing the toast's own copy
 * (`dungeons.spell_on_cooldown`) so the reason never drifts from what a cast attempt would already say.
 * @param {{ t: (key: string, params?: object) => string, name: string,
 *   spell: { kind?: string, levels?: Array<object> }, cd_left?: number }} props
 * @returns {import('react').JSX.Element}
 */
export function SpellHoverTip({ t, name, spell, cd_left = 0 }) {
  const facts = spell_hover_facts(t, spell)
  const rows = [
    [t('spells.ap_cost'), `${facts.ap}`],
    [t('spells.range'), facts.range_txt],
    [t('spells.crit_chance'), facts.crit_txt],
    [t('spells.cooldown'), facts.cooldown_txt],
  ]

  return (
    <div
      className="tt-spell-card"
      style={/** @type {import('react').CSSProperties} */ ({ '--spell-color': facts.color })}
    >
      <div className="tt-spell-card__head">
        <div className="tt-spell-card__identity">
          <span className="tt-spell-card__name">{name}</span>
          <span className="tt-spell-card__type">{facts.subline}</span>
        </div>
        <span className="tt-ap-pill tt-num">
          <b>{facts.ap}</b>
          <span>{t('fight.ap')}</span>
        </span>
      </div>

      {cd_left > 0 && <div className="tt-spell-card__reason">{t('dungeons.spell_on_cooldown', { n: cd_left })}</div>}

      <div className="tt-spell-card__facts">
        {rows.map(([label, value]) => (
          <div className="tt-spell-card__fact" key={label}>
            <span className="tt-spell-card__label">{label}</span>
            <span className="tt-spell-card__value tt-num">{value}</span>
          </div>
        ))}
      </div>

      {facts.effects.length > 0 && (
        <div className="tt-fx">
          <div className="tt-spell-card__section">{t('spells.effects')}</div>
          {facts.effects.map((effect, index) => (
            <div className="tt-line" key={index}>
              <span className="tt-fx-dot" style={{ background: effect.color }} aria-hidden="true" />
              <span className="tt-fx-text">{effect.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
