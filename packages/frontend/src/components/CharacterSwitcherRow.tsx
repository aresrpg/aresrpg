// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The switcher's ROWS — presentational only, so the roster's identity rendering can be driven in a test without
// the container's chain/auth/session wiring (#2182: the rows read a four-row class table and rendered nothing
// for the other eight classes; a test proving all twelve seat here cannot boot the whole switcher).
// Props in, markup out: no store, no effect, no navigation. The container (CharacterSwitcher.tsx) owns those.

import { useTranslation } from 'react-i18next'
import { Compass } from 'lucide-react'
import { experience_to_level } from '@aresrpg/sdk/experience'

import { class_display } from '../game/data/classes.js'
import { color_to_hue } from '../game/data/color.js'

/** A folded follower row — indented under the leader, NOT a switch target while following; the × unfollows it,
 *  restoring a normal switchable row. Mirrors the CharacterRow identity chips (glyph + name + level). */
export function FollowerRow({ character, on_kick }: { character: any; on_kick: (character_id: string) => void }) {
  const { t } = useTranslation()
  const level = experience_to_level(character.experience ?? 0)
  const hue = color_to_hue(character.color_1 ?? 0)
  // The glyph is the class' INITIAL, so the localized class name rides aria-label — otherwise the row says
  // "I" and a screen reader cannot tell an Ikari from an Iyashi.
  const class_label = class_display(t, character.classe ?? character.class_id) ?? character.classe ?? null
  const initial = (class_label ?? '?').charAt(0).toUpperCase()
  return (
    <div className="chsw-rowwrap chsw-child">
      <div className="chsw-row chsw-row--following" title={character.name}>
        <span className="chsw-row__glyph" aria-label={class_label ?? undefined} style={{ '--hue': hue } as React.CSSProperties}>
          {initial}
        </span>
        <span className="chsw-row__name">{character.name}</span>
        <span className="chsw-row__lvl">Lv {level}</span>
      </div>
      <button
        type="button"
        className="chsw-row__abandon"
        onClick={() => on_kick(character.id)}
        title={t('characters.stop_following')}
        aria-label={t('characters.stop_following')}
      >
        ×
      </button>
    </div>
  )
}

export function CharacterRow({
  character,
  active,
  switching,
  dot,
  exploring,
  status_label,
  on_click,
}: {
  character: any
  active: boolean
  switching: boolean
  dot: boolean
  exploring: boolean
  status_label?: string | null
  on_click: () => void
}) {
  const { t } = useTranslation()
  const level = experience_to_level(character.experience ?? 0)
  const hue = color_to_hue(character.color_1 ?? 0)
  // The glyph is the class' INITIAL, so the localized class name rides aria-label — otherwise the row says
  // "I" and a screen reader cannot tell an Ikari from an Iyashi.
  const class_label = class_display(t, character.classe ?? character.class_id) ?? character.classe ?? null
  const initial = (class_label ?? '?').charAt(0).toUpperCase()

  const row = (
    <button
      type="button"
      className={`chsw-row${active ? ' is-active' : ''}${switching ? ' is-switching' : ''}${exploring ? ' is-exploring' : ''}`}
      onClick={on_click}
      aria-busy={switching}
      title={character.name}
    >
      <span className="chsw-row__glyph" aria-label={class_label ?? undefined} style={{ '--hue': hue } as React.CSSProperties}>
        {initial}
      </span>
      <span className="chsw-row__name">{character.name}</span>
      {/* EXPLORING badge (staked/idle-farming, load_roster's `exploring` flag) — distinct from a plain lobby
          row so the player never mistakes a staked char for one that's free to embody/enter a dungeon with. */}
      {exploring && (
        <Compass
          className="chsw-row__exploring"
          aria-label={t('characters.switcher_exploring')}
          title={t('characters.switcher_exploring')}
        />
      )}
      {/* live dungeon status (IN DUNGEON rows only) — surfaces a stuck/terminal run so it never looks startable. */}
      {status_label && <span className="chsw-row__status">{status_label}</span>}
      <span className="chsw-row__lvl">Lv {level}</span>
      {dot && <span className="chsw-row__dot" aria-hidden="true" />}
    </button>
  )

  // The per-row ✕ abandon is REMOVED — unrequested scope + a native title tooltip + a single-exit-law
  // violation (abandon lives ONLY in the bottom-right card). The row itself (resume click + status chip) is the
  // requested surface, nothing more.
  return row
}
