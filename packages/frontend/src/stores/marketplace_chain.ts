// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create } from 'zustand'

import type { MarketplaceListing } from '../types/chain'
import { use_auth } from '../auth'
import { use_toast } from '../toast'
import i18n from '../i18n'
import { game_log } from '../core/log.js'
import { with_timeout } from '../utils/with_timeout'
import { build_listing_from_view, get_listable_items, get_listable_characters } from '../chain/read_listings'
import { get_encyclopedia, get_listings } from '../rpc/client'
import {
  list_item,
  list_stack,
  delist_item,
  buy_item,
  split_stack,
  merge_stacks,
  withdraw_kiosk_proceeds,
  list_character,
  buy_character,
} from '../chain/write/write_listings'

// The on-chain replacement for the dead `use_ws` marketplace slice: real player-to-player kiosk listings read
// chain-direct, and the list / buy / delist writes. Deliberately exposes the SAME data the frozen marketplace
// page needs (listings + item templates) so the page's grouping / filtering / rendering is untouched.
//
// OPTIMISTIC (INSTANT, never block on tx): list / buy / delist apply to local state
// the instant the player acts (the listing appears / the item moves), the real tx rides the ONE self-updating
// loading toast (toast.promise) in the background — see the ONE-PIPELINE REDUCER below for how a failure or a
// concurrent load reconciles. The listing id is the Item object id (kiosk lists by item), which is exactly what
// a later chain read returns — so the optimistic entry is identical to its reconciled truth (rarity/appearance
// are neutral on-chain too). Never a doomed tx: the list picker only offers UNLISTED kiosk-LOCKED items (S-63
// lock-native — equipped gear rides on the Character, exploring/escrowed items sit in the Stake, already-listed
// ones carry a kiosk listing: all excluded at source, see get_listable_items).

export type ListableItem = {
  id: string
  kiosk_id: string // S-63 lock-native: the personal kiosk that LOCKS this item — kiosk::list targets it exactly
  template_id: string | null
  slug: string
  name: string
  category: string
  level: number
  quantity: number
  stackable: boolean
}

/** A sellable character (kiosk-locked, unlisted) — the SELL sub-category rows (§17.30). */
export type ListableCharacter = {
  id: string
  kiosk_id: string
  name: string
  classe: string
  experience: number
}

// Build the optimistic listing the frozen page consumes — identical shape to read_listings.js build_listing
// (neutral rarity/appearance match the on-chain read exactly), so it renders in Browse + My Listings instantly.
function optimistic_listing(item: ListableItem, price_mist: bigint, seller: string): MarketplaceListing {
  return {
    id: item.id,
    kiosk_id: item.kiosk_id, // the kiosk that LOCKS the item — a delist of this optimistic row targets it
    seller_uuid: '',
    seller_sui_address: seller,
    seller_name: seller ? `${seller.slice(0, 6)}…${seller.slice(-4)}` : '',
    price: 0,
    price_mist: String(price_mist),
    item: {
      id: item.id,
      template_id: item.template_id ?? item.id,
      quantity: item.quantity,
      stats_json: '{}',
      slot: '',
      name: item.name,
      description: '',
      rarity: 'common',
      category: item.category,
      level: item.level,
      damages_json: '[]',
      consumable_json: 'null',
      particle_trail_json: 'null',
      appearance: '',
      weapon_class: '',
      pet_power: 0,
      pet_stats_json: '{}',
    },
  } as unknown as MarketplaceListing
}

// FAILURE LATCH (no auto-refire storm) — a failed `/v1` load must not re-burst on the next trigger
// (mount / zkLogin address resolve / React StrictMode double-fire). After a failure we set a backoff window
// (3s → 30s cap, exponential) during which a re-triggered load() no-ops, keeping the ONE honest error state
// visible instead of hammering; a success resets it. Closure state (never in the store) so it never re-renders.
const BUY_BACKOFF_BASE_MS = 3000
const BUY_BACKOFF_CAP_MS = 30000

