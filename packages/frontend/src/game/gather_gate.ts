// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { job_level_from_xp, tier_unlock_level } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'

export type GatherGate =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: 'level'; job: string; level: number }>
  | Readonly<{ ok: false; reason: 'tool'; job: string }>

/** Client affordance mirror of gathering.move. Level is reported first by product law; the
 * chain remains the authority and repeats both checks. */
export const gather_gate = (
  character: Readonly<CharacterRow>,
  resource: Readonly<{ job: string; tier: number }>
): GatherGate => {
  const required = tier_unlock_level(resource.tier)
  const level = job_level_from_xp(Number(character.jobs[resource.job] ?? 0))
  if (level < required) return Object.freeze({ ok: false, reason: 'level', job: resource.job, level: required })
  const tool = character.equipment.find(({ slot }) => slot === 'tool')
  if (tool?.category !== `tool_${resource.job.toLowerCase()}`)
    return Object.freeze({ ok: false, reason: 'tool', job: resource.job })
  return Object.freeze({ ok: true })
}
