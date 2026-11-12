// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { receipt_digest, type Receipt } from '@aresrpg/sdk/cache'

import { fold_market_receipt, market_receipt_relation } from './actor_market.ts'
import type { ActorInventory } from './actor_inventory.ts'
import type { Command, Lane } from './control.ts'
import type { ControlStore } from './store.ts'
import { lane_key_for } from './command_admission.ts'

/** Durable proof pointers only; certified receipt history remains the source of truth. */
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
  record: Readonly<{ digest: string; receipt: Receipt }>
) => {
  const relation = market_receipt_relation(command, record.receipt)
  const valid = [
    command.id === pointer.command_id,
    command.lane_key === lane_key_for(lane),
    command.status === 'completed',
    (command.result as { digest?: string } | undefined)?.digest === pointer.digest,
    record.digest === pointer.digest,
    receipt_digest(record.receipt) === pointer.digest,
    relation?.kiosk === kiosk,
    relation?.version === pointer.version,
  ]
  if (!valid.every(Boolean)) throw new Error('market_receipt_proof_invalid')
}
export const read_market_receipts = async (store: ControlStore, lane: Lane): Promise<readonly MarketProof[]> => {
  const proofs: MarketProof[] = []
  for (const [kiosk, pointer] of Object.entries(lane.catalogue_receipts ?? {})) {
    const [command, record] = await Promise.all([
      store.read<Command>(`command:${pointer.command_id}`),
      store.read<{ digest: string; receipt: Receipt }>(`receipt:${pointer.digest}`),
    ])
    if (!command || !record) throw new Error('market_receipt_proof_invalid')
    assert_proof(lane, kiosk, pointer, command, record)
    proofs.push({ command, receipt: record.receipt })
  }
  return proofs
}
export const fold_market_receipts = (proofs: readonly MarketProof[], inventory: ActorInventory): ActorInventory =>
  proofs.reduce((state, { command, receipt }) => fold_market_receipt(state, command, receipt), inventory)
export const restore_market_receipts = async (store: ControlStore, lane: Lane, inventory: ActorInventory) =>
  fold_market_receipts(await read_market_receipts(store, lane), inventory)
