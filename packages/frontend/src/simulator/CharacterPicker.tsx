// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/CharacterPicker.tsx — "who stands on THIS blue cell?", asked where the question was asked (#883 ①).
//
// A start cell is a place on the board, so its picker is a POPOVER at the cell — not a panel on the far side
// of the page. The roster is at most six rows, which is why this is a plain anchored card and not the app's
// SearchPickerModal: a full-screen search dialog over six known names is chrome, and it would put the answer
// somewhere other than where the player is looking (the same two-panel dance the board-first rework removes).
//
// Presentation only, over explicit props — no store, no portal (so `react-dom/server` renders it whole and the
// interaction is provable without a browser). `position: fixed` puts it at the pointer; the transparent
// backdrop under it is the outside-click door, the same dismissal contract every dialog in the app has.

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'

import type { SimCharacter, SimPlacements } from './reducer'

const GOLD = '#c8963c'
const HAIRLINE = '1px solid rgba(255,255,255,0.06)'
const micro = 'text-[9px] tracking-[0.22em] uppercase'

/** Card size, in CSS px — used to keep it inside the viewport rather than half off the right/bottom edge. */
const CARD_WIDTH = 220
const CARD_MAX_HEIGHT = 320

/** Clamp the anchor so the whole card stays on screen (a cell near the right edge would otherwise clip). */
export const popover_position = (
  x: number,
  y: number,
  viewport: Readonly<{ width: number; height: number }>
): { left: number; top: number } => ({
  left: Math.max(8, Math.min(x + 12, viewport.width - CARD_WIDTH - 8)),
  top: Math.max(8, Math.min(y + 12, viewport.height - CARD_MAX_HEIGHT - 8)),
})

export function CharacterPicker({
  roster,
  placements,
  at,
  on_pick,
  on_close,
}: Readonly<{
  roster: readonly SimCharacter[]
  placements: SimPlacements
  /** where the click happened, in client px */
  at: { x: number; y: number }
  on_pick: (id: string) => void
  on_close: () => void
}>) {
  const { t } = useTranslation()

  useEffect(() => {
    const on_key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') on_close()
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [on_close])

  const seated = new Set(Object.values(placements))
  const { left, top } = popover_position(at.x, at.y, {
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
  })

  return (
    <div className="fixed inset-0 z-50" onClick={on_close} role="presentation">
      <div
        role="dialog"
        aria-label={t('simulator.place_character')}
        className="absolute flex flex-col overflow-y-auto"
        style={{
          left,
          top,
          width: CARD_WIDTH,
          maxHeight: CARD_MAX_HEIGHT,
          background: '#0c0c14',
          border: `1px solid ${GOLD}`,
          boxShadow: '0 0 24px rgba(0,0,0,0.7)',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`${micro} font-semibold px-3 py-2`} style={{ color: GOLD, borderBottom: HAIRLINE }}>
          {t('simulator.place_character')}
        </div>
        {roster.length === 0 ? (
          <span className={`${micro} text-muted px-3 py-3 leading-relaxed`}>{t('simulator.roster_empty_hint')}</span>
        ) : (
          roster.map((character) => (
            <button
              key={character.id}
              type="button"
              className="flex items-center gap-2 px-3 py-2 text-left cursor-pointer hover:bg-white/[0.05]"
              style={{ borderBottom: HAIRLINE }}
              onClick={() => on_pick(character.id)}
            >
              <span className="flex flex-col min-w-0 flex-1">
                <span className="text-[11px] truncate" style={{ color: '#e8e4dc' }}>
                  {character.name}
                </span>
                <span className={`${micro} text-muted truncate`}>
                  {t(`simulator.classes.${character.class_id.toUpperCase()}.display`, {
                    defaultValue: character.class_id,
                  })}{' '}
                  · {t('simulator.level')} {character.level}
                </span>
              </span>
              {/* A seated character is still offered: picking it MOVES it here (the reducer frees its old
                  cell), which is the only way to rearrange a line-up without emptying it first. */}
              {seated.has(character.id) && (
                <span className={micro} style={{ color: GOLD, opacity: 0.7 }}>
                  {t('simulator.placed')}
                </span>
              )}
            </button>
          ))
        )}
        <span className={`${micro} text-muted px-3 py-2 flex items-center gap-1`} style={{ opacity: 0.6 }}>
          <Plus size={10} />
          {t('simulator.roster_panel_hint')}
        </span>
      </div>
    </div>
  )
}