// ─── THE ONE-PIPELINE REDUCER (M1 template — CLIENT_DESIGN_AUDIT.md row #2) ─────────────────────────────────
// Folds load + list + delist + buy into ONE pure reducer so a wholesale snapshot can never clobber an
// optimistic row, and a failed write can never restore a stale captured pre-tx value. The pending ledger is
// keyed by the listing's real id (the Item/Character object id) and carries the proof direction per op kind:
// LIST proves by PRESENCE (the id appears in a snapshot); DELIST/BUY prove by ABSENCE (the id is gone) — both
// are "own pending" rows, HELD through an indexer-lagged snapshot rather than bounced (the indexer may not have
// projected our tx yet). Non-pending rows (other sellers' listings) always adopt the raw snapshot directly — an
// omission there IS the sale/delist for THEM (drain), no ambiguity. Rollback is a `receipt_failed` input that
// drops the pending row and re-projects from CURRENT raw — never a restored snapshot, so it can neither
// duplicate a row a fresh concurrent load already re-confirmed nor resurrect one a fresh load already proved gone.

type PendingRow = { kind: 'list'; listing: MarketplaceListing } | { kind: 'delist' | 'buy' }

export type MarketInput =
  | { type: 'snapshot'; listings: MarketplaceListing[] } // rpc load result
  | { type: 'receipt'; kind: 'list'; listing: MarketplaceListing } // own list fired — optimistic add
  | { type: 'receipt'; kind: 'delist' | 'buy'; listing_id: string } // own delist/buy fired — optimistic hide
  | { type: 'receipt_failed'; listing_id: string } // own write failed — drop the ledger row, re-derive

export type MarketState = {
  listings: MarketplaceListing[] // PROJECTED render rows (raw ⊕ pending) — the API-compatible selector
  raw: MarketplaceListing[] // last rpc snapshot — the reconcile base (internal)
  pending: Record<string, PendingRow> // per-id ledger of our own in-flight list/delist/buy
  loaded_once: boolean // true after the first live load() lands — gates the full-screen spinner to first load only
}

export type MarketDivergence = { listing_id: string; predicted_price_mist: string; snapshot_price_mist: string } | null

export const empty_market_state = (): MarketState => ({ listings: [], raw: [], pending: {}, loaded_once: false })

// Project raw snapshot rows through the pending ledger → render rows: a still-pending LIST not yet in raw is
// synthesized on top (prepended, matching the instant-paint UX); a still-pending DELIST/BUY hides its raw row.
function project(raw: MarketplaceListing[], pending: Record<string, PendingRow>): MarketplaceListing[] {
  const ids = Object.keys(pending)
  if (ids.length === 0) return raw
  const raw_ids = new Set(raw.map((l) => l.id))
  const hidden = new Set<string>()
  const synthetic: MarketplaceListing[] = []
  for (const id of ids) {
    const row = pending[id]
    if (row.kind === 'list') {
      if (!raw_ids.has(id)) synthetic.push(row.listing)
    } else hidden.add(id)
  }
  return [...synthetic, ...raw.filter((l) => !hidden.has(l.id))]
}

