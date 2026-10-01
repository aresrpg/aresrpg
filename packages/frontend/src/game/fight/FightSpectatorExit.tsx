// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Button } from '@aresrpg/ui'
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
    <Button
      className="pointer-events-auto absolute right-[max(12px,env(safe-area-inset-right))] bottom-[max(12px,env(safe-area-inset-bottom))] z-10"
      onClick={() => dispatch_app({ type: 'fight/spectating', character_id, fight: null })}
      type="button"
    >
      <LogOut size={16} aria-hidden="true" />
      {copy.fight_hud.stop_spectating}
    </Button>
  )
}
