// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The Characters drawer's narrow roster row. Split out of CharactersDrawer.jsx (issue #2069);
// the component is unchanged.
import { useTranslation } from 'react-i18next'

import { xp_progress } from '@aresrpg/sdk/experience'

import { PLACEHOLDER_SPRITES, class_display, class_sprite_base } from '../../data/classes.js'
import { color_to_hue } from '../../data/color.js'
import { CharacterPortrait } from './CharacterPortrait.jsx'
import { PendingOutcomeBadge } from './PendingOutcomeBadge.jsx'
import { ExplorerLink } from '../../../components/explorer_link.jsx'
import { Tooltip } from './Tooltip.jsx'

/**
 * One character row — portrait + identity + level + xp bar + switch/active + delete. The delete is BLOCKED
 * (disabled + explained) when `delete_block` is a reason string: never delete the character you
 * are playing, never delete one with equipped items.
 * @param {{
 *   character: any, active: boolean, busy: boolean, delete_block: string | null,
 *   on_switch: () => void, on_delete: () => void
 * }} props
 */
export function CharacterDrawerRow({ character, active, busy, delete_block, on_switch, on_delete }) {
  const { t } = useTranslation()
  const { level, into: xp_into, span: xp_span, pct } = xp_progress(character.experience)
  const percent = Math.round(pct)
  const hue = color_to_hue(character.color_1 ?? 0)
  return (
    <div
      className={`chr-row${active ? ' is-active' : ''}`}
      style={/** @type {import('react').CSSProperties} */ ({ '--hue': `${hue}` })}
    >
      <div className="chr-row__art">
        <CharacterPortrait
          sprites={class_sprite_base(character.classe ?? character.class_id) ?? PLACEHOLDER_SPRITES}
          hue={hue}
          size={58}
        />
      </div>
      <div className="chr-row__body">
        <div className="chr-row__head">
          <span className="chr-row__name">{character.name}</span>
          <span className="chr-row__lvl hud-num">Lv {level}</span>
        </div>
        <div className="chr-row__class">
          {class_display(t, character.classe ?? character.class_id) ?? character.classe}
        </div>
        <div className="chr-bar">
          <div className="chr-bar__fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="chr-row__xp hud-num">
          {xp_into.toLocaleString()} / {xp_span.toLocaleString()} xp
        </div>
        {/* D39: character's on-chain object on the block explorer (Character id is stable even when escrowed). */}
        <ExplorerLink object_id={character.id} className="mt-1" />
        {/* P0 anti-brick: an unopened terminal fight (forfeit/partial-settle) shows the OPEN recovery CTA here. */}
        <PendingOutcomeBadge character_id={character.id} />
      </div>
      <div className="chr-row__actions">
        {character.exploring ? (
          // status 2 = DEAD run — escrowed but over; needs a withdraw to recover → distinct red "Fallen"
          // badge. 0/1 (ACTIVE/RETURNING — alive, out on a run) keep the cyan "Exploring" marker.
          character.status === 2 ? (
            <span className="chr-row__fallen">Fallen · recover</span>
          ) : (
            <span className="chr-row__exploring">Exploring</span>
          )
        ) : null}
        {/* T58: MANAGEMENT-only — no "Playing" badge, no Play/deploy/enter button here (the roster + play
            live in the Exploration tab; duplicating caused double-launch thrash). Only the informational
            exploring/Fallen status + delete remain. */}
        <Tooltip text={delete_block ?? t('characters.delete.title', 'Delete character')}>
          <button
            type="button"
            className="chr-row__del"
            aria-label={delete_block ?? t('characters.delete.title', 'Delete character')}
            disabled={busy || delete_block != null}
            onClick={on_delete}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            </svg>
          </button>
        </Tooltip>
      </div>
      {delete_block && <div className="chr-row__del-note">{delete_block}</div>}
    </div>
  )
}