export function reduce(state: MarketState, input: MarketInput): { state: MarketState; divergence: MarketDivergence } {
  switch (input.type) {
    case 'receipt': {
      const id = input.kind === 'list' ? input.listing.id : input.listing_id
      const row: PendingRow = input.kind === 'list' ? { kind: 'list', listing: input.listing } : { kind: input.kind }
      const pending = { ...state.pending, [id]: row }
      return { state: { ...state, pending, listings: project(state.raw, pending) }, divergence: null }
    }

    // Own write failed after painting: drop the ledger row and RE-PROJECT from the current raw — never a
    // captured pre-tx value. A list never existed on raw, so it just vanishes; a delist/buy falls back to
    // whatever raw currently says (still there if untouched, gone if a concurrent snapshot already proved it).
    case 'receipt_failed': {
      if (!(input.listing_id in state.pending)) return { state, divergence: null }
      const pending = { ...state.pending }
      delete pending[input.listing_id]
      return { state: { ...state, pending, listings: project(state.raw, pending) }, divergence: null }
    }

    // rpc snapshot: reconcile each pending row. LIST proves by presence (adopt chain's row, drop the synthetic
    // one, flag a divergence if the proven price differs from what we predicted). DELIST/BUY prove by absence
    // (drain once the snapshot no longer carries the id). Either way, still-present/still-absent means the
    // indexer hasn't caught up yet — HOLD, don't bounce. Non-pending ids adopt the raw snapshot directly.
    case 'snapshot': {
      const by_id = new Map(input.listings.map((l) => [l.id, l]))
      const pending: Record<string, PendingRow> = {}
      let divergence: MarketDivergence = null
      for (const [id, row] of Object.entries(state.pending)) {
        const snap = by_id.get(id)
        if (row.kind === 'list') {
          if (snap) {
            if (snap.price_mist !== row.listing.price_mist)
              divergence = {
                listing_id: id,
                predicted_price_mist: row.listing.price_mist,
                snapshot_price_mist: snap.price_mist,
              }
            continue // proven — raw now carries the real row
          }
          pending[id] = row // not yet on chain per this snapshot — hold the synthetic paint
        } else if (snap) pending[id] = row // still present per this (lagging) snapshot — hold the hide
        // else: gone from the feed — proven, drop (no re-add — self-drains)
      }
      return {
        state: {
          ...state,
          raw: input.listings,
          pending,
          listings: project(input.listings, pending),
          loaded_once: true,
        },
        divergence,
      }
    }

    default:
      return { state, divergence: null }
  }
}

interface MarketplaceChainStore extends MarketState {
  templates_item: any[]
  loading: boolean
  busy: boolean // a list / buy / delist write is in flight
  listable: ListableItem[]
  listable_loading: boolean
  listable_characters: ListableCharacter[]
  listable_loaded_for: string | null // the address the SELL sweep last loaded — the per-session cache key (S-86)

  load: () => Promise<void>
  /** `force` re-sweeps even when cached for the current address (post-delist reconcile). */
  load_listable: (force?: boolean) => Promise<void>
  submit_listing: (item: ListableItem, price_mist: bigint) => void
  submit_delist: (listing: MarketplaceListing) => void
  submit_buy: (listing: MarketplaceListing) => void
  submit_split_stack: (item: ListableItem, amount: number) => void
  submit_merge_stacks: (target: ListableItem, source: ListableItem) => void
  submit_withdraw_proceeds: () => void
  /** List an owned character for sale (§17.30 — the level-30 gate enforces at purchase time). */
  submit_list_character: (character: { id: string; kiosk_id?: string }, price_mist: bigint) => void
  /** Character purchase — honest seam stub until the S-46 merged-package SDK lands. */
  submit_buy_character: (row: { item_id: string; kiosk_id: string; price_mist: string }) => void
}

