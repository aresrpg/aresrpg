// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The Characters page's master-detail roster entry. Split out of CharactersDrawer.jsx (issue #2069);
// the component is unchanged.
import { useTranslation } from 'react-i18next'

import { xp_progress } from '@aresrpg/sdk/experience'

import { PLACEHOLDER_SPRITES, class_display, class_sprite_base } from '../../data/classes.js'
import { color_to_hue } from '../../data/color.js'
import { CharacterPortrait } from './CharacterPortrait.jsx'
import { PendingOutcomeBadge } from './PendingOutcomeBadge.jsx'
import { CharacterDeleteAction } from './CharacterDeleteAction.jsx'

/**
 * One roster entry for the page master-detail list (T58 — MANAGEMENT-only): mini-portrait + identity.
 * Clicking the row previews the character in the detail panel so you can MANAGE it
 * (equipment / stats / jobs / craft). Play + deploy are NOT here — that roster lives in the Exploration
 * tab; duplicating it caused double-launch thrash. The exploring/Fallen badges stay as INFORMATIONAL
 * status (a character escrowed on an expedition is out of the kiosk). Active = the previewed/selected
 * character (gold tint).
 * BACKLOG 18: the ACTIVE (selected) row carries the delete affordance inline — management lives HERE
 * (delete characters from the characters tab), disabled with the honest reason while blocked.
 * Design ruling (2026-07-18): the roster row is avatar + name + level/class ONLY — the HP/AP/MP chips are GONE
 * (they took half the landscape screen; that data lives in the detail pane's STATS tab, its one home).
 * @param {{ character: any, active: boolean, busy: boolean, delete_block: string | null, on_preview: () => void, on_delete: () => void }} props
 */
export function RosterEntry({ character, active, busy, delete_block, on_preview, on_delete }) {
  const { t } = useTranslation()
  const { level } = xp_progress(character.experience)
  const hue = color_to_hue(character.color_1 ?? 0)
  const class_name = (class_display(t, character.classe ?? character.class_id) ?? character.classe ?? '').toUpperCase()
  // The roster is a list of COMPACT one-line cards: art | name + level·class | status/delete. Clicking a
  // card previews it in the detail panel; the active card only gains an inline delete icon (no second row).
  return (
    <div
      className={`chrx-row${active ? ' is-active' : ''}`}
      style={/** @type {import('react').CSSProperties} */ ({ '--hue': `${hue}` })}
    >
      <div className="chrx-row__main" onClick={on_preview}>
        <div className="chrx-row__art">
          <CharacterPortrait
            sprites={class_sprite_base(character.classe ?? character.class_id) ?? PLACEHOLDER_SPRITES}
            hue={hue}
            size={30}
          />
        </div>
        <div className="chrx-row__id">
          <span className="chrx-row__name">{character.name}</span>
          <span className="chrx-row__sub hud-num">
            Lv {level} <span className="chrx-row__dot">·</span> <span className="chrx-row__cls">{class_name}</span>
          </span>
        </div>
        {/* Right column: informational status (the Exploration tab owns run actions) + the active row's
            inline delete. 2 = DEAD on-chain status → red "Fallen" (needs a withdraw); 0/1 keep cyan
            "Exploring". Kept on one tight line so the row never grows a second row. */}
        <div className="chrx-row__aside">
          {character.exploring &&
            (character.status === 2 ? (
              <div className="chrx-fallen" aria-label="Fallen">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" x2="12" y1="9" y2="13" />
                  <line x1="12" x2="12.01" y1="17" y2="17" />
                </svg>
                Fallen
              </div>
            ) : (
              <div className="chrx-exploring" aria-label="Exploring">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="m16 8-2 6-6 2 2-6 6-2z" />
                </svg>
                Exploring{character.journey_len ? ` · ${character.opened}/${character.journey_len}` : ''}
              </div>
            ))}
          {/* BACKLOG 18 — delete lives on the active row; stopPropagation so its click never previews. */}
          {active && (
            <CharacterDeleteAction block_reason={delete_block} busy={busy} on_delete={on_delete} />
          )}
        </div>
      </div>
      {/* P0 anti-brick: sibling of the clickable main (its own click never triggers preview) — the OPEN
          recovery CTA for a character stranded with an unopened terminal fight. Renders null when clean. */}
      <PendingOutcomeBadge character_id={character.id} />
    </div>
  )
}
