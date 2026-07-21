// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Item SEND state machine: resolve address/SuiNS, compose the kiosk-aware SDK PTB, dry-run that exact transfer,
// present the preview, then execute only the prepared transaction after explicit confirmation.

import { create } from 'zustand'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import type { Transaction } from '@mysten/sui/transactions'

import { use_auth } from '../auth'
import { read_sui_balance_mist } from '../auth/sui_balance'
import { is_suins_name, resolve_suins_address } from '../utils/suins'
import { execute_gift_send, item_royalty_min_mist, preview_gift_send } from '../chain/write/write_gift'
import { humanize_tx_error } from '../game/core/abort_copy.js'
import { game_log } from '../core/log.js'

import { build_item_send_transfer_groups, type item_send_receiver_item, type send_item } from './item_send_model'

export type SendItem = send_item

const address_full_re = /^0x[a-f0-9]{64}$/i

export interface ItemSendState {
  phase: 'RESOLVING' | 'REVIEW' | 'EXECUTING' | 'SUCCESS' | 'FAILED'
  items: SendItem[]
  recipient_input: string
  resolved_address: string
  resolved_name: string | null
  fresh_address: boolean
  royalty_mist: bigint | null
  gas_estimate_mist: bigint | null
  receiver_items: item_send_receiver_item[]
  selected_amount: bigint | null
  tx_digest: string | null
  error: string | null
}

interface ItemSendStore {
  send: ItemSendState | null
  prepared_transaction: Transaction | null
  generation: number
  prepare: (payload: { items: SendItem[]; recipient_input: string; amount?: bigint }) => Promise<void>
  confirm: () => Promise<void>
  clear: () => void
}

type item_send_machine = Pick<ItemSendStore, 'send' | 'prepared_transaction' | 'generation'>
type item_send_event =
  | { kind: 'prepare_started'; generation: number; send: ItemSendState }
  | {
      kind: 'state_replaced'
      generation: number
      send: ItemSendState
      prepared_transaction: Transaction | null
    }
  | { kind: 'cleared'; generation: number }

const initial_machine: item_send_machine = { send: null, prepared_transaction: null, generation: 0 }

export function reduce_item_send_machine(state: item_send_machine, event: item_send_event): item_send_machine {
  if (event.kind === 'cleared') return { send: null, prepared_transaction: null, generation: event.generation }
  if (event.kind === 'prepare_started')
    return { send: event.send, prepared_transaction: null, generation: event.generation }
  if (event.generation !== state.generation) return state
  return {
    send: event.send,
    prepared_transaction: event.prepared_transaction,
    generation: state.generation,
  }
}

async function resolve_recipient(raw: string): Promise<{ address: string; name: string | null } | null> {
  const value = raw.trim()
  if (address_full_re.test(value)) return { address: normalizeSuiAddress(value), name: null }
  if (!is_suins_name(value)) return null
  const address = await resolve_suins_address(value)
  return address ? { address: normalizeSuiAddress(address), name: value } : null
}

const base_state = ({
  items,
  recipient_input,
  selected_amount,
}: {
  items: SendItem[]
  recipient_input: string
  selected_amount: bigint | null
}): ItemSendState => ({
  phase: 'RESOLVING',
  items,
  recipient_input,
  resolved_address: '',
  resolved_name: null,
  fresh_address: false,
  royalty_mist: null,
  gas_estimate_mist: null,
  receiver_items: [],
  selected_amount,
  tx_digest: null,
  error: null,
})

export const use_item_send = create<ItemSendStore>((set, get) => {
  const input = (event: item_send_event) => set((state) => reduce_item_send_machine(state, event))
  return {
    ...initial_machine,

    prepare: async ({ items, recipient_input, amount }) => {
      const generation = get().generation + 1
      const base = base_state({ items, recipient_input, selected_amount: amount ?? null })
      input({ kind: 'prepare_started', generation, send: base })
      if (items.length === 0) {
        input({
          kind: 'state_replaced',
          generation,
          send: { ...base, phase: 'FAILED', error: 'NO_ITEMS' },
          prepared_transaction: null,
        })
        return
      }

      const plan_result = (() => {
        try {
          return { ok: true as const, plan: build_item_send_transfer_groups(items, amount) }
        } catch (error) {
          return { ok: false as const, error }
        }
      })()
      if (!plan_result.ok) {
        input({
          kind: 'state_replaced',
          generation,
          send: {
            ...base,
            phase: 'FAILED',
            error: String((plan_result.error as Error)?.message ?? plan_result.error),
          },
          prepared_transaction: null,
        })
        return
      }
      const { plan } = plan_result

      const resolved = await resolve_recipient(recipient_input).catch(() => null)
      if (generation !== get().generation) return
      if (!resolved) {
        input({
          kind: 'state_replaced',
          generation,
          send: { ...base, phase: 'FAILED', error: 'RECIPIENT_INVALID' },
          prepared_transaction: null,
        })
        return
      }
      const sender = use_auth.getState().address
      if (sender && resolved.address.toLowerCase() === sender.toLowerCase()) {
        input({
          kind: 'state_replaced',
          generation,
          send: { ...base, phase: 'FAILED', resolved_address: resolved.address, error: 'SELF_SEND' },
          prepared_transaction: null,
        })
        return
      }

      try {
        const [balance, min_mist, preview] = await Promise.all([
          read_sui_balance_mist(resolved.address).catch(() => null),
          item_royalty_min_mist().catch(() => null),
          preview_gift_send({ groups: plan.groups, recipient: resolved.address }),
        ])
        input({
          kind: 'state_replaced',
          generation,
          send: {
            ...base,
            phase: 'REVIEW',
            resolved_address: resolved.address,
            resolved_name: resolved.name,
            fresh_address: balance === 0n,
            royalty_mist: min_mist == null ? null : min_mist * BigInt(plan.transfer_count),
            gas_estimate_mist: preview.gas_estimate_mist,
            receiver_items: [...plan.receiver_items],
          },
          prepared_transaction: preview.transaction,
        })
      } catch (error) {
        game_log('item-send', 'preview failed', error)
        input({
          kind: 'state_replaced',
          generation,
          send: {
            ...base,
            phase: 'FAILED',
            resolved_address: resolved.address,
            error: humanize_tx_error(error),
          },
          prepared_transaction: null,
        })
      }
    },

    confirm: async () => {
      const { send, prepared_transaction, generation } = get()
      if (!send || send.phase !== 'REVIEW') return
      if (!prepared_transaction) {
        input({
          kind: 'state_replaced',
          generation,
          send: { ...send, phase: 'FAILED', error: 'PREVIEW_EXPIRED' },
          prepared_transaction: null,
        })
        return
      }
      input({
        kind: 'state_replaced',
        generation,
        send: { ...send, phase: 'EXECUTING', error: null },
        prepared_transaction,
      })
      try {
        const { digest } = await execute_gift_send(prepared_transaction)
        input({
          kind: 'state_replaced',
          generation,
          send: { ...send, phase: 'SUCCESS', tx_digest: digest },
          prepared_transaction: null,
        })
      } catch (error) {
        game_log('item-send', 'send failed', error)
        input({
          kind: 'state_replaced',
          generation,
          send: { ...send, phase: 'FAILED', error: humanize_tx_error(error) },
          prepared_transaction: null,
        })
      }
    },

    clear: () => input({ kind: 'cleared', generation: get().generation + 1 }),
  }
})

if (import.meta.env.DEV && typeof window !== 'undefined')
  (window as unknown as { __item_send?: typeof use_item_send }).__item_send = use_item_send
