// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The onboarding OBJECTIVE CARD — the compact HUD readout of the quest ladder (quest_ladder_store.js).
// Terminal house DNA: near-black SOLID panel (fight-HUD opacity law — never see-through over the board),
// gold accents, uppercase micro-labels, sharp corners, monospace. Shows the ACTIVE quest's number, title,
// one-line instruction, a live n/m progress readout for the loot step, and a subtle SKIP (per-quest) with
// a "skip all" in an overflow. Pure renderer — all state + detection live in the store; the buttons call
// its skip actions. Self-hides when every quest is resolved or the ladder was dismissed forever.
//
// Placement: center-right (vertically centered, right-anchored — design ruling 2026-07-13; its old top-right slot is
// reserved for the minimap); a compact variant during a fight. Visible in both world and fight.

import { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { useGameState } from '../../../store.js'
import { TARGET_TOOL, item_label } from './quest_ladder.js'
import { quest_store, skip_all, skip_current } from './quest_ladder_store.js'
import './quest-ladder.css'

/** @returns {import('react').ReactElement | null} */
export function QuestObjectiveCard() {
  const snapshot = useSyncExternalStore(quest_store.subscribe, quest_store.get)
  const fight_mode = useGameState((s) => s.fight_mode)
  const { t, i18n } = useTranslation()
  const [menu_open, set_menu_open] = useState(false)

  if (snapshot.hidden || !snapshot.quest_id) return null

  const lang = i18n?.language || 'en'
  const tool = item_label(TARGET_TOOL, lang)
  const id = snapshot.quest_id
  const loot = snapshot.loot
  const pct = loot && loot.need > 0 ? Math.round((loot.have / loot.need) * 100) : 0

  return (
    <aside className={`quest-card${fight_mode ? ' quest-card--fight' : ''}`} aria-label={t('quests.aria_label')}>
      <div className="quest-card__head">
        <span className="quest-card__eyebrow">
          {t('quests.eyebrow', { n: snapshot.index + 1, total: snapshot.total })}
        </span>
        <div className="quest-card__actions">
          <button type="button" className="quest-card__skip" onClick={skip_current}>
            {t('quests.skip')}
          </button>
          <button
            type="button"
            className="quest-card__more"
            aria-label={t('quests.more')}
            aria-expanded={menu_open}
            onClick={() => set_menu_open((v) => !v)}
          >
            {/* three-dot overflow glyph */}
            <span aria-hidden="true">⋯</span>
          </button>
          {menu_open && (
            <div className="quest-card__menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="quest-card__menu-item"
                onClick={() => {
                  set_menu_open(false)
                  skip_all()
                }}
              >
                {t('quests.skip_all')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* keyed on the active quest so the next objective SLIDES IN when the chain advances */}
      <div className="quest-card__body" key={id}>
        <h3 className="quest-card__title">{t(`quests.${id}_title`, { tool })}</h3>
        <p className="quest-card__desc">{t(`quests.${id}_desc`, { tool })}</p>

        {loot && (
          <div className="quest-card__loot">
            <div
              className="quest-card__bar"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span className="quest-card__bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <ul className="quest-card__mats">
              {loot.rows.map((r) => (
                <li key={r.id} className={`quest-card__mat${r.have >= r.need ? ' is-met' : ''}`}>
                  <span className="quest-card__mat-name">{item_label(r.id, lang)}</span>
                  <span className="quest-card__mat-count hud-num">
                    {r.have}/{r.need}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  )
}
