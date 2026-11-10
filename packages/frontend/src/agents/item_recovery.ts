// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentItemReturnOffer } from '@aresrpg/sdk/agent-returns'

const claim_key = (offer: AgentItemReturnOffer) =>
  JSON.stringify([offer.agent_address, offer.recipient, offer.seller_kiosk, offer.item_id, offer.purchase_cap])
type Attempts = Readonly<Record<string, 'attempted' | 'complete'>>

/** Session-scoped gesture fences only. Caps and the SDK journal remain the sole custody and execution owners. */
export const item_claim_attempts = (storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, owner: string) => {
  const key = `aresrpg:item-claim-attempts:${owner}`
  const read = (): Attempts => {
    const value: unknown = JSON.parse(storage.getItem(key) ?? '{}')
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !Object.values(value).every((entry) => entry === 'attempted' || entry === 'complete')
    )
      throw new Error('Item transfer attempt history is unavailable. No automatic claim was started.')
    return value as Attempts
  }
  const write = (values: Attempts) =>
    Object.keys(values).length ? storage.setItem(key, JSON.stringify(values)) : storage.removeItem(key)
  return {
    status: (offer: AgentItemReturnOffer) => read()[claim_key(offer)],
    begin: (offers: readonly AgentItemReturnOffer[], automatic: boolean) => {
      const previous = read(),
        keys = offers.map(claim_key)
      if (keys.some((item) => previous[item] === 'complete' || (automatic && previous[item])))
        throw new Error('This item transfer needs reconciliation before another attempt.')
      write({ ...previous, ...Object.fromEntries(keys.map((item) => [item, 'attempted' as const])) })
    },
    complete: (offers: readonly AgentItemReturnOffer[]) =>
      write({
        ...read(),
        ...Object.fromEntries(offers.map((item) => [claim_key(item), 'complete' as const])),
      }),
    // Snapshot only already-completed fences before starting discovery. A stale in-flight read cannot retire a later receipt.
    completed: () =>
      Object.entries(read())
        .filter(([, state]) => state === 'complete')
        .map(([key]) => key),
    retire: (completed: readonly string[], pending: readonly AgentItemReturnOffer[], accounts: readonly string[]) => {
      const held = new Set(pending.map(claim_key))
      write(
        Object.fromEntries(
          Object.entries(read()).filter(([key, state]) => {
            const [source, recipient] = JSON.parse(key) as string[]
            return (
              state !== 'complete' ||
              !completed.includes(key) ||
              held.has(key) ||
              !accounts.includes(source!) ||
              !accounts.includes(recipient!)
            )
          })
        )
      )
    },
  }
}
