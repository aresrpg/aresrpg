// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AppCopy } from '../../frontend/src/i18n/copy.ts'
import { useAppStore } from '../../frontend/src/store.ts'

import { TouchControls, type TouchDevice } from './TouchControls.tsx'

export const AdventureTouchControls = ({ copy, device }: Readonly<{ copy: AppCopy; device: TouchDevice | null }>) => {
  const enabled = useAppStore(
    (state) =>
      state.adventure.phase === 'explore' &&
      !state.adventure.journal_open &&
      !state.fight.mounted &&
      !state.navigation.dialog &&
      state.navigation.page === 'world'
  )
  return (
    <div className="adventure-touch-controls pointer-events-none absolute inset-0">
      {enabled && device && <TouchControls copy={copy} device={device} />}
    </div>
  )
}
