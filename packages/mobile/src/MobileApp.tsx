// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import './mobile.css'
import { PlayerRuntime } from '../../frontend/src/PlayerRuntime.tsx'
import { AppShell } from '../../frontend/src/components/AppShell.tsx'
import { DesktopWorldStatus } from '../../frontend/src/components/DesktopWorldStatus.tsx'
import { useAppStore } from '../../frontend/src/store.ts'

import { MobileWorldHud } from './MobileWorldHud.tsx'

export const MobileApp = () => {
  const copy = useAppStore((state) => state.copy)
  return (
    <div className="mobile-app">
      <PlayerRuntime Shell={AppShell} WorldHud={MobileWorldHud} WorldStatus={DesktopWorldStatus} />
      <section className="mobile-rotate" role="status">
        <strong>↻</strong>
        <p>{copy?.ui.mobile_rotate}</p>
      </section>
    </div>
  )
}
