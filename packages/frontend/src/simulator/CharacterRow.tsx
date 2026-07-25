// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/CharacterRow.tsx — ONE roster row, rendered identically wherever the page asks "which character?"
//
// The left panel's slot and the popover a blue start cell opens are the SAME question, so they are the same
// row: portrait, name, class, level. It exists because the popover shipped as a bare text list and read as a
// tooltip rather than as a picker (#883 round 2) — the fix is not restyling that list, it is having one row.
//
// THE PORTRAIT is the game's own `CharacterPortrait` (the sprite the characters drawer and the inventory
// header render), keyed by the class' sprite base. A class that ships NO sprite gets its initial in a hairline
// cell — never a substituted body: this page seats all twelve classes on purpose, and painting a Senshi over
// the Iyashi you are building is a lie about the very thing the surface exists to show (the same policy
// board_paint.ts states for the 3D rigs).

import { get_class } from '../game/data/classes.js'
import { CharacterPortrait } from '../game/screens/hud/CharacterPortrait.jsx'

import type { SimCharacter } from './reducer'

const GOLD = '#c8963c'
const HAIRLINE = '1px solid rgba(255,255,255,0.06)'
const micro = 'text-[9px] tracking-[0.22em] uppercase'

/** The class' sprite base, or null when this class ships none (⇒ the initial cell, never a stand-in body). */
export const class_sprites = (class_id: string): string | null =>
  (get_class(String(class_id ?? '').toLowerCase()) as { sprites?: string } | undefined)?.sprites ?? null

export function CharacterFace({ character, size = 34 }: Readonly<{ character: SimCharacter; size?: number }>) {
  const sprites = class_sprites(character.class_id)
  return (
    <span
      className="shrink-0 grid place-items-center overflow-hidden"
      style={{ width: size, height: size, border: HAIRLINE, background: 'rgba(255,255,255,0.02)' }}
    >
      {sprites ? (
        <CharacterPortrait sprites={sprites} hue={0} size={size} className="block" />
      ) : (
        <span className="text-[13px]" style={{ color: GOLD, opacity: 0.8 }}>
          {character.name.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  )
}

/**
 * The row's CONTENT — face + identity. It renders no box of its own so each surface keeps its own container
 * (the panel's `<button>` seat, the popover's row), which is the only thing that legitimately differs.
 */
export function CharacterRow({
  character,
  active = false,
  t,
  right,
}: Readonly<{
  character: SimCharacter
  active?: boolean
  /** the caller's translator — this file stays presentational and takes no hook of its own */
  t: (key: string, params?: object) => string
  right?: React.ReactNode
}>) {
  return (
    <>
      <CharacterFace character={character} />
      <span className="flex flex-col min-w-0 flex-1">
        <span className="text-[11px] truncate" style={{ color: active ? GOLD : '#e8e4dc' }}>
          {character.name}
        </span>
        <span className={`${micro} text-muted truncate`}>
          {t(`simulator.classes.${character.class_id.toUpperCase()}.display`, { defaultValue: character.class_id })}
        </span>
        <span className={micro} style={{ color: GOLD, opacity: 0.7 }}>
          {t('simulator.level')} {character.level}
        </span>
      </span>
      {right}
    </>
  )
}
