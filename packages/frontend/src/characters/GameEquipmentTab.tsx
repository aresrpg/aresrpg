// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// The 3D game's equipment tab: the shared tab with the game's own preview, the live character canvas.
// It is one lazy unit, so the game loads the tab and its renderer together as it did before the slot.

import type { ComponentProps } from 'react'

import { CharacterPreviewCanvas } from '../components/CharacterPreviewCanvas.tsx'
import type { CharacterRenderSource } from '../game/character_entities.ts'

import EquipmentTab from './EquipmentTab.tsx'

const canvas_preview = (source: CharacterRenderSource) => <CharacterPreviewCanvas source={source} pedestal />

export default function GameEquipmentTab(props: Readonly<Omit<ComponentProps<typeof EquipmentTab>, 'preview'>>) {
  return <EquipmentTab {...props} preview={canvas_preview} />
}
