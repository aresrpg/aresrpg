// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { receipt_digest, type Receipt } from '@aresrpg/sdk/cache'

import { fold_market_receipt, market_receipt_relation } from './actor_market.ts'
import type { ActorInventory } from './actor_inventory.ts'
import type { Command, Lane } from './control.ts'
import type { ControlStore } from './store.ts'
import { lane_key_for } from './command_admission.ts'

/** Session-only proof pointers; reconnects retain certified catalogue watermarks in memory. */
export const settled_market_receipts = (lane: Lane, command: Command, receipt: Receipt): Lane['catalogue_receipts'] => {
  const relation = market_receipt_relation(command, receipt)
  if (!relation) return lane.catalogue_receipts
  const current = lane.catalogue_receipts?.[relation.kiosk]
  if (current && BigInt(current.version) >= BigInt(relation.version)) return lane.catalogue_receipts
  return {
    ...lane.catalogue_receipts,
    [relation.kiosk]: {
      digest: receipt_digest(receipt),
      version: relation.version,
      command_id: command.id,
    },
  }
}
type MarketProof = Readonly<{ command: Command; receipt: Receipt }>
const assert_proof = (
  lane: Lane,
  kiosk: string,
  pointer: NonNullable<Lane['catalogue_receipts']>[string],
  command: Command,
  receipt: Receipt
) => {
  const relation = market_receipt_relation(command, receipt)
  const valid = [
    command.id === pointer.command_id,
    command.lane_key === lane_key_for(lane),
    command.status === 'completed',
    (command.result as { digest?: string } | undefined)?.digest === pointer.digest,
    receipt_digest(receipt) === pointer.digest,
    relation?.kiosk === kiosk,
    relation?.version === pointer.version,
  ]
  if (!valid.every(Boolean)) throw new Error('market_receipt_proof_invalid')
}
// A newer settlement for the same kiosk releases the older proof; it is folded on the next read instead.
const superseded = async (store: ControlStore, lane: Lane, kiosk: string, command_id: string) => {
  const current = (await store.read<Lane>(lane_key_for(lane)))?.catalogue_receipts?.[kiosk]
  return Boolean(current) && current?.command_id !== command_id
}
export const read_market_receipts = async (store: ControlStore, lane: Lane): Promise<readonly MarketProof[]> => {
  const proofs: MarketProof[] = []
  for (const [kiosk, pointer] of Object.entries(lane.catalogue_receipts ?? {})) {
    const command = await store.read<Command>(`command:${pointer.command_id}`)
    if (!command && (await superseded(store, lane, kiosk, pointer.command_id))) continue
    if (!command?.receipt) throw new Error('market_receipt_proof_invalid')
    assert_proof(lane, kiosk, pointer, command, command.receipt)
    proofs.push({ command, receipt: command.receipt })
  }
  return proofs
}
export const fold_market_receipts = (proofs: readonly MarketProof[], inventory: ActorInventory): ActorInventory =>
  proofs.reduce((state, { command, receipt }) => fold_market_receipt(state, command, receipt), inventory)
