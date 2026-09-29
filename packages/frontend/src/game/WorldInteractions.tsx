// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { AmbushPrompt } from '../components/AmbushPrompt.tsx'
import { DungeonPortalPrompt } from '../components/DungeonPortalPrompt.tsx'
import { FightPrompt } from '../components/FightPrompt.tsx'
import { MountPrompt } from '../components/MountPrompt.tsx'
import { PlayerNametag } from '../components/PlayerNametag.tsx'
import { PortalPrompt } from '../components/PortalPrompt.tsx'
import { SpawnNametag } from '../components/SpawnNametag.tsx'
import type { AppCopy } from '../i18n/copy.ts'

export const WorldInteractions = ({ copy }: Readonly<{ copy: AppCopy }>) => (
  <>
    <MountPrompt copy={copy} />
    <FightPrompt copy={copy} />
    <DungeonPortalPrompt copy={copy} />
    <PortalPrompt copy={copy} />
    <PlayerNametag />
    <SpawnNametag copy={copy} />
    <AmbushPrompt copy={copy} />
  </>
)
