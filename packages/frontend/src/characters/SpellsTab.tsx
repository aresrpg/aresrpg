// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SPELLS — the grimoire: identity + spell-points header, the spell LIST on the left split
// UNLOCKED / LOCKED (locked rows stay browsable), and on the right the ONE shared spell
// detail component (encyclopedia SpellCard — never a duplicate) plus a LEVEL-UP button
// (n → n+1 costs n points, progression.move law — enabled only when the chain would
// accept, never a dead click).

import { useEffect, useMemo, useState } from 'react'
import type { CharacterRow } from '@aresrpg/protocol'

import { SpellRow } from '../components/SpellRow.tsx'
import { spell_icon } from '../content/assets.ts'
import { encyclopedia_catalog, titleize, type SeedSpell, type SpellLevel } from '../content/catalog.ts'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import { SpellCard } from '../encyclopedia/SpellCard.tsx'
import { effect_color } from '../encyclopedia/SpellCardEffects.tsx'
import { copy_text, spell_name, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'
import { run_direct_transaction } from '../transaction_guard.ts'

import './spellbook.css'

const spell_tint = (level: Readonly<SpellLevel> | undefined): string => {
  const damage = level?.effects.find((effect) => effect.element !== '')
  return damage ? effect_color(damage.element) : '#c8963c'
}

export default function SpellsTab({ character, copy }: Readonly<{ character: Readonly<CharacterRow>; copy: AppCopy }>) {
  const t = copy_text(copy.characters_page)
  const encyclopedia = encyclopedia_text(copy)
  const display_name = (identity: string): string => spell_name(copy, identity)
  const wallet = useAppStore(({ session }) => session.wallet)
  const [selected_name, set_selected_name] = useState<string | null>(null)
  const [raising, set_raising] = useState(false)

  const spells = useMemo(
    () =>
      (encyclopedia_catalog.class(character.classe)?.spells ?? []).toSorted(
        (left, right) => left.unlock_level - right.unlock_level || left.name.localeCompare(right.name)
      ),
    [character.classe]
  )
  // progression.move spell_level: 0 below unlock, else the book's entry (absent = 1)
  const level_of = (spell: Readonly<SeedSpell>): number =>
    character.level < spell.unlock_level ? 0 : (character.spells[spell.name] ?? 1)

  const unlocked_count = spells.filter((spell) => level_of(spell) >= 1).length
  const selected =
    spells.find(({ name }) => name === selected_name) ?? spells.find((spell) => level_of(spell) >= 1) ?? spells[0]
  const points = character.available_spell_points

  const current = selected ? level_of(selected) : 0
  const max_level = selected?.levels.length ?? 0
  const mastered = current >= max_level && current > 0
  const cost = current
  const can_raise = !!wallet && !!selected && current >= 1 && !mastered && points >= cost && !raising
  const raise_hint =
    !selected || raising || can_raise || mastered
      ? undefined
      : current < 1
        ? t('spells.requires_lv', { level: selected.unlock_level })
        : t('spells.no_points')

  const raise = (): void => {
    if (!can_raise || !wallet || !selected) return
    const transaction = run_direct_transaction(() =>
      wallet.character.raise_spell({
        character_id: character.id,
        spell: selected.name,
        custody: { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap },
      })
    )
    if (!transaction) return
    set_raising(true)
    const pending = toast.loading(t('spells.upgrading'))
    void transaction
      .then(() => {
        dispatch_app({ type: 'character/spell_raised', character_id: character.id, spell: selected.name })
        pending.success(t('spells.upgrade_success', { spell: display_name(selected.name) }))
      })
      .catch(pending.error)
      .finally(() => set_raising(false))
  }

  return (
    <div className="sb">
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
        <div className="sb__points">
          <div>
            <div className="sb__points-lab">{t('spells.spell_points')}</div>
            <div className="sb__points-sub">{t('spells.available')}</div>
          </div>
          <div className="sb__points-val">{points}</div>
        </div>
      </div>

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
                    <button
                      className={`sb__btn-compact${can_raise ? ' sb__btn-gold' : ' sb__btn-off'}`}
                      disabled={!can_raise}
                      onClick={raise}
                      title={raise_hint}
                      type="button"
                    >
                      {raising
                        ? t('spells.upgrading')
                        : `${t('spells.level_up_spell')} · ${t('spells.pts', { count: cost })}`}
                    </button>
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
