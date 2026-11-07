// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useMemo, useReducer, useState } from 'react'
import { GAS_BUDGET_MIST } from '@aresrpg/sdk'
import type { AgentPairingIdentity, ItemRow } from '@aresrpg/protocol'
import type { AgentInventory } from '@aresrpg/sdk/agent-inventory'
import type { AgentRecall } from '@aresrpg/sdk/agent-recall'
import type { AgentTransferActions, AgentTransferIntent } from '@aresrpg/sdk/agent-transfer-actions'
import type { AgentItemReturnOffer } from '@aresrpg/sdk/agent-returns'

import type { AuthSession } from '../auth.ts'
import { useAppStore } from '../store.ts'
import { toast } from '../toast.ts'
import { readable_transaction_error } from '../transaction_guard.ts'
import type { AppCopy } from '../i18n/copy.ts'

import { selected_transfer_items, type TransferDirection } from './inventory_transfer.ts'

type Snapshot = Readonly<{
  wallet: AuthSession
  pairing: AgentPairingIdentity
  recall: AgentRecall
  deposit: AgentTransferActions | null
  inventory: AgentInventory
  withdrawals: readonly AgentItemReturnOffer[]
  deposits: readonly AgentItemReturnOffer[]
}>
type State = Readonly<{ phase: 'idle' | 'loading' | 'ready' | 'failed'; snapshot?: Snapshot; error?: string }>
type Input = Readonly<{ type: 'load' } | { type: 'ready'; snapshot: Snapshot } | { type: 'failed'; error: string }>
const reduce = (state: State, input: Input): State => {
  switch (input.type) {
    case 'load':
      return { ...state, phase: 'loading', error: undefined }
    case 'ready':
      return { phase: 'ready', snapshot: input.snapshot }
    case 'failed':
      return { ...state, phase: 'failed', error: input.error }
  }
}
export type KioskReview = Readonly<{ actions: AgentTransferActions; intent: AgentTransferIntent }>

const same_target = (
  source: Readonly<{ wallet: AuthSession | null; pairing: AgentPairingIdentity | null }> | null | undefined,
  wallet: AuthSession | null,
  pairing: AgentPairingIdentity | null
): boolean => source?.wallet === wallet && source?.pairing === pairing

const transfer_routes = (snapshot: Snapshot, player_items: readonly ItemRow[]) => ({
  deposit: {
    offer: snapshot.deposit,
    claim: snapshot.recall.transfer,
    can_claim: snapshot.deposit !== null,
    sender: snapshot.wallet.address,
    recipient: snapshot.pairing.address,
    pending: snapshot.deposits,
    items: player_items.map((item) => ({ item, status: 'available' as const })),
  },
  withdraw: {
    offer: snapshot.recall.transfer,
    claim: snapshot.wallet.agent_transfer,
    can_claim: true,
    sender: snapshot.pairing.address,
    recipient: snapshot.wallet.address,
    pending: snapshot.withdrawals,
    items: snapshot.inventory.items,
  },
})

/** Read-only discovery and modal-local intent. The SDK remains the only transaction authority. */
export const useAgentKiosk = (copy: AppCopy, offline: boolean) => {
  const wallet = useAppStore((app) => app.session.wallet)
  const pairing = useAppStore((app) => app.session.inventory_pairing)
  const [state, dispatch] = useReducer(reduce, { phase: 'idle' })
  const [revision, set_revision] = useState(0)
  const [pending_review, set_pending_review] = useState<
    (KioskReview & Readonly<{ wallet: AuthSession | null; pairing: AgentPairingIdentity | null }>) | null
  >(null)
  const review = same_target(pending_review, wallet, pairing) ? pending_review : null
  const set_review = (next: KioskReview | null) => set_pending_review(next && { ...next, wallet, pairing })
  const refresh = () => set_revision((value) => value + 1)
  useEffect(() => {
    if (!wallet || !pairing || offline) return
    let current = true
    dispatch({ type: 'load' })
    void wallet
      .read_agent_recall(pairing)
      .then(async (recall) => {
        const [inventory, withdrawals, deposits] = await Promise.all([
          recall.read_inventory(),
          recall.read_incoming_items(),
          recall.read_deposit_items(),
        ])
        const deposit = pairing.signer_mode === 'host-persistent' ? wallet.agent_deposit(pairing) : null
        if (current)
          dispatch({ type: 'ready', snapshot: { wallet, pairing, recall, deposit, inventory, withdrawals, deposits } })
      })
      .catch((error) => {
        if (current) dispatch({ type: 'failed', error: readable_transaction_error(error) })
      })
    return () => {
      current = false
    }
  }, [wallet, pairing, revision, offline])
  const snapshot = !offline && same_target(state.snapshot, wallet, pairing) ? state.snapshot : undefined
  const routes = snapshot ? transfer_routes(snapshot, []) : null
  const pending_deposit_ids = useMemo(() => new Set(snapshot?.deposits.map(({ item_id }) => item_id)), [snapshot])
  const offer = (ids: readonly string[], direction: TransferDirection, player_items: readonly ItemRow[] = []): void => {
    if (!snapshot || review || state.phase !== 'ready') return
    const route = transfer_routes(snapshot, player_items)[direction]
    if (!route.offer) return void toast.add(copy.ui.agent_pair_for_deposit, 'info')
    const items = selected_transfer_items(route.items, ids)
    if (!items) return void toast.add(copy.characters_page.refusal_unavailable, 'info')
    set_review({
      actions: route.offer,
      intent: {
        kind: 'asset_offer',
        items,
        recipient: route.recipient,
        sui_mist: '0',
        kares_mist: '0',
        reserve_mist: String(GAS_BUDGET_MIST),
      },
    })
  }
  const incoming = (direction: TransferDirection, cancel: boolean): void => {
    if (!routes || review || state.phase !== 'ready') return
    const route = routes[direction]
    if (!cancel && !route.can_claim) return
    if (!route.pending.length) return
    set_review({
      actions: route.claim,
      intent: { kind: cancel ? 'asset_cancel' : 'asset_claim', agent_address: route.sender, items: route.pending },
    })
  }

  return { wallet, pairing, snapshot, routes, state, refresh, offer, incoming, review, set_review, pending_deposit_ids }
}
export type AgentKioskController = ReturnType<typeof useAgentKiosk>
