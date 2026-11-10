// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useReducer } from 'react'
import type { AgentPairingIdentity, ItemRow } from '@aresrpg/protocol'
import type { AgentInventoryItem } from '@aresrpg/sdk/agent-inventory'
import type { AgentRecall } from '@aresrpg/sdk/agent-recall'
import type { AgentTransferActions } from '@aresrpg/sdk/agent-transfer-actions'
import type { AgentItemReturnOffer, AgentReturnOffer } from '@aresrpg/sdk/agent-returns'

import type { AuthSession } from '../auth.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'
import type { AppCopy } from '../i18n/copy.ts'

import { agent_transfer_error } from './transfer_error.ts'
import { item_claim_attempts } from './item_recovery.ts'
import { useAgentTransaction } from './useAgentTransaction.ts'
import { same_inventory_pairing, type AgentInventoryView } from './inventory_state.ts'
import {
  selected_transfer_items,
  offered_item_ids,
  item_return_group,
  type TransferDirection,
} from './inventory_transfer.ts'

type Snapshot = Readonly<{
  wallet: AuthSession
  pairing: AgentPairingIdentity
  recall: AgentRecall
  deposit: AgentTransferActions | null
  withdrawals: readonly AgentItemReturnOffer[]
  deposits: readonly AgentItemReturnOffer[]
  characters: readonly AgentReturnOffer[]
  pending_characters: readonly AgentReturnOffer[]
  recovery_error?: unknown
}>
export type KioskInventory = Readonly<{
  items: readonly AgentInventoryItem[]
  sui_mist: string | null
  kares_mist: string | null
}>
type KioskSnapshot = Snapshot & Readonly<{ inventory: KioskInventory; reserved_player_items: ReadonlySet<string> }>
type State = Readonly<{ phase: 'idle' | 'loading' | 'ready' | 'failed'; snapshot?: Snapshot; error?: unknown }>
type Input = Readonly<{ type: 'load' } | { type: 'ready'; snapshot: Snapshot } | { type: 'failed'; error: unknown }>
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

/** A damaged capability never hides the independent indexed inventory or coin balance. */
export const read_kiosk_returns = <T>(read: () => Promise<readonly T[]>) =>
  read().then(
    (rows) => ({ rows, error: undefined }),
    (error: unknown) => ({ rows: [] as readonly T[], error })
  )

const discover_transfers = async (wallet: AuthSession, pairing: AgentPairingIdentity): Promise<Snapshot> => {
  const recall = await wallet.read_agent_recall(pairing)
  await Promise.all([wallet.agent_transfer.synchronize(), recall.transfer.synchronize()])
  const [withdrawals, deposits, returns, pending] = await Promise.all([
    read_kiosk_returns(recall.read_incoming_items),
    read_kiosk_returns(recall.read_deposit_items),
    read_kiosk_returns(() => wallet.read_agent_returns(pairing.address)),
    read_kiosk_returns(recall.read_pending_characters),
  ])
  return {
    wallet,
    pairing,
    recall,
    deposit: pairing.signer_mode === 'host-persistent' ? wallet.agent_deposit(pairing) : null,
    withdrawals: withdrawals.rows,
    deposits: deposits.rows,
    characters: returns.rows,
    pending_characters: pending.rows,
    recovery_error: [withdrawals, deposits, returns, pending]
      .map(({ error }) => error)
      .find((error) => error !== undefined),
  }
}

