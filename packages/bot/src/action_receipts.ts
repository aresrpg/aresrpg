// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { gatherable_of } from '@aresrpg/immutable'
import { live_resource_packs } from '@aresrpg/protocol'
import { receipt_digest, receipt_event, type Receipt } from '@aresrpg/sdk/cache'

import type { Command } from './control.ts'
import type { GameplayContext } from './gameplay_context.ts'
import { inventory_projected } from './actor_inventory.ts'
import { recipe_job } from './profession_catalog.ts'
import { zone_key } from './actor_world.ts'

export type ProfessionBaseline = Readonly<{
  job: string
  xp: string
  checkpoint_ms: number
  zone?: Readonly<{ key: string; seed: string; pack_index: number; nodes: number }>
}>
/** The baseline belongs to the accepted step, not to packet arrival or a heartbeat. */
export const step_observation = (
  action: Readonly<{ kind: string; payload: Readonly<Record<string, unknown>> }>,
  context: GameplayContext
): ProfessionBaseline => {
  const character = context.snapshot.characters.find(({ id }) => id === action.payload.character_id)!
  const job =
    action.kind === 'craft'
      ? recipe_job(String(action.payload.output_type))!
      : gatherable_of(String(action.payload.item_type))!.job
  const base = { job, xp: character.jobs[job] ?? '0', checkpoint_ms: character.at_ms ?? 0 }
  if (action.kind === 'craft') return base
  const key = zone_key(String(action.payload.world), Number(action.payload.zone_x), Number(action.payload.zone_z))
  const row = context.snapshot.zones[key]!
  const pack_index = Number(action.payload.pack_index)
  const pack = live_resource_packs(row.spawns!.resources, row.zone).find(({ index }) => index === pack_index)!
  return { ...base, zone: { key, seed: row.zone.seed, pack_index, nodes: pack.nodes } }
}
const gather_projected = (before: ProfessionBaseline, context: GameplayContext) => {
  const { zone: target } = before
  if (!target) return true
  const row = context.snapshot.zones[target.key]
  if (!row?.spawns) return false
  const pack = live_resource_packs(row.spawns.resources, row.zone).find(({ index }) => index === target.pack_index)
  return row.zone.seed !== target.seed || (pack?.nodes ?? 0) < target.nodes
}
export const receipt_projected = (
  before: ProfessionBaseline,
  previous: Command,
  receipt: Receipt,
  context: GameplayContext
) => {
  const expected_digest = (previous.result as { digest?: string }).digest
  if ([previous.status !== 'completed', receipt_digest(receipt) !== expected_digest].some(Boolean)) return false
  const event = receipt_event(
    receipt,
    previous.kind === 'craft' ? '::crafting::Crafted' : '::gathering::ResourceGathered'
  )
  const character = context.snapshot.characters.find(({ id }) => id === previous.payload.character_id)
  if (!character || !event) return false
  const gained = String(event.job_xp_gained)
  if (!/^\d+$/.test(gained)) return false
  const xp_ready = BigInt(character.jobs[before.job] ?? '0') >= BigInt(before.xp) + BigInt(gained)
  const checkpoint_ready = !before.zone || Number(character.at_ms) > before.checkpoint_ms
  return [
    xp_ready,
    checkpoint_ready,
    gather_projected(before, context),
    inventory_projected(receipt, context.snapshot.inventory),
  ].every(Boolean)
}
