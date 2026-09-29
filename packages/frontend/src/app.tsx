// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { DesktopWorldHud } from './components/DesktopWorldHud.tsx'
import { DesktopWorldStatus } from './components/DesktopWorldStatus.tsx'
import { AppShell } from './components/AppShell.tsx'
import { PlayerRuntime } from './PlayerRuntime.tsx'

export const App = () => <PlayerRuntime Shell={AppShell} WorldHud={DesktopWorldHud} WorldStatus={DesktopWorldStatus} />