const project_kiosk = (source: Snapshot, view: AgentInventoryView): KioskSnapshot => {
  const listed = new Set(view.catalogue.own_listings.map(({ id }) => id))
  const exclusive = offered_item_ids(source.withdrawals, source.characters)
  return {
    ...source,
    reserved_player_items: offered_item_ids(source.deposits, source.pending_characters),
    inventory: {
      items: view.inventory.map((item) => ({
        item,
        status: listed.has(item.id) || exclusive.has(item.id) ? 'listed' : 'available',
        exclusive: exclusive.has(item.id),
      })),
      sui_mist: view.sui_balance_mist === null ? null : String(view.sui_balance_mist),
      kares_mist: view.kares_balance === null ? null : String(view.kares_balance),
    },
  }
}
const current_snapshot = (
  source: Snapshot | undefined,
  wallet: AuthSession | null,
  pairing: AgentPairingIdentity | null,
  view: AgentInventoryView,
  offline: boolean
) => {
  if (!source || offline) return undefined
  return source.wallet === wallet && same_inventory_pairing(source.pairing, pairing)
    ? project_kiosk(source, view)
    : undefined
}
const kiosk_status = (discovery: State, view: AgentInventoryView, copy: AppCopy, link_ready: boolean) => {
  const error = discovery.error ?? discovery.snapshot?.recovery_error
  return {
    phase: discovery.phase === 'ready' ? (link_ready ? view.phase : 'loading') : discovery.phase,
    error: error
      ? agent_transfer_error(copy, error).message
      : view.phase === 'failed'
        ? copy.kares_page.error_connection
        : undefined,
  }
}
const transfer_routes = (snapshot: KioskSnapshot, player_items: readonly ItemRow[]) => ({
  deposit: {
    offer: snapshot.deposit,
    claim: snapshot.recall.transfer,
    can_claim: snapshot.deposit !== null,
    sender: snapshot.wallet.address,
    recipient: snapshot.pairing.address,
    pending: snapshot.deposits,
    items: player_items.map((item) => ({ item, status: 'available' as const })),
    read: { characters: snapshot.recall.read_pending_characters, items: snapshot.recall.read_deposit_items },
  },
  withdraw: {
    offer: snapshot.recall.transfer,
    claim: snapshot.wallet.agent_transfer,
    can_claim: true,
    sender: snapshot.pairing.address,
    recipient: snapshot.wallet.address,
    pending: snapshot.withdrawals,
    items: snapshot.inventory.items,
    read: {
      characters: () => snapshot.wallet.read_agent_returns(snapshot.pairing.address),
      items: snapshot.recall.read_incoming_items,
    },
  },
})

