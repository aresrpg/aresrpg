// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  execute_agent_transfer,
  type AgentTransferActions,
  type AgentTransferIntent,
} from './agent_transfer_actions.ts'
import type { AgentReturnOffer, AgentItemReturnOffer } from './agent_returns.ts'
import { submit_agent_batches } from './agent_batch_limits.ts'
import type { AgentBatchCharacter } from './agent_batch.ts'
import type { RecallItem } from './agent_asset_transfer.ts'
import { same_agent_equipment } from './agent_equipment.ts'
import { transaction_resolution_error } from './transaction_error.ts'

export type AgentHandoverIntent = Extract<AgentTransferIntent, { kind: 'offer' | 'asset_offer' }>
type Claim = Extract<AgentTransferIntent, { kind: 'claim' | 'asset_claim' | 'asset_cancel' }>
type Readers = Readonly<{
  characters: () => Promise<readonly AgentReturnOffer[]>
  items: () => Promise<readonly AgentItemReturnOffer[]>
}>

/** A confirmed offer survives failed claim preparation, dismissal and reload as ordinary on-chain caps. */
export class AgentHandoverIncomplete extends Error {
  readonly offer_digest: string | null
  constructor(cause: unknown, offer_digest: string | null) {
    super('The transfer is awaiting collection. Refresh the inventory to resume or cancel.', { cause })
    // eslint-disable-next-line functional/no-this-expressions -- Error metadata retains the confirmed offer digest for recovery.
    this.offer_digest = offer_digest
  }
}

/** Presentation failure cannot turn an already executed offer into a retryable preparation failure. */
const notify_offer = (notify: ((digest: string) => void) | undefined, digest: string): void => {
  try {
    notify?.(digest)
  } catch (error) {
    throw new AgentHandoverIncomplete(error, digest)
  }
}

const character_claim = (
  intent: Extract<AgentHandoverIntent, { kind: 'offer' }>,
  offers: readonly AgentReturnOffer[],
  sender: string
): Claim | null => {
  const matching = offers.filter(({ character_id }) => character_id === intent.character_id)
  if (!matching.length) return null
  const offer = matching[0]!
  if (
    matching.length !== 1 ||
    offer.seller_kiosk !== intent.kiosk ||
    offer.recipient !== intent.recipient ||
    offer.agent_address !== sender ||
    !same_agent_equipment(offer.equipment, intent.unequip)
  )
    throw new Error('The pending character transfer does not match this selection.')
  return { kind: 'claim', ...offer }
}

const item_claim = (
  intent: Extract<AgentHandoverIntent, { kind: 'asset_offer' }>,
  offers: readonly AgentItemReturnOffer[],
  sender: string
): Claim | null => {
  const selected = new Map(intent.items.map((item) => [item.item_id, item]))
  const valid_intent = [
    selected.size > 0,
    selected.size === intent.items.length,
    intent.sui_mist === '0',
    intent.kares_mist === '0',
  ]
  if (!valid_intent.every(Boolean)) throw new Error('Automatic item handover requires an exact item set without coins.')
  const matching = offers.filter(({ item_id }) => selected.has(item_id))
  if (!matching.length) return null
  const exact = [
    matching.length === selected.size,
    new Set(matching.map(({ item_id }) => item_id)).size === selected.size,
    matching.every((offer) => {
      const item = selected.get(offer.item_id)!
      return (
        offer.recipient === intent.recipient &&
        offer.agent_address === sender &&
        (item.direct || offer.seller_kiosk === item.kiosk)
      )
    }),
  ]
  if (!exact.every(Boolean)) throw new Error('The pending item transfer does not match this selection.')
  return { kind: 'asset_claim', agent_address: sender, items: matching }
}

/** One gesture offers then claims. Reentry resumes matching caps; no submitted transaction is retried. */
export const complete_agent_handover = async ({
  offer,
  claim,
  intent,
  read,
  before_sign,
  on_offer,
  before_step,
}: Readonly<{
  offer: AgentTransferActions
  claim: AgentTransferActions
  intent: AgentHandoverIntent
  read: Readers
  before_sign: () => void
  on_offer?: (digest: string) => void
  before_step?: (actions: AgentTransferActions, intent: AgentTransferIntent) => Promise<void>
}>) => {
  const snapshot = structuredClone(intent)
  const pending = async () =>
    snapshot.kind === 'offer'
      ? character_claim(snapshot, await read.characters(), offer.sender)
      : item_claim(snapshot, await read.items(), offer.sender)
  const execute = async (actions: AgentTransferActions, input: AgentTransferIntent) => {
    before_sign()
    await before_step?.(actions, input)
    return execute_agent_transfer({
      actions,
      intent: input,
      is_current: () => {
        before_sign()
        return true
      },
    })
  }
  let incoming: Claim | null
  try {
    before_sign()
    if (![snapshot.recipient === claim.sender, offer.sender !== claim.sender].every(Boolean))
      throw new Error('Transfer signer or recipient mismatch.')
    incoming = await pending()
  } catch (error) {
    throw transaction_resolution_error(error)
  }
  let offer_digest: string | null = null
  if (!incoming) {
    offer_digest = (await execute(offer, snapshot)).digest
    notify_offer(on_offer, offer_digest)
  }
  try {
    before_sign()
    incoming ??= await pending()
    if (!incoming) throw new Error('The confirmed transfer capabilities are not visible yet.')
    return await execute(claim, incoming)
  } catch (error) {
    throw new AgentHandoverIncomplete(error, offer_digest)
  }
}

