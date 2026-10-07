// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { version } from '../../../package.json'
import title_logo from '../../../seed/scenes/aresrpg_text_logo.png'
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
      <section className="mobile-rotate" aria-labelledby="mobile-rotate-title">
        <header className="mobile-rotate-brand">
          <img src={title_logo} alt="AresRPG" width={2169} height={725} />
        </header>
        <div className="mobile-rotate-content" role="status">
          <svg className="mobile-rotate-guide" viewBox="0 0 200 200" fill="none" aria-hidden="true">
            <circle className="mobile-rotate-orbit" cx="100" cy="100" r="88" />
            <rect className="mobile-rotate-target" x="40" y="65" width="120" height="70" rx="12" />
            <g className="mobile-rotate-phone">
              <rect x="65" y="40" width="70" height="120" rx="12" />
              <rect className="mobile-rotate-display" x="73" y="57" width="54" height="80" rx="4" />
              <path d="M92 49h16M93 149h14" strokeLinecap="round" />
            </g>
            <path
              className="mobile-rotate-arrow"
              d="M125 24a80 80 0 0 1 51 51m-14-5 14 5 5-14"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <h1 id="mobile-rotate-title">{copy?.ui.mobile_rotate_title}</h1>
          <p>{copy?.ui.mobile_rotate}</p>
        </div>
        <footer className="mobile-rotate-version">
          <span>{copy?.menu_build}</span>
          <b>v{version}</b>
        </footer>
      </section>
    </div>
  )
}
