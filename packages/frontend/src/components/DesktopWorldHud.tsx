// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { CompassStrip } from '../game/hud/CompassStrip.tsx'
import { GatherProgress } from '../game/hud/GatherProgress.tsx'
import { OverworldVitals } from '../game/hud/OverworldVitals.tsx'
import { RunToProgress } from '../game/hud/RunToProgress.tsx'
import { WorldInteractions } from '../game/WorldInteractions.tsx'
import type { AppCopy } from '../i18n/copy.ts'

import { WorldChat } from './Chat.tsx'
import { ZonePrompt } from './ZonePrompt.tsx'
import { ZoneRevealBanner } from './ZoneRevealBanner.tsx'

export const DesktopWorldHud = ({ copy }: Readonly<{ copy: AppCopy }>) => (
  <>
    <WorldInteractions copy={copy} />
    <CompassStrip copy={copy} />
    <RunToProgress copy={copy} />
    <ZonePrompt copy={copy} />
    <ZoneRevealBanner copy={copy} />
    <OverworldVitals />
    <GatherProgress copy={copy} position="world" />
    <WorldChat copy={copy} />
  </>
)
