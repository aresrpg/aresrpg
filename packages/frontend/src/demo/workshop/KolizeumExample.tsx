// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useMemo, useState, useRef } from 'react'
import type { KolizeumLobbyRow } from '@aresrpg/protocol'
import { Workspace, ConfirmDialog, Button } from '@aresrpg/ui'
import { Swords } from 'lucide-react'

import { KolizeumView } from '../../kolizeum/KolizeumPage.tsx'
import { adventure_character } from '../../adventure/character.ts'
import { adventure_character_row } from '../../adventure/projection.ts'
import type { AppCopy } from '../../i18n/copy.ts'

import { WorkshopSurface } from './shared.tsx'
const lobbies: readonly KolizeumLobbyRow[] = ([1, 3, 6] as const).map((format, index) => ({
  id: `arena-${index}`,
  fight: '',
  creator: `0x${'bd'.repeat(32)}`,
  format,
  pledge_mist: String(index * 1000000000),
  pot_mist: String(index * 1000000000),
  level_min: 100,
  level_max: 200,
  public: index !== 1,
  can_join: true,
  status: 'open',
  fighters: [{ seat: 0, team: 0, character_id: 'rin', name: 'Rin', classe: 'rojin', level: 170, settled: false }],
}))
export const KolizeumExample = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const character = useMemo(
    () => ({ ...adventure_character_row(adventure_character()), custody: 'kiosk' as const }),
    []
  )
  const [review, set_review] = useState(false)
  return (
    <WorkshopSurface copy={copy} title={copy.kolizeum} icon={<Swords />}>
      {(header) => (
        <>
          <Workspace {...header} className="aui-feature-port aui-arena-port">
            <div className="aui-arena-content">
              <KolizeumView
                copy={copy}
                lobbies={lobbies}
                address="preview"
                characters={[character]}
                selected_character_id={character.id}
                pending={null}
                has_friends
                dispatch={() => set_review(true)}
              />
            </div>
          </Workspace>
          {review && (
            <ConfirmDialog
              title={copy.kolizeum}
              description={copy.ui.preview_only}
              confirm_label={copy.wallet_close}
              cancel_label={copy.cancel}
              close_label={copy.wallet_close}
              on_confirm={() => set_review(false)}
              on_cancel={() => set_review(false)}
            />
          )}
        </>
      )}
    </WorkshopSurface>
  )
}
