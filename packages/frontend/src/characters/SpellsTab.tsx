// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// SPELLS — the grimoire: identity + spell-points header, the spell LIST on the left split
// UNLOCKED / LOCKED (locked rows stay browsable), and on the right the ONE shared spell
// detail component (encyclopedia SpellCard — never a duplicate) plus a LEVEL-UP button
// (n → n+1 costs n points, progression.move law — enabled only when the chain would
// accept, never a dead click).

import { Button, ValueBadge } from '@aresrpg/ui'
import type { CharacterRow } from '@aresrpg/protocol'

import { SpellRow } from '../components/SpellRow.tsx'
import { spell_icon } from '../content/assets.ts'
import { titleize, type SpellLevel } from '../content/catalog.ts'
import { SpellCard } from '../encyclopedia/SpellCard.tsx'
import { effect_color } from '../encyclopedia/SpellCardEffects.tsx'
import { type AppCopy } from '../i18n/copy.ts'

import type { CharacterSession } from './character_session.ts'
import { useSpells } from './useSpells.ts'

import './spellbook.css'

const spell_tint = (level: Readonly<SpellLevel> | undefined): string => {
  const damage = level?.effects.find((effect) => effect.element !== '')
  return damage ? effect_color(damage.element) : '#c8963c'
}

export default function SpellsTab({
  character,
  copy,
  session,
}: Readonly<{ character: Readonly<CharacterRow>; copy: AppCopy; session?: CharacterSession }>) {
  const {
    t,
    encyclopedia,
    display_name,
    available,
    set_selected_name,
    raising,
    locked,
    spells,
    level_of,
    unlocked_count,
    selected,
    points,
    current,
    mastered,
    cost,
    can_raise,
    raise_hint,
    raise,
  } = useSpells({ character, copy, session })

  return (
    <div className="sb" data-tutorial-target="character_spells">
      {/* header — identity + spell-points capital */}
      <div className="sb__top">
        <div className="sb__crest">
          <span className="sb__sigil">⚔</span>
          <div>
            <div className="sb__name">{character.name}</div>
            <div className="sb__sub">
              {titleize(character.classe)} · {t('spells.level', { level: character.level })}
            </div>
          </div>
        </div>
        <ValueBadge label={t('spells.spell_points')} value={points} />
      </div>

      <p hidden={!!available} role="status" className="px-3 text-xs text-muted">
        {t('progression_busy')}
      </p>
      <div className="sb__main">
        {/* LIST — unlocked first, locked after, both browsable */}
        <div className="sb__list">
          <div className="sb__lhead">
            <span className="sb__lhead-t">{t('spells.grimoire')}</span>
            <span className="sb__lhead-n">
              {t('spells.unlocked', { unlocked: unlocked_count, total: spells.length })}
            </span>
          </div>
          <div className="sb__rows">
            {[
              {
                rows: spells.filter((spell) => level_of(spell) >= 1),
                locked: false,
                label: t('jobs.recipes.unlocked'),
              },
              { rows: spells.filter((spell) => level_of(spell) < 1), locked: true, label: t('jobs.recipes.locked') },
            ].map(({ rows, locked, label }) =>
              rows.length === 0 ? null : (
                <div className="sb__group" key={label}>
                  <div className={`sb__group-head${locked ? ' is-locked' : ''}`}>{label}</div>
                  {rows.map((spell) => {
                    const level = level_of(spell)
                    const active = spell.name === selected?.name
                    return (
                      <button
                        className={`sb__rowbtn${active ? ' is-active' : ''}${locked ? ' is-locked' : ''}`}
                        key={spell.name}
                        onClick={() => set_selected_name(spell.name)}
                        type="button"
                      >
                        <SpellRow
                          color={spell_tint(spell.levels[Math.max(0, level - 1)])}
                          icon={spell_icon(character.classe, spell.name)}
                          name={display_name(spell.name)}
                          right={
                            locked ? (
                              <span className="sb__lockchip">
                                🔒 {t('spells.unlocks_at', { level: spell.unlock_level })}
                              </span>
                            ) : (
                              <span className="sb__lvbadge">
                                {t('spells.lv_of', { cur: level, max: spell.levels.length })}
                              </span>
                            )
                          }
                          subline=""
                        />
                      </button>
                    )
                  })}
                </div>
              )
            )}
          </div>
        </div>

        {/* DETAIL — the ONE shared spell component (encyclopedia SpellCard) + level up */}
        <div className="sb__detail">
          {selected ? (
            <>
              <SpellCard
                display_name={display_name(selected.name)}
                initial_level={Math.max(1, current)}
                key={`${selected.name}:${current}`}
                spell={selected}
                text={encyclopedia}
              />
              {mastered ? (
                <div className="sb__mastered">{t('spells.mastered')}</div>
              ) : (
                <div className="sb__lup">
                  <div className="sb__actions">
                    <Button
                      tone="primary"
                      className="sb__upgrade"
                      disabled={!can_raise}
                      onClick={raise}
                      title={raise_hint}
                      type="button"
                    >
                      {raising
                        ? t('spells.upgrading')
                        : `${t('spells.level_up_spell')} · ${t('spells.pts', { count: cost })}`}
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="sb__empty">{t('spells.select_prompt')}</div>
          )}
        </div>
      </div>
    </div>
  )
}
