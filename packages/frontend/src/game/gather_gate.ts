// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { gather_gate, job_level_from_xp } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'

export const COLLECT_ALL_LEVEL = 30

export const collect_all_available = (
  character: Readonly<CharacterRow>,
  resource: Readonly<{ job: string; tier: number }>
): boolean =>
  job_level_from_xp(Number(character.jobs[resource.job] ?? 0)) >= COLLECT_ALL_LEVEL &&
  gather_gate(character, resource).ok

export { gather_gate, type GatherGate } from '@aresrpg/immutable'