export type AgentBatchHooks = Readonly<{
  before_sign: () => void
  before_step: (actions: AgentTransferActions, intent: AgentTransferIntent) => Promise<void>
}>

/** Claim batches keep each character and its gear indivisible; completed batches are never replayed. */
export const claim_agent_batches = async (
  actions: AgentTransferActions,
  source: string,
  characters: readonly AgentReturnOffer[],
  items: readonly AgentItemReturnOffer[],
  hooks: AgentBatchHooks
) => {
  const rows = [
    ...characters.map((value) => ({ kind: 'character' as const, value })),
    ...items.map((value) => ({ kind: 'item' as const, value })),
  ]
  const intent = (batch: readonly (typeof rows)[number][]): AgentTransferIntent => ({
    kind: 'claim_batch',
    agent_address: source,
    characters: batch.flatMap((row) => (row.kind === 'character' ? [row.value] : [])),
    items: batch.flatMap((row) => (row.kind === 'item' ? [row.value] : [])),
  })
  await submit_agent_batches(
    rows,
    (batch) => actions.fits(intent(batch)),
    async (batch) => {
      const selected = intent(batch)
      await hooks.before_step(actions, selected)
      return execute_agent_transfer({
        actions,
        intent: selected,
        is_current: () => {
          hooks.before_sign()
          return true
        },
      })
    }
  )
}

/** Offer PTBs precede claim PTBs because the chain creates the receiving caps. Each stage packs multiple assets. */
export const complete_agent_batches = async (
  options: AgentBatchHooks &
    Readonly<{
      offer: AgentTransferActions
      claim: AgentTransferActions
      recipient: string
      characters: readonly AgentBatchCharacter[]
      items: readonly RecallItem[]
      read: Readers
    }>
) => {
  const rows = [
    ...options.characters.map((value) => ({ kind: 'character' as const, value })),
    ...options.items.map((value) => ({ kind: 'item' as const, value })),
  ]
  const intent = (batch: readonly (typeof rows)[number][]): AgentTransferIntent => ({
    kind: 'offer_batch',
    recipient: options.recipient,
    characters: batch.flatMap((row) => (row.kind === 'character' ? [row.value] : [])),
    items: batch.flatMap((row) => (row.kind === 'item' ? [row.value] : [])),
  })
  let digest: string | null = null
  await submit_agent_batches(
    rows,
    (batch) => options.offer.fits(intent(batch)),
    async (batch) => {
      const selected = intent(batch)
      await options.before_step(options.offer, selected)
      const result = await execute_agent_transfer({
        actions: options.offer,
        intent: selected,
        is_current: () => {
          options.before_sign()
          return true
        },
      })
      ;({ digest } = result)
    }
  )
  try {
    const [characters, items] = await Promise.all([options.read.characters(), options.read.items()])
    const selected_characters = options.characters.map((row) => {
      const selected = character_claim(
        { ...row, kind: 'offer', recipient: options.recipient },
        characters,
        options.offer.sender
      )
      if (!selected || selected.kind !== 'claim') throw new Error('A character return cap is not visible yet.')
      return { ...selected, recipient: options.recipient, agent_address: options.offer.sender }
    })
    const selected_items = options.items.length
      ? item_claim(
          {
            kind: 'asset_offer',
            items: options.items,
            recipient: options.recipient,
            sui_mist: '0',
            kares_mist: '0',
            reserve_mist: '0',
          },
          items,
          options.offer.sender
        )
      : null
    if (options.items.length && (!selected_items || selected_items.kind !== 'asset_claim'))
      throw new Error('An item return cap is not visible yet.')
    await claim_agent_batches(
      options.claim,
      options.offer.sender,
      selected_characters,
      selected_items?.kind === 'asset_claim' ? selected_items.items : [],
      options
    )
  } catch (error) {
    throw new AgentHandoverIncomplete(error, digest)
  }
}
