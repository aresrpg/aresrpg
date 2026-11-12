// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterRow } from '@aresrpg/protocol'
import { same_fight_turn } from '@aresrpg/fight'
import { receipt_digest, receipt_event, type Receipt } from '@aresrpg/sdk/cache'

import { consumable_baseline, consumable_projected, type ConsumableBaseline } from './consumable_projection.ts'
import { EQUIPMENT_ACTIONS, equipment_projected } from './equipment_actions.ts'
import { market_sell_projected } from './market_actions.ts'
import { loot_boxes_projected } from './loot_boxes.ts'
import { stat_baseline, stats_projected, type StatBaseline, type StatSpending } from './stat_allocation.ts'
import { owned_character } from './gameplay_context.ts'
import { zone_key } from './actor_world.ts'
import { assert_lease, type Command, type Lane } from './control.ts'
import { hydrate_gameplay_fight } from './gameplay.ts'
import type { GameplayContext } from './gameplay_context.ts'
import { step_observation, receipt_projected, type ProfessionBaseline } from './action_receipts.ts'
import { inventory_projected } from './actor_inventory.ts'
import type { ControlStore } from './store.ts'

export type ActionBaseline = Readonly<{
  checkpoint_ms: number
  stats?: StatBaseline
  profession?: ProfessionBaseline
  consumable?: ConsumableBaseline
}>
export const bind_action_baseline = (command: Command, context: GameplayContext): Command => ({
  ...command,
  fight_baseline: command.fight_baseline ?? context.snapshot.fights[String(command.payload.fight)],
  action_baseline: command.action_baseline ?? {
    checkpoint_ms: Number(
      context.snapshot.characters.find(({ id }) => id === command.payload.character_id)?.at_ms ?? 0
    ),
    ...(command.kind === 'raise_stats'
      ? { stats: stat_baseline(owned_character(context, String(command.payload.character_id))) }
      : {}),
    ...(command.kind === 'use_consumable' ? { consumable: consumable_baseline({ ...context, command }) } : {}),
    ...(['gather', 'craft'].includes(command.kind) ? { profession: step_observation(command, context) } : {}),
  },
})

const projected_fight = (command: Command, context: GameplayContext): boolean => {
  const row = context.snapshot.fights[String(command.payload.fight)]
  if (!row || !command.fight_baseline) return false
  const current = hydrate_gameplay_fight(row).contract
  const before = hydrate_gameplay_fight(command.fight_baseline).contract
  const fighter = current.fighters[Number(command.payload.fighter_idx)]
  const checks: Partial<Record<Command['kind'], () => boolean>> = {
    fight_place: () => fighter?.cell === BigInt(String(command.payload.cell)),
    fight_ready: () => current.round > 0n || fighter?.ready === true,
    fight_start: () => current.round > 0n,
    fight_turn: () => current.ended || (current.round >= before.round && !same_fight_turn(before, current)),
  }
  return checks[command.kind === 'fight_crank' ? 'fight_turn' : command.kind]?.() ?? false
}
export const action_projected = (command: Command, receipt: Receipt, context: GameplayContext): boolean => {
  if (
    !command.action_baseline ||
    command.status !== 'completed' ||
    receipt_digest(receipt) !== (command.result as { digest?: string })?.digest
  )
    return false
  const character = context.snapshot.characters.find(({ id }) => id === command.payload.character_id)
  if (!character) return false
  if (['craft', 'gather'].includes(command.kind))
    return Boolean(
      command.action_baseline.profession &&
      receipt_projected(command.action_baseline.profession, command, receipt, context)
    )
  return character_projected(command, receipt, context, character)
}
const character_projected = (
  command: Command,
  receipt: Receipt,
  context: GameplayContext,
  character: CharacterRow
): boolean => {
  const checks: Partial<Record<Command['kind'], () => boolean>> = {
    equip_item: () => equipment_projected(EQUIPMENT_ACTIONS.equip_item.parse(command.payload), character),
    use_consumable: () => consumable_projected(command.action_baseline?.consumable, receipt, context, character),
    market_buy: () => inventory_projected(receipt, context.snapshot.inventory),
    market_sell: () => market_sell_projected(command, receipt, context.snapshot.inventory),
    open_loot_boxes: () => loot_boxes_projected(receipt, { ...context, command }),
    claim_loot: () => loot_boxes_projected(receipt, { ...context, command }),
    world_search: () => searched_world(command, receipt, context, character),
    raise_stats: () =>
      stats_projected(command.action_baseline?.stats, command.payload.spending as StatSpending, character),
    equip_tool: () => character.equipment.some(({ slot, id }) => slot === 'tool' && id === command.payload.item_id),
    fight_engage: () =>
      character.active_fight?.id === receipt_event(receipt, '::fight::FightCreated')?.fight &&
      character.custody === 'fight',
    fight_settle: () =>
      character.custody === 'kiosk' &&
      character.active_fight?.id !== command.payload.fight &&
      inventory_projected(receipt, context.snapshot.inventory),
  }
  const check = checks[command.kind === 'resolve_ambush' ? 'fight_engage' : command.kind]
  return check ? check() : projected_fight(command, context)
}

/** Receipt settlement and packet delivery may occur in either order. The same proof handles both. */
export const reconcile_action = async (
  store: ControlStore,
  lane_key: string,
  actor_id: string,
  fence: number,
  context: GameplayContext,
  now: number
) => {
  const retained = await store.read<Lane>(lane_key)
  if (!retained?.reconciliation_command || !context.snapshot.ready) return
  const command_key = `command:${retained.reconciliation_command}`
  const command = await store.read<Command>(command_key)
  const digest = (command?.result as { digest?: string } | undefined)?.digest
  if (!command || !digest) return
  const receipt_key = `receipt:${digest}`
  await store.transaction([lane_key, command_key, receipt_key], async (tx) => {
    const lane = assert_lease(await tx.get<Lane>(lane_key), actor_id, fence, now)
    if (
      lane.pending ||
      lane.reconciliation_command !== command.id ||
      lane.observation_revision !== context.snapshot.observation_revision
    )
      return
    const record = await tx.get<{ receipt: Receipt }>(receipt_key)
    if (!record || !action_projected(command, record.receipt, context)) return
    await tx.put(lane_key, { ...lane, reconciliation_command: null, needs_resync: false })
  })
}

const searched_world = (
  command: Command,
  receipt: Receipt,
  context: GameplayContext,
  character: CharacterRow
): boolean => {
  const event = receipt_event(receipt, '::zone::ZoneSearched')
  if (!event || event.world !== command.payload.world) return false
  const row = context.snapshot.zones[zone_key(String(event.world), Number(event.zone_x), Number(event.zone_z))]
  return [
    character.world === command.payload.world,
    character.x === command.payload.x,
    character.z === command.payload.z,
    Number(character.at_ms) > command.action_baseline!.checkpoint_ms,
    row && [row.zone.seed === String(event.seed), row.zone.searched_at_ms > Number(character.at_ms)].some(Boolean),
    row?.spawns !== null && row?.spawns !== undefined,
  ].every(Boolean)
}
