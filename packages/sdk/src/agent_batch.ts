// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SuiGrpcClient } from '@mysten/sui/grpc'

import type { Sdk } from './client.ts'
import type { EquipChange } from './character_actions.ts'
import type { AgentItemReturnOffer, AgentReturnOffer } from './agent_returns.ts'
import { resolve_kiosk_cap, type KioskCapLoader } from './kiosk_runner.ts'
import { offer_character_caps, claim_character_caps } from './agent_transactions.ts'
import {
  compose_agent_assets,
  check_agent_item_claims,
  claim_agent_items,
  type RecallItem,
} from './agent_asset_transfer.ts'
import type { AgentBatchLimits } from './agent_batch_limits.ts'

export type AgentBatchCharacter = Readonly<{ character_id: string; kiosk: string; unequip?: readonly EquipChange[] }>
export type AgentBatchIntent = Readonly<
  | { kind: 'offer_batch'; recipient: string; characters: readonly AgentBatchCharacter[]; items: readonly RecallItem[] }
  | {
      kind: 'claim_batch'
      agent_address: string
      characters: readonly AgentReturnOffer[]
      items: readonly AgentItemReturnOffer[]
    }
>
export const is_agent_batch = (input: Readonly<{ kind: string }>): input is AgentBatchIntent =>
  input.kind === 'offer_batch' || input.kind === 'claim_batch'
type Context = Readonly<{
  address: string
  client: SuiGrpcClient
  kiosk_cap: KioskCapLoader
  limits: AgentBatchLimits
  recipient?: () => string
  check_offer: (input: AgentBatchCharacter & Readonly<{ kind: 'offer'; recipient: string }>) => Promise<void>
  check_return: (input: AgentReturnOffer & Readonly<{ kind: 'claim' }>) => Promise<void>
}>
const unique = (ids: readonly string[]) => {
  if (!ids.length || new Set(ids).size !== ids.length)
    throw new Error('Select one exact set of assets without duplicates.')
}

const offer_batch = async (sdk: Sdk, context: Context, intent: Extract<AgentBatchIntent, { kind: 'offer_batch' }>) => {
  unique([
    ...intent.characters.flatMap((row) => [row.character_id, ...(row.unequip ?? []).map(({ item_id }) => item_id)]),
    ...intent.items.map(({ item_id }) => item_id),
  ])
  if (context.address === intent.recipient) throw new Error('Transfer needs a different recipient.')
  await Promise.all(
    intent.characters.map((row) => context.check_offer({ ...row, kind: 'offer', recipient: intent.recipient }))
  )
  await sdk.hydrate(intent.characters.flatMap((row) => (row.unequip ?? []).map(({ item_id }) => item_id)))
  const tx = sdk.tx()
  tx.setSender(context.address)
  const groups = new Map<string, AgentBatchCharacter[]>()
  for (const row of intent.characters) groups.set(row.kiosk, [...(groups.get(row.kiosk) ?? []), row])
  for (const [kiosk_id, characters] of groups) {
    const owner = await resolve_kiosk_cap(context.kiosk_cap, { kiosk: kiosk_id }, true)
    if (!owner) throw new Error('The selected character kiosk is unavailable.')
    sdk.with_personal_kiosk(tx, owner, (kiosk, cap) => {
      const caps = characters.flatMap((row) => offer_character_caps(sdk, tx, kiosk, cap, row))
      for (let index = 0; index < caps.length; index += context.limits.arguments)
        tx.transferObjects(caps.slice(index, index + context.limits.arguments), intent.recipient)
    })
  }
  const chunk = (await context.kiosk_cap()) ? context.limits.arguments : Math.max(1, intent.items.length)
  for (let index = 0; index < intent.items.length; index += chunk)
    await compose_agent_assets(
      context.client,
      sdk,
      context.address,
      {
        kind: 'asset_offer',
        recipient: intent.recipient,
        items: intent.items.slice(index, index + chunk),
        sui_mist: '0',
        kares_mist: '0',
        reserve_mist: '0',
      },
      context.recipient?.(),
      tx
    )
  return tx
}

const claim_batch = async (sdk: Sdk, context: Context, intent: Extract<AgentBatchIntent, { kind: 'claim_batch' }>) => {
  const all = [...intent.characters, ...intent.items]
  if (!all.every((row) => row.recipient === context.address && row.agent_address === intent.agent_address))
    throw new Error('Batch claim sender or recipient changed.')
  unique([
    ...intent.characters.flatMap((row) => [
      row.purchase_cap,
      ...(row.equipment ?? []).map(({ purchase_cap }) => purchase_cap),
    ]),
    ...intent.items.map(({ purchase_cap }) => purchase_cap),
  ])
  await Promise.all(intent.characters.map((row) => context.check_return({ ...row, kind: 'claim' })))
  if (intent.items.length)
    await check_agent_item_claims(context.client, sdk, context.address, {
      kind: 'asset_claim',
      agent_address: intent.agent_address,
      items: intent.items,
    })
  const owner = await context.kiosk_cap()
  const tx = sdk.tx()
  tx.setSender(context.address)
  sdk.with_personal_kiosk(tx, owner, (kiosk, cap) => {
    intent.characters.forEach((row) => claim_character_caps(sdk, tx, kiosk, cap, row))
    claim_agent_items(sdk, tx, kiosk, cap, intent.items)
  })
  return tx
}

/** Many characters, their current gear and standalone items share the same signer and PTB. */
export const compose_agent_batch = (sdk: Sdk, context: Context, intent: AgentBatchIntent) =>
  intent.kind === 'offer_batch' ? offer_batch(sdk, context, intent) : claim_batch(sdk, context, intent)
