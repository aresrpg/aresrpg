// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The established blue-cell picker: a six-row popover anchored at the clicked cell.

/* eslint-disable functional/prefer-immutable-types -- Window events are a browser boundary. */
import { useEffect } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import type { SimulatorCharacter } from '../modules/simulator.ts'

import { CharacterRow } from './CharacterRow.tsx'

const CARD_WIDTH = 268
const CARD_MAX_HEIGHT = 320

export const popover_position = (
  x: number,
  y: number,
  viewport: Readonly<{ width: number; height: number }>
): Readonly<{ left: number; top: number }> =>
  Object.freeze({
    left: Math.max(8, Math.min(x + 12, viewport.width - CARD_WIDTH - 8)),
    top: Math.max(8, Math.min(y + 12, viewport.height - CARD_MAX_HEIGHT - 8)),
  })

export const CharacterPicker = ({
  at,
  characters,
  copy,
  placements,
  close,
  pick,
}: Readonly<{
  at: Readonly<{ x: number; y: number }>
  characters: readonly SimulatorCharacter[]
  copy: AppCopy
  placements: Readonly<Record<number, string>>
  close: () => void
  pick: (character_id: string) => void
}>) => {
  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    globalThis.addEventListener('keydown', keydown)
    return () => globalThis.removeEventListener('keydown', keydown)
  }, [close])

  const text = copy.simulator_page
  const seated = new Set(Object.values(placements))
  const position = popover_position(at.x, at.y, {
    width: globalThis.innerWidth,
    height: globalThis.innerHeight,
  })
  return (
    <div className="fixed inset-0 z-[9998]" onClick={close} role="presentation">
      <section
        aria-label={text.pick_character}
        className="absolute flex max-h-80 w-[268px] flex-col overflow-y-auto border border-[#c8963c] bg-[#0c0c14] shadow-[0_0_24px_rgba(0,0,0,0.7)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        style={position}
      >
        <header className="border-b border-white/6 px-3 py-2 text-[9px] font-semibold tracking-[0.2em] text-[#c8963c] uppercase">
          {text.pick_character}
        </header>
        {characters.map((character) => {
          const active = seated.has(character.id)
          return (
            <button
              className="flex min-h-[52px] cursor-pointer items-center gap-2.5 border-b border-white/6 px-3 py-2 text-left hover:bg-[#c8963c]/10"
              key={character.id}
              onClick={() => pick(character.id)}
              style={{ borderLeft: `2px solid ${active ? '#c8963c' : 'transparent'}` }}
              type="button"
            >
              <CharacterRow
                active={active}
                character={character}
                level_label={text.level.replace('{level}', String(character.level))}
              />
            </button>
          )
        })}
      </section>
    </div>
  )
}
