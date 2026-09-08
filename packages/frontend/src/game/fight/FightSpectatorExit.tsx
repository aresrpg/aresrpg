// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { LogOut } from 'lucide-react'

import type { AppCopy } from '../../i18n/copy.ts'
import { holds_character_seat } from '../../modules/fight_identity.ts'
import { dispatch_app, type AppState } from '../../store.ts'

export const selected_spectator = ({
  fight,
  session,
}: Readonly<Pick<AppState, 'fight' | 'session'>>): string | null => {
  const character = session.selected_character_id
  const checkpoint = fight.checkpoint
  return fight.mode === 'remote' &&
    checkpoint &&
    character &&
    fight.spectating_by_character[character] === checkpoint.contract.id &&
    !holds_character_seat(checkpoint, character, session.wallet?.address ?? null)
    ? character
    : null
}

export const FightSpectatorExit = ({
  copy,
  character_id,
}: Readonly<{ copy: AppCopy; character_id: string | null }>) => {
  if (!character_id) return null
  return (
    <button
      className="pointer-events-auto absolute top-3 right-3 z-10 flex cursor-pointer items-center gap-2 border border-white/10 bg-black/55 px-3 py-2 text-[10px] tracking-[0.14em] text-[#a3a5ad] uppercase backdrop-blur hover:border-[#c8963c]/40 hover:text-[#c8963c]"
      onClick={() => dispatch_app({ type: 'fight/spectating', character_id, fight: null })}
      type="button"
    >
      <LogOut size={14} />
      {copy.fight_hud.stop_spectating}
    </button>
  )
}
