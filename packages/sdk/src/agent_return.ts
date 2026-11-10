// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag, SUI_TYPE_ARG } from '@mysten/sui/utils'

import type { Sdk } from './client.ts'
import type { KioskCapLoader } from './kiosk_runner.ts'
import { read_personal_kiosks } from './kiosk_discovery.ts'
import { read_agent_equipment, same_agent_equipment } from './agent_equipment.ts'
import { read_agent_recovery_assets } from './agent_inventory.ts'
import { read_agent_returns, read_agent_item_returns, check_agent_return } from './agent_returns.ts'
import {
  agent_transfer_actions,
  execute_agent_transfer,
  type AgentTransferActions,
  type AgentTransferIntent,
} from './agent_transfer_actions.ts'
import { complete_agent_batches, claim_agent_batches } from './agent_handover.ts'
import { read_agent_batch_limits } from './agent_batch_limits.ts'
import { return_funding, quote_return_transaction } from './agent_return_funding.ts'
import { return_character_custody, type ReturnProjectionReader } from './agent_return_custody.ts'
import { marketplace_actions } from './marketplace.ts'
import { sui_transfer_ptb } from './sui_transfer.ts'
import { kares_coin_type } from './kares_ptb.ts'
import { receipt_digest } from './cache.ts'

export { AgentReturnFundingRequired } from './agent_return_funding.ts'
export type { AgentReturnProjection, ReturnProjectionReader } from './agent_return_custody.ts'
export type AgentReturnOptions = Readonly<{
  read_projection: ReturnProjectionReader
  before_sign: () => void
  guard: () => Promise<void>
}>
type ReturnContext = AgentReturnOptions &
  Readonly<{
    sdk: Sdk
    owner_sdk: Sdk
    client: SuiGrpcClient
    agent: string
    owner: string
    owner_kiosk_cap: KioskCapLoader
  }>

