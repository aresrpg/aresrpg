// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { WorldCaption } from '@aresrpg/engine'

export const npc_caption = (name: string, speech?: string): WorldCaption => ({ name, speech, max_distance: 50 })