export const use_marketplace_chain = create<MarketplaceChainStore>((set, get) => {
  let buy_fail_streak = 0
  let buy_next_retry_at = 0
  const buy_latch_open = () => Date.now() >= buy_next_retry_at
  const buy_on_ok = () => {
    buy_fail_streak = 0
    buy_next_retry_at = 0
  }
  const buy_on_fail = () => {
    buy_fail_streak += 1
    buy_next_retry_at = Date.now() + Math.min(BUY_BACKOFF_CAP_MS, BUY_BACKOFF_BASE_MS * 2 ** (buy_fail_streak - 1))
  }
  return {
    ...empty_market_state(),
    templates_item: [],
    loading: false,
    busy: false,
    listable: [],
    listable_loading: false,
    listable_characters: [],
    listable_loaded_for: null,

    // BUY listings (S-86): ONE keyless `/v1/listings` call (all categories) + the item-template DISPLAY catalog
    // from the keyless `/v1/encyclopedia` items view, then partition + map client-side — "load everything in one
    // call, then per category". Both are keyless `/v1` reads: the browser NEVER sweeps the chain — the old
    // `get_item_templates_cached` catalog (a graphql.testnet.sui.io event-replay + gRPC BatchGetObjects the browser
    // could not reach: CORS-blocked + 429) is retired here. The encyclopedia items carry name/category/level (keyed
    // by item_type slug — the frozen page's `templates_item` lookup key); stats/pods/damages are NOT indexed by /v1
    // (the Redis template doc is id/name/item_type/category/level only), so the BUY item-detail renders those from
    // name/category/level and omits stat lines — the same absence testnet already showed (the GraphQL catalog failed
    // to empty), now with real names/categories. Characters are their own category (CharactersPanel), filtered OUT
    // of this item set. Still with_timeout-bound (never an infinite spinner). The async result DISPATCHES
    // a snapshot input — it never set()s listings directly (ONE-PIPELINE law): the reducer's merge rule decides state.
    load: async () => {
      if (!buy_latch_open()) return // latched after a recent failure — hold the one honest error state, don't re-burst
      set({ loading: true })
      try {
        const [page, ency] = await with_timeout(
          Promise.all([get_listings({ limit: 200 }), get_encyclopedia('items').catch(() => ({ items: [] }))]),
          20000,
          'marketplace load'
        )
        // Keep every live template row: `item_type` is intentionally generic in the current corpus, while
        // `template_id` is the unique on-chain identity needed by native kiosk lot ladders. Legacy consumers still
        // read `id` as item_type. A listing can borrow display metadata only when that item_type has ONE candidate;
        // otherwise the BUY page renders an honest unresolved-template card instead of choosing an arbitrary item.
        const raw_templates = (ency.items ?? []).filter((it) => it.item_type)
        const templates = raw_templates.map((t) => ({
          id: t.item_type,
          template_id: t.template_id,
          item_type: t.item_type,
          name: t.name,
          category: t.category,
          level: t.level,
        }))
        const candidates = new Map<string, any[]>()
        for (const template of raw_templates) {
          const item_type = template.item_type as string
          candidates.set(item_type, [...(candidates.get(item_type) ?? []), template])
        }
        const tmpl_by_slug = new Map<string, any>()
        for (const [item_type, rows] of candidates) if (rows.length === 1) tmpl_by_slug.set(item_type, rows[0])
        const listings = page.listings
          .filter((l) => l.category !== 'character') // items only — characters render from the view in CharactersPanel
          .map((l) => build_listing_from_view(l, tmpl_by_slug) as unknown as MarketplaceListing)
        buy_on_ok() // reads landed — clear the backoff latch
        const { state, divergence } = reduce(get(), { type: 'snapshot', listings })
        if (divergence)
          game_log('marketplace', 'listing divergence — predicted ≠ chain at proof time (adopting chain)', divergence)
        set({ ...state, templates_item: templates, loading: false })
      } catch (e) {
        buy_on_fail() // arm the exponential-backoff window so the next trigger doesn't re-burst
        set({ loading: false, loaded_once: true })
        use_toast.getState().add(i18n.t('marketplace.chain.error_load'), 'error')
      }
    },

    load_listable: async (force = false) => {
      const { address } = use_auth.getState()
      if (!address) return
      // Per-session cache (S-86): the SELL sweep reads the viewer's OWN kiosk-locked bag — re-running it on
      // every SELL-tab remount / marketplace revisit was part of the storm. Skip when we already hold this
      // address's set; `force` (post-delist) bypasses to reconcile the freshly-unlisted item back into the picker.
      if (!force && get().listable_loaded_for === address) return
      // STORM FIX (S-87): stamp `listable_loaded_for` BEFORE the await, not just on success — closes the
      // React StrictMode double-mount race (two back-to-back calls both used to pass the guard above, since
      // it only landed after the first call's async work resolved, firing two concurrent /v1 reads). A real
      // failure resets it in the catch below so a legitimate retry is never permanently blocked.
      set({ listable_loading: true, listable_loaded_for: address })
      try {
        // Items (/v1/owner-items) + sellable characters (/v1/characters?owner=) in one parallel pass — both
        // keyless /v1 reads (S-87 — no SDK, no kiosk-SDK walk); the characters read is best-effort (a
        // failure degrades to items-only, never nukes the whole SELL tab). Timeout-bounded: a
        // hung read must never leave the SELL inventory spinning forever.
        const [listable, listable_characters] = await with_timeout(
          Promise.all([get_listable_items(address), get_listable_characters(address).catch(() => [])]),
          20000,
          'marketplace listable'
        )
        set({ listable, listable_characters, listable_loading: false })
      } catch (e) {
        set({ listable_loading: false, listable_loaded_for: null })
        use_toast.getState().add(i18n.t('marketplace.chain.error_load'), 'error')
      }
    },

    // OPTIMISTIC list — the listing appears in Browse + My Listings instantly, tx rides the loading toast. A
    // failed tx drops the pending-list ledger row (receipt_failed) — never a stored rollback value.
    submit_listing: (item, price_mist) => {
      if (get().busy) return
      const { address } = use_auth.getState()
      if (!address) return
      const listing = optimistic_listing(item, price_mist, address)
      set((s) => ({
        busy: true,
        ...reduce(s, { type: 'receipt', kind: 'list', listing }).state,
        listable: s.listable.filter((l) => l.id !== item.id),
      }))
      const write = item.stackable
        ? list_stack({
            item_id: item.id,
            kiosk_id: item.kiosk_id,
            amount: item.quantity,
            price_mist,
          })
        : list_item({ item_id: item.id, kiosk_id: item.kiosk_id, price_mist })
      use_toast
        .getState()
        .promise(write, {
          pending: i18n.t('marketplace.chain.pending_list'),
          success: i18n.t('marketplace.chain.toast_listed'),
          // No static `error:` override (TOAST-OVERRIDE SWEEP 07-10) — use_toast.promise()'s `messages.error ??
          // rejection.message` fallback only kicks in when `error` is omitted; a static string here ALWAYS won,
          // silently discarding the real humanized abort reason (mirrors the template_tab_actions.ts / kolizeum.tsx
          // fixed pattern: drop it, let the humanized `.message` flow to the player).
        })
        .catch(() =>
          set((s) => ({
            ...reduce(s, { type: 'receipt_failed', listing_id: item.id }).state,
            listable: [item, ...s.listable],
          }))
        )
        .finally(() => set({ busy: false }))
    },

    // OPTIMISTIC delist — the row leaves My Listings instantly, tx in the background. S-63 lock-native: the item
    // STAYS LOCKED in its kiosk (kiosk::delist only, no take/transfer), so on success the SELL picker re-reads its
    // kiosks (fire-and-forget — load_listable owns its own spinner + error toast) and the item reappears listable.
    // A failed tx drops the pending-hide ledger row, re-projecting straight from the CURRENT raw snapshot — never
    // a captured pre-tx value, so it can neither duplicate a row a concurrent load already re-confirmed nor
    // resurrect one a concurrent load already proved gone.
    submit_delist: (listing) => {
      if (get().busy) return
      set((s) => ({ busy: true, ...reduce(s, { type: 'receipt', kind: 'delist', listing_id: listing.id }).state }))
      use_toast
        .getState()
        .promise(delist_item({ item_id: listing.id, kiosk_id: (listing as any).kiosk_id }), {
          pending: i18n.t('marketplace.chain.pending_delist'),
          success: i18n.t('marketplace.chain.toast_delisted'),
        })
        .then(() => void get().load_listable(true)) // force past the per-session cache — the item is listable again
        .catch(() => set((s) => reduce(s, { type: 'receipt_failed', listing_id: listing.id }).state))
        .finally(() => set({ busy: false }))
    },

    // OPTIMISTIC buy — the native kiosk listing vanishes instantly; lot_rule resolves inside the same SDK path. A
    // failed tx drops the pending-hide ledger row, re-projecting straight from raw — never a captured pre-tx value.
    submit_buy: (listing) => {
      if (get().busy) return
      set((s) => ({ busy: true, ...reduce(s, { type: 'receipt', kind: 'buy', listing_id: listing.id }).state }))
      const args = {
        item_id: listing.id,
        seller_kiosk_id: (listing as any).kiosk_id,
        price_mist: BigInt(listing.price_mist),
      }
      use_toast
        .getState()
        .promise(buy_item(args), {
          pending: i18n.t('marketplace.chain.pending_buy'),
          success: i18n.t('marketplace.chain.toast_bought'),
        })
        .catch(() => set((s) => reduce(s, { type: 'receipt_failed', listing_id: listing.id }).state))
        .finally(() => set({ busy: false }))
    },

    submit_split_stack: (item, amount) => {
      if (get().busy) return
      set({ busy: true })
      use_toast
        .getState()
        .promise(split_stack({ item_id: item.id, kiosk_id: item.kiosk_id, amount }), {
          pending: i18n.t('marketplace.lots.pending_split'),
          success: i18n.t('marketplace.lots.toast_split'),
        })
        .then(() => void get().load_listable(true))
        .catch(() => {})
        .finally(() => set({ busy: false }))
    },

    submit_merge_stacks: (target, source) => {
      if (get().busy) return
      set({ busy: true })
      use_toast
        .getState()
        .promise(
          merge_stacks({
            kiosk_id: target.kiosk_id,
            target_item_id: target.id,
            source_item_id: source.id,
          }),
          {
            pending: i18n.t('marketplace.lots.pending_merge'),
            success: i18n.t('marketplace.lots.toast_merged'),
          }
        )
        .then(() => void get().load_listable(true))
        .catch(() => {})
        .finally(() => set({ busy: false }))
    },

    submit_withdraw_proceeds: () => {
      if (get().busy) return
      set({ busy: true })
      use_toast
        .getState()
        .promise(withdraw_kiosk_proceeds(), {
          pending: i18n.t('marketplace.lots.pending_proceeds'),
          success: i18n.t('marketplace.lots.toast_proceeds'),
        })
        .catch(() => {})
        .finally(() => set({ busy: false }))
    },

    // LIST a character — same optimistic-free shape (the character listing surfaces via the RPC view's next
    // poll; nothing local to paint since the characters category reads the RPC, not this store's listings).
    submit_list_character: (character, price_mist) => {
      if (get().busy) return
      set({ busy: true })
      use_toast
        .getState()
        .promise(list_character({ character_id: character.id, kiosk_id: character.kiosk_id, price_mist }), {
          pending: i18n.t('marketplace.chain.pending_list'),
          success: i18n.t('marketplace.chain.toast_listed'),
        })
        .catch(() => {})
        .finally(() => set({ busy: false }))
    },

    // BUY a character — resolves the Character policy's FOUR live rules through write_listings.buy_character
    // (royalty + kiosk_lock + personal_kiosk + the §17.30 level gate, enforced on-chain at purchase). Optimistic-free
    // Nothing local to paint (the characters category reads the RPC listings view, not this
    // store's `listings`) — the row drops on the view's next poll; busy + the one self-updating toast carry the lifecycle.
    submit_buy_character: (row) => {
      if (get().busy) return
      set({ busy: true })
      use_toast
        .getState()
        .promise(
          buy_character({
            character_id: row.item_id,
            seller_kiosk_id: row.kiosk_id,
            price_mist: BigInt(row.price_mist),
          }),
          {
            pending: i18n.t('marketplace.chain.pending_buy'),
            success: i18n.t('marketplace.characters.toast_bought'),
          }
        )
        .catch(() => {})
        .finally(() => set({ busy: false }))
    },
  }
})
