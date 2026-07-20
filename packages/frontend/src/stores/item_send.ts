// item_send.ts — client-side ITEM GIFT-send state machine (no backend). Sibling of stores/sui_send.ts, but for
// the escrow-recoverable player-to-player item send (gift.move · resolved DECISIONS 2026-07-13). The modal
// collects the recipient (the items are picked on the inventory grid and passed in); this store owns the async
// machine:
//   RESOLVING → REVIEW (the irrecoverability DOUBLE-CONFIRM gate) → EXECUTING → (SUCCESS | FAILED)
//
// RESOLVING resolves the recipient (raw 0x address OR SuiNS — player-name send is DEAD, no WS registry), guards
// self-send, fires the FRESH-ADDRESS probe (zero on-chain history ⇒ a soft typo warning, never a hard block —
// a brand-new valid zkLogin address also reads empty), and derives the royalty DISPLAY (N × the Item policy's
// per-item min, read off-chain). The authoritative dry-run PRE-FLIGHT is the tx choke's own S-54 simulate-refuse
// (send_gift → run_tx_random → execute_tx): a would-fail send refuses BEFORE signing, zero gas, humanized cause —
// so this store never composes a second, drift-prone dry-run.

import { create } from 'zustand'
import { normalizeSuiAddress } from '@mysten/sui/utils'

import { use_auth } from '../auth'
import { read_sui_balance_mist } from '../auth/sui_balance'
import { is_suins_name, resolve_suins_address } from '../utils/suins'
import { send_gift, item_royalty_min_mist } from '../chain/write/write_gift'
import { humanize_tx_error } from '../game/core/abort_copy.js'
import { game_log } from '../core/log.js'

const ADDRESS_FULL_RE = /^0x[a-f0-9]{64}$/i

export interface SendItem {
  id: string
  kiosk_id: string
  slug: string
  name: string
  appearance?: string
  category?: string
  level?: number
}

export interface ItemSendState {
  phase: 'RESOLVING' | 'REVIEW' | 'EXECUTING' | 'SUCCESS' | 'FAILED'
  items: SendItem[]
  recipient_input: string
  resolved_address: string
  resolved_name: string | null // the SuiNS name, when resolved via one
  is_suins: boolean
  fresh_address: boolean // zero on-chain history — the typo warning
  royalty_mist: bigint | null // N × the per-item royalty floor (display; null when unreadable pre-publish)
  tx_digest: string | null
  error: string | null // a humanized message OR a machine code (SELF_SEND / RECIPIENT_INVALID / NO_ITEMS)
}

interface ItemSendStore {
  send: ItemSendState | null
  /** Resolve the recipient + derive royalty + fresh-address probe → REVIEW (or FAILED). Items are the grid picks. */
  prepare: (payload: { items: SendItem[]; recipient_input: string }) => Promise<void>
  /** Fire the send from REVIEW (after the double-confirm) → EXECUTING → SUCCESS | FAILED. */
  confirm: () => Promise<void>
  /** Null the machine → the modal drops back to its (still-mounted) recipient form; also the full-close path. */
  clear: () => void
}

async function resolve_recipient(
  raw: string
): Promise<{ address: string; name: string | null; is_suins: boolean } | null> {
  const value = raw.trim()
  if (ADDRESS_FULL_RE.test(value)) return { address: normalizeSuiAddress(value), name: null, is_suins: false }
  if (is_suins_name(value)) {
    const address = await resolve_suins_address(value)
    return address ? { address: normalizeSuiAddress(address), name: value, is_suins: true } : null
  }
  return null // player-name send is dead (no WS) — a bare word can't resolve
}

export const use_item_send = create<ItemSendStore>((set, get) => ({
  send: null,

  prepare: async ({ items, recipient_input }) => {
    const { address: sender } = use_auth.getState()
    const base: ItemSendState = {
      phase: 'RESOLVING',
      items,
      recipient_input,
      resolved_address: '',
      resolved_name: null,
      is_suins: false,
      fresh_address: false,
      royalty_mist: null,
      tx_digest: null,
      error: null,
    }
    if (!items.length) {
      set({ send: { ...base, phase: 'FAILED', error: 'NO_ITEMS' } })
      return
    }
    set({ send: base })

    const resolved = await resolve_recipient(recipient_input).catch(() => null)
    if (!resolved) {
      set({ send: { ...base, phase: 'FAILED', error: 'RECIPIENT_INVALID' } })
      return
    }
    if (sender && resolved.address.toLowerCase() === sender.toLowerCase()) {
      set({ send: { ...base, phase: 'FAILED', resolved_address: resolved.address, error: 'SELF_SEND' } })
      return
    }

    // FRESH-ADDRESS probe (soft) + royalty DISPLAY derive — both best-effort, never block the review. A zero
    // balance is the cheapest typo signal; a valid brand-new zkLogin address also reads zero, hence a WARNING +
    // the double-confirm, never a hard stop (docs/ITEM_SEND_PLAN.md §A1.6).
    const [balance, min_mist] = await Promise.all([
      read_sui_balance_mist(resolved.address).catch(() => null),
      item_royalty_min_mist().catch(() => null),
    ])

    set({
      send: {
        ...base,
        phase: 'REVIEW',
        resolved_address: resolved.address,
        resolved_name: resolved.name,
        is_suins: resolved.is_suins,
        fresh_address: balance === 0n,
        royalty_mist: min_mist == null ? null : min_mist * BigInt(items.length),
      },
    })
  },

  confirm: async () => {
    const { send } = get()
    if (!send || send.phase !== 'REVIEW') return
    set({ send: { ...send, phase: 'EXECUTING', error: null } })
    try {
      // All picks share the sender's ONE personal kiosk (kiosk-lock constitution). The choke dry-runs +
      // refuses a would-fail send BEFORE signing (S-54), so an under-funded/absent-module send never burns gas.
      const { digest } = await send_gift({
        item_ids: send.items.map((i) => i.id),
        kiosk_id: send.items[0].kiosk_id,
        recipient: send.resolved_address,
      })
      set({ send: { ...get().send!, phase: 'SUCCESS', tx_digest: digest } })
    } catch (err) {
      game_log('item-send', 'send failed', err)
      set({ send: { ...get().send!, phase: 'FAILED', error: humanize_tx_error(err) } })
    }
  },

  clear: () => set({ send: null }),
}))

// DEV-only QA/screenshot seam — exposes the send machine so a harness can drive it (the gift module lands with
// the pending publish, so a real send dry-run-refuses until then). Statically stripped from the prod build.
if (import.meta.env.DEV && typeof window !== 'undefined')
  (window as unknown as { __item_send?: typeof use_item_send }).__item_send = use_item_send