/** One bounded owner operation. Existing caps and custody are the resume state; the SDK journal owns uncertainty. */
export const return_agent_assets = async (context: ReturnContext): Promise<void> => {
  const { sdk, owner_sdk, client, agent, owner, before_sign, guard, read_projection } = context
  before_sign()
  await guard()
  if ((await Promise.all([sdk.recover_pending_transaction(), owner_sdk.recover_pending_transaction()])).some(Boolean))
    throw new Error('[sdk] previous transaction recovered; reload before continuing the return')
  const kiosk_cap: KioskCapLoader = async (id) => {
    const caps = await read_personal_kiosks(sdk, agent)
    return (id ? caps.find(({ kioskId }) => kioskId === id) : caps[0]) ?? null
  }
  const synchronize = () => Promise.all([sdk.synchronize_transactions(), owner_sdk.synchronize_transactions()])
  const funding = return_funding(context)
  const batch_limits = await read_agent_batch_limits(client)
  const actions = agent_transfer_actions(sdk, {
    address: agent,
    kiosk_cap,
    budget: 'estimate',
    batch_limits,
    assets: {
      client,
      recipient: () => {
        before_sign()
        return owner
      },
    },
    check_return: (intent) => check_agent_return(client, sdk, agent, intent),
    check_offer: async (intent) => {
      before_sign()
      if (intent.recipient !== owner) throw new Error('Return recipient changed.')
      if (
        !same_agent_equipment(
          await read_agent_equipment(client, sdk.game_type_package!, intent.character_id),
          intent.unequip
        )
      )
        throw new Error('Equipment changed before return.')
    },
  })
  const owner_actions = agent_transfer_actions(owner_sdk, {
    address: owner,
    kiosk_cap: context.owner_kiosk_cap,
    budget: 'estimate',
    batch_limits,
    assets: { client },
    check_return: (intent) => check_agent_return(client, owner_sdk, owner, intent),
  })
  const before_step = async (action: AgentTransferActions, intent: AgentTransferIntent) => {
    before_sign()
    await synchronize()
    await funding.ensure(action.sender, await action.quote(intent))
    await guard()
    before_sign()
  }
  const execute = async (action: AgentTransferActions, intent: AgentTransferIntent) => {
    await before_step(action, intent)
    return execute_agent_transfer({
      actions: action,
      intent,
      is_current: () => {
        before_sign()
        return true
      },
    })
  }
  const incoming = {
    characters: async () => {
      await synchronize()
      return read_agent_returns(client, sdk, owner, agent)
    },
    items: async () => {
      await synchronize()
      return read_agent_item_returns(client, sdk, owner, agent)
    },
  }
  const returned_ids = new Set<string>()
  const mark_character = (id: string, equipment: readonly Readonly<{ item_id: string }>[] = []) =>
    [id, ...equipment.map(({ item_id }) => item_id)].forEach((item) => returned_ids.add(item))
  // Finish interrupted handovers first, in both directions, preserving receipt-linked equipment.
  const [pending_characters, pending_items] = await Promise.all([incoming.characters(), incoming.items()])
  await claim_agent_batches(owner_actions, agent, pending_characters, pending_items, { before_sign, before_step })
  pending_characters.forEach((row) => mark_character(row.character_id, row.equipment))
  pending_items.forEach(({ item_id }) => returned_ids.add(item_id))
  await read_projection((value) => value.characters.every(({ id }) => !returned_ids.has(id)))
  const [incoming_characters, deposits] = await Promise.all([
    read_agent_returns(client, sdk, agent, owner),
    read_agent_item_returns(client, sdk, agent, owner),
  ])
  await claim_agent_batches(actions, owner, incoming_characters, deposits, { before_sign, before_step })
  if (incoming_characters.length)
    await read_projection((value) =>
      incoming_characters.every(({ character_id }) => value.characters.some(({ id }) => id === character_id))
    )

  const funded_sdk = funding.funded(sdk, agent)
  await return_character_custody(funded_sdk, kiosk_cap, agent, read_projection)
  const audit = async () => {
    await synchronize()
    return read_agent_recovery_assets(client, sdk, agent)
  }
  const auxiliaries = await audit()
  if (auxiliaries.proceeds.length) await execute(actions, { kind: 'asset_collect', items: auxiliaries.proceeds })
  for (const position of auxiliaries.positions) await execute(actions, { kind: 'asset_unstake', items: [position] })
  const marketplace = marketplace_actions(funded_sdk, { address: agent, kiosk_cap })
  for (const asset of (await audit()).kiosk_assets)
    if (asset.listed && !asset.exclusive) await marketplace.delist(asset)

  const inventory = await audit()
  const characters = await Promise.all(
    inventory.kiosk_assets
      .filter(({ kind, exclusive }) => kind === 'character' && !exclusive)
      .map(async (row) => ({
        character_id: row.id,
        kiosk: row.kiosk,
        unequip: await read_agent_equipment(client, sdk.game_type_package!, row.id),
      }))
  )
  const held = inventory.kiosk_assets.filter(({ kind, exclusive }) => kind === 'item' && !exclusive)
  await sdk.hydrate(held.map(({ id }) => id))
  const items = [
    ...held.map(({ id, kiosk }) => {
      const version = sdk.ref(id)?.version
      if (!version) throw new Error('Return item revision is unavailable.')
      return { item_id: id, kiosk, version }
    }),
    ...inventory.items.map(({ item }) => ({
      item_id: item.id,
      kiosk: item.kiosk,
      version: item.version!,
      direct: true,
    })),
  ]
  await complete_agent_batches({
    offer: actions,
    claim: owner_actions,
    recipient: owner,
    characters,
    items,
    read: incoming,
    before_sign,
    before_step,
  })
  characters.forEach((row) => mark_character(row.character_id, row.unequip))
  const kares = await sdk.read_kares_balance()
  if (kares && kares > 0n)
    await execute(actions, {
      kind: 'asset_offer',
      items: [],
      recipient: owner,
      sui_mist: '0',
      kares_mist: String(kares),
      reserve_mist: '0',
    })
  await sweep_return_sui(context, funding)
  items.forEach(({ item_id }) => returned_ids.add(item_id))
  const projection = await read_projection((value) =>
    [...value.characters, ...value.inventory].every(({ id }) => !returned_ids.has(id))
  )
  const remaining = await audit()
  const supported_coins = new Set([
    normalizeStructTag(`0x2::coin::Coin<${SUI_TYPE_ARG}>`),
    ...(sdk.pins.kares_coin_type
      ? [normalizeStructTag(`0x2::coin::Coin<${kares_coin_type(sdk.pins.kares_coin_type)}>`)]
      : []),
  ])
  const retained_shells = new Set([...remaining.kiosk_caps, ...remaining.exhausted_positions])
  const opaque = remaining.owned.filter(
    (item) => !retained_shells.has(item.id) && !supported_coins.has(normalizeStructTag(item.type))
  )
  if (
    [
      projection.characters.length,
      projection.inventory.length,
      remaining.kiosk_assets.length,
      remaining.items.length,
      remaining.positions.length,
      remaining.proceeds.length,
      remaining.other_kiosk_objects.length,
      opaque.length,
    ].some(Boolean)
  )
    throw new Error('Some assets could not be returned. The bot remains stopped; resume after resolving their custody.')
}

const sweep_return_sui = async (context: ReturnContext, funding: ReturnType<typeof return_funding>) => {
  let balance = await funding.balance(context.agent)
  while (balance > 0n) {
    const transaction = sui_transfer_ptb({ sender: context.agent, recipient: context.owner, amount_mist: null })
    const quote = await quote_return_transaction(context.client, context.agent, transaction, true)
    await funding.ensure(context.agent, quote)
    await context.guard()
    context.before_sign()
    const receipt = await context.sdk.execute(transaction, {
      budget: quote.budget_mist,
      before_sign: context.before_sign,
    })
    await context.client.core.waitForTransaction({ digest: receipt_digest(receipt) })
    const remaining = await funding.balance(context.agent)
    if (remaining >= balance)
      throw new Error('The remaining balance changed. The bot remains stopped; refresh before continuing.')
    balance = remaining
  }
}
