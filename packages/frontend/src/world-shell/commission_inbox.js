// COMMISSION INBOX (Commission Flow v2) — the live, this-session store of incoming artisan-commission requests
// delivered over the p2p presence overlay (lobby-room `crequest`). No server push exists; the Trystero lobby room
// is the channel (the SAME one the party-invite nudge rides). When a customer requests a craft, the NAMED artisan's
// session receives a nudge here → a house toast + an attention chime + a row the ARTISAN view surfaces on open.
//
// This is a live-session NICETY layered on top of the request itself: an OFFLINE artisan simply misses the toast/
// chime, and the commission (its on-chain / in-store record) is entirely unaffected — the read is the source of
// truth. Mirrors party_store's wire_party_p2p: one idempotent wire, filtered by MY wallet address off use_auth.

import { create } from 'zustand'
import { subscribe_commissions } from '@aresrpg/world'

import { use_auth } from '../auth'
import { use_toast } from '../toast'
import { play_discovery_sfx } from '../game/core/audio/sfx.js'
import i18n from '../i18n'

import { presence_store } from './presence_adapter.js'

const short = (/** @type {string} */ a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')

/**
 * Live incoming commission requests received via p2p THIS session (newest first). Each row is shaped like the /v1
 * `Commission` the ARTISAN view renders, so the view merges these AHEAD of its read with zero special-casing. The
 * store is session-scoped by nature (a fresh load starts empty; a wallet switch tears the world session down).
 * @typedef {import('../game/screens/hud/world/commission/commission_actions.js').Commission} Commission
 */
export const use_commission_inbox = create((set) => ({
  /** @type {Commission[]} */
  requests: [],
  /** Push a freshly-received request (de-duped by id — a re-broadcast never stacks). @param {Commission} req */
  add: (req) => set((s) => ({ requests: [req, ...s.requests.filter((r) => r.id !== req.id)] })),
  /** Drop a request once accepted / handled. @param {string} id */
  remove: (id) => set((s) => ({ requests: s.requests.filter((r) => r.id !== id) })),
  clear: () => set({ requests: [] }),
}))

let wired = false

/**
 * Wire the p2p commission-request nudge into the inbox — call ONCE after join_lobby (embed_voxel mount), beside
 * wire_party_p2p. Idempotent. D770a W3b: incoming nudges arrive through @aresrpg/world's presence atom (the
 * transport dispatches `commission_received`, the core carries the stream head, subscribe_commissions delivers
 * each row). A row addressed to MY wallet (a whole-room broadcast, every other listener ignores it): play the
 * attention chime, toast the incoming request, and push it onto the inbox so the ARTISAN view shows it on open.
 */
export function wire_commission_p2p() {
  if (wired) return
  wired = true
  subscribe_commissions(presence_store, (/** @type {any} */ payload) => {
    const { address } = use_auth.getState()
    if (!address || payload?.to_address !== address) return // not for me — the nudge broadcasts to the whole room
    const customer = payload.from_name || short(payload.from_address)
    const recipe = payload.recipe_name || i18n.t('commission.a_craft')
    // ATTENTION CHIME — the ascending "discovery" sparkle (~0.3s): attention-grabbing, pleasant, ZERO fight
    // association, zero new asset. Audition alternates by ear: `play_sfx('carousel')` (subtler menu
    // swish, the only non-fight SOURCES file) or `play_gather_sfx()` (the reward pop). Swap this ONE line to A/B.
    play_discovery_sfx()
    use_toast.getState().add(i18n.t('commission.notify_incoming', { customer, recipe }), 'info')
    use_commission_inbox.getState().add({
      id: `live_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      status: 'pending',
      payment_mist: Number(payload.payment_mist) || 0,
      customer_name: customer,
      customer_address: String(payload.from_address ?? ''),
      artisan_name: 'You',
      artisan_address: address,
      recipe_id: String(payload.recipe_id ?? ''),
      recipe_name: String(payload.recipe_name ?? ''),
      recipe_icon: String(payload.recipe_icon ?? ''),
      recipe_category: String(payload.recipe_category ?? ''),
      recipe_quality: 'common', // unknown from the p2p nudge — a harmless display default
    })
  })
}