/** Transaction discovery owns capabilities only; game inventory and balances come from the session reducer. */
export const useAgentKiosk = (copy: AppCopy, offline: boolean) => {
  const wallet = useAppStore((app) => app.session.wallet)
  const pairing = useAppStore((app) => app.session.inventory_pairing)
  const view = useAppStore((app) => app.session.agent_inventory)
  const link_ready = useAppStore((app) => app.session.link_status === 'ready')
  const returning = useAppStore((app) => app.session.agent_connection.phase === 'returning')
  const player_inventory = useAppStore((app) => app.session.inventory)
  const player_listings = useAppStore((app) => app.marketplace.own_listings)
  const listing_revision = JSON.stringify([player_listings, view.catalogue.own_listings])
  const [discovery, dispatch] = useReducer(reduce, { phase: 'idle' })
  const refresh = () => {
    dispatch_app({ type: 'agent/inventory_refresh' })
  }
  const transfer = useAgentTransaction(wallet, pairing, refresh, copy)
  useEffect(() => {
    if (!wallet || !pairing || offline) return
    let current = true
    dispatch({ type: 'load' })
    let completed: readonly string[] = []
    try {
      completed = item_claim_attempts(window.sessionStorage, wallet.address).completed()
    } catch (error) {
      console.warn('Item transfer attempt history is unavailable.', error)
      dispatch({ type: 'failed', error })
      return
    }
    void discover_transfers(wallet, pairing).then(
      (snapshot) => {
        if (!current) return
        try {
          item_claim_attempts(window.sessionStorage, wallet.address).retire(
            completed,
            [...snapshot.withdrawals, ...snapshot.deposits],
            [wallet.address, pairing.address]
          )
        } catch (error) {
          console.warn('Completed item attempt fences could not be retired.', error)
        }
        dispatch({ type: 'ready', snapshot })
      },
      (error: unknown) => {
        if (current) dispatch({ type: 'failed', error })
      }
    )
    return () => {
      current = false
    }
  }, [wallet, pairing, view.serial, offline, listing_revision, link_ready])
  const snapshot = current_snapshot(discovery.snapshot, wallet, pairing, view, offline)
  const state = kiosk_status(discovery, view, copy, link_ready)
  const routes = snapshot ? transfer_routes(snapshot, []) : null
  const pending_deposit_ids = new Set([...(snapshot?.reserved_player_items ?? []), ...transfer.pending_ids])
  const offer = (ids: readonly string[], direction: TransferDirection, player_items: readonly ItemRow[] = []): void => {
    if (!snapshot || transfer.busy || state.phase !== 'ready') return
    const route = transfer_routes(snapshot, player_items)[direction]
    if (!route.offer) return void toast.add(copy.ui.agent_pair_for_deposit, 'info')
    const items = selected_transfer_items(route.items, ids)
    if (!items) return void toast.add(copy.characters_page.refusal_unavailable, 'info')
    void transfer.execute(
      route.offer,
      {
        kind: 'asset_offer',
        items,
        recipient: route.recipient,
        sui_mist: '0',
        kares_mist: '0',
        reserve_mist: '0',
      },
      {
        handover: { claim: route.claim, read: route.read },
        preview: {
          recipient: route.recipient,
          items: route.items
            .filter(({ item }) => items.some(({ item_id }) => item_id === item.id))
            .map(({ item }) => item),
        },
      }
    )
  }
  const pending_items = routes
    ? Object.values(routes).flatMap((route) => (route.can_claim ? route.pending.map((item) => ({ route, item })) : []))
    : []
  const attempt_status = (item: AgentItemReturnOffer) => {
    if (transfer.transaction.claimed?.some((claimed) => claimed.purchase_cap === item.purchase_cap)) return 'complete'
    return item_claim_attempts(window.sessionStorage, wallet!.address).status(item)
  }
  const recover_item = (selected: Readonly<(typeof pending_items)[number]>, automatic: boolean) => {
    const { route, item } = selected
    const items = item_return_group(route.pending, item)
    const ids = new Set(items.map(({ item_id }) => item_id))
    const source = [...player_inventory, ...view.inventory].filter(({ id }) => ids.has(id))
    return transfer.execute(
      route.claim,
      { kind: 'asset_claim', agent_address: route.sender, items },
      {
        automatic,
        preview: source.length ? { recipient: route.recipient, items: source } : undefined,
      }
    )
  }
  const recovery = (() => {
    try {
      return {
        items: pending_items.map((selected) => ({
          ...selected,
          status: item_return_group(selected.route.pending, selected.item).map(attempt_status).find(Boolean),
        })),
        error: null,
      }
    } catch (error) {
      return { items: [], error }
    }
  })()
  useEffect(() => {
    if (transfer.busy || transfer.reconciling || returning || state.phase !== 'ready') return
    if (recovery.error) return dispatch({ type: 'failed', error: recovery.error })
    const selected = recovery.items.find(({ status }) => !status)
    if (selected) void recover_item(selected, true)
  })
  const item_recovery_blocked = !transfer.busy && recovery.items.some(({ status }) => status === 'attempted')
  const retry_items = () => {
    if (transfer.reconciling) return transfer.retry()
    const selected = recovery.items.find(({ status }) => status === 'attempted')
    if (selected) void recover_item(selected, false)
  }
  return {
    wallet,
    pairing,
    snapshot,
    routes,
    state,
    refresh,
    offer,
    item_recovery_blocked,
    retry_items,
    pending_deposit_ids,
    ...transfer,
    blocked: transfer.reconciling || (transfer.blocked && transfer.unresolved),
  }
}
export type AgentKioskController = ReturnType<typeof useAgentKiosk>
