// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ReactNode } from 'react'

/** Preserve readable text; scroll the cards while connection status stays visible. */
export const SidebarViewport = ({ children, footer }: Readonly<{ children: ReactNode; footer: ReactNode }>) => (
  <div className="sidebar-viewport pointer-events-auto" data-app-account-panel="">
    <div className="sidebar-viewport__content">{children}</div>
    <div className="sidebar-viewport__footer">{footer}</div>
  </div>
)
