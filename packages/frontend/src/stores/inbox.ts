// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// inbox.ts — escrow-recoverable item GIFT inbox (gift.move · resolved DECISIONS 2026-07-13). INCOMING gifts
// are claimed (free to the receiver — royalty prepaid); OUTGOING gifts you sent can be recalled (
// NO return-to-sender, but the SENDER's own recall stays). Reads flow through the keyless /v1 read layer
// (get_inbox); writes ride the tx choke via chain/write/write_gift.
//
// REQ/RES only (no streaming): the panel polls this store on an interval + on focus; a gift_id in a
// fresh load that wasn't seen before fires ONE "you received items" toast (never re-toasted, never the whole
// inbox on first load). The /v1/inbox view is NOT live yet (behavior key post-publish) — a read failure surfaces
// as unavailable, never as a dishonest empty inbox. `__inject` is a DEV-only fixture seam for mocked-row proof.

import { create } from 'zustand'

import type { RpcInboxGift } from '../rpc/views'
import { get_inbox, RpcError } from '../rpc/client'
import { use_toast } from '../toast'
import i18n from '../i18n'
import { game_log } from '../core/log.js'

// `write_gift.js` statically imports `../auth`, which registers Enoki wallets against `window` at module scope
// (a browser-only side effect). A LAZY import keeps that poisoned chain out of anything that merely imports the
// pure reducer below (bun test has no `window`) without touching auth/index.ts or write_gift.js.
const write_gift = () => import('../chain/write/write_gift')

// ─── THE ONE-PIPELINE REDUCER (M2 twin of the M1 shop template — CLIENT-INDEPENDENCE law, CLAUDE.md Principle 6) ──
// Folds load + claim + recall into ONE pure reducer so a stale 20s poll can never resurrect a just-claimed or
// just-recalled gift (CLIENT_DESIGN_AUDIT row #5). A pending claim/recall optimistically HIDES the row — a gift
// is present-or-gone, never a partial quantity like shop's supply — keyed by gift_id + which action is in flight.
//
// DOMAIN ADAPTATION vs the M1 template: RpcInboxGift carries no monotonic counter (unlike shop's `minted`), so
// there is no separate numeric `floor` to track — presence in a fresh snapshot IS the un-proven state, omission
// IS the proof. `pending`'s own membership plays the floor's role; a dedicated field would only ever mirror it.
//
// Merge law: gift_id omitted from the matching list (genuinely claimed/recalled — OMIT SEMANTICS: same
// drain-on-omit choice as M1's shop) → drain. Still present → stale, HOLD the optimistic hide (never
// resurrected — omission is the only proof this domain has, so anything short of it stays hidden). Still present
// but its `items` differ from our last accepted snapshot → flag a divergence (log-only: the row stays held,
// since a content mismatch is not proof our action failed — only omission is; resurrecting on a mere mismatch
// would re-introduce the exact bug this migration kills). Rollback is a `receipt_failed` input that re-derives
// from the snapshot base — never a stored pre-action snapshot.

type PendingKind = 'claim' | 'recall'

export type InboxInput =
  | { type: 'snapshot'; incoming: RpcInboxGift[]; outgoing: RpcInboxGift[] } // rpc load result
  | { type: 'load_failed' } // rpc load failed — keep last-good rows, but surface unavailable
  | { type: 'receipt'; gift_id: string; kind: PendingKind } // own claim/recall succeeded — optimistic hide
  | { type: 'receipt_failed'; gift_id: string; kind: PendingKind } // own claim/recall failed — re-derive

export type InboxRaw = { incoming: RpcInboxGift[]; outgoing: RpcInboxGift[] }

export type InboxState = {
  incoming: RpcInboxGift[] // PROJECTED render rows (raw, minus pending claims)
  outgoing: RpcInboxGift[] // PROJECTED render rows (raw, minus pending recalls)
  raw: InboxRaw // last rpc snapshot — the reconcile base (internal)
  pending: Record<string, PendingKind> // gift_id -> the action in flight, not yet proven by a snapshot
  loaded_once: boolean
  error: 'unavailable' | null
}

export type InboxDivergence = { gift_id: string; kind: PendingKind; predicted: number; snapshot: number } | null

export const empty_inbox_state = (): InboxState => ({
  incoming: [],
  outgoing: [],
  raw: { incoming: [], outgoing: [] },
  pending: {},
  loaded_once: false,
  error: null,
})

// Project raw snapshot rows through the pending ledger → render rows: a pending claim hides its row from
// `incoming`, a pending recall hides its row from `outgoing`. No partial value to decrement (unlike shop) — a
// gift is either visible or optimistically gone.
function project(
  raw: InboxRaw,
  pending: Record<string, PendingKind>
): { incoming: RpcInboxGift[]; outgoing: RpcInboxGift[] } {
  if (Object.keys(pending).length === 0) return raw
  return {
    incoming: raw.incoming.filter((g) => pending[g.gift_id] !== 'claim'),
    outgoing: raw.outgoing.filter((g) => pending[g.gift_id] !== 'recall'),
  }
}

export function reduce(state: InboxState, input: InboxInput): { state: InboxState; divergence: InboxDivergence } {
  switch (input.type) {
    // Own claim/recall landed: predict the hide into the pending ledger — dispatched as a `receipt`, never a raw
    // set() removing the row (ONE-PIPELINE law). A no-op if the gift isn't in the current snapshot base (mirrors
    // the M1 template's `!base` guard).
    case 'receipt': {
      const list = input.kind === 'claim' ? state.raw.incoming : state.raw.outgoing
      if (!list.some((g) => g.gift_id === input.gift_id)) return { state, divergence: null }
      const pending = { ...state.pending, [input.gift_id]: input.kind }
      return { state: { ...state, pending, ...project(state.raw, pending) }, divergence: null }
    }

    // Own claim/recall failed after painting: drop the pending hide and RE-DERIVE from the CURRENT snapshot base
    // — never a stored pre-action snapshot (the exact bug this migration kills: a rollback that wipes concurrent
    // poll data — e.g. a fresh incoming gift that arrived mid-flight — by restoring a frozen array).
    case 'receipt_failed': {
      if (state.pending[input.gift_id] !== input.kind) return { state, divergence: null }
      const pending = { ...state.pending }
      delete pending[input.gift_id]
      return { state: { ...state, pending, ...project(state.raw, pending) }, divergence: null }
    }

    // rpc snapshot: reconcile each PENDING row against the matching list. Omitted (claimed/recalled — proven by
    // chain) → drain. Still present → STALE, hold the optimistic hide (no resurrection). Still present but its
    // content shifted since our last accepted snapshot → flag divergence (log-only — see the file header).
    // Non-pending gifts adopt directly (project() only touches pending ids).
    case 'snapshot': {
      const raw: InboxRaw = { incoming: input.incoming, outgoing: input.outgoing }
      const incoming_by_id = new Map(input.incoming.map((g) => [g.gift_id, g]))
      const outgoing_by_id = new Map(input.outgoing.map((g) => [g.gift_id, g]))
      const prior_incoming_by_id = new Map(state.raw.incoming.map((g) => [g.gift_id, g]))
      const prior_outgoing_by_id = new Map(state.raw.outgoing.map((g) => [g.gift_id, g]))

      const pending: Record<string, PendingKind> = {}
      let divergence: InboxDivergence = null
      for (const [id, kind] of Object.entries(state.pending)) {
        const snap = (kind === 'claim' ? incoming_by_id : outgoing_by_id).get(id)
        if (!snap) continue // omitted — genuinely gone (claimed/recalled) — self-drain (OMIT SEMANTICS)
        const prior = (kind === 'claim' ? prior_incoming_by_id : prior_outgoing_by_id).get(id)
        if (prior && prior.items.length !== snap.items.length)
          divergence = { gift_id: id, kind, predicted: prior.items.length, snapshot: snap.items.length }
        pending[id] = kind // still present on-chain — stale snapshot, hold the optimistic hide
      }
      return { state: { ...state, raw, pending, ...project(raw, pending), loaded_once: true, error: null }, divergence }
    }

    case 'load_failed':
      return { state: { ...state, loaded_once: true, error: 'unavailable' }, divergence: null }

    default:
      return { state, divergence: null }
  }
}

interface InboxStore extends InboxState {
  loading: boolean
  busy_id: string | null // the gift_id of an in-flight claim / recall
  /** Fetch the address's inbox; a fresh INCOMING gift toasts once. `silent` skips the new-gift toast (first load). */
  load: (address: string, opts?: { silent?: boolean }) => Promise<void>
  claim: (gift: RpcInboxGift) => Promise<void>
  recall: (gift: RpcInboxGift) => Promise<void>
  /** DEV-only fixture seam for the mocked-row screenshot proof (the /v1 view isn't live). */
  __inject: (data: { incoming?: RpcInboxGift[]; outgoing?: RpcInboxGift[] }) => void
  reset: () => void
}

// Seen INCOMING gift ids (closure, never in the store — a re-render must not churn it). Cleared on reset so a
// wallet switch starts fresh. First load stamps them silently; later loads toast only the genuinely-new ones.
// Unrelated to the reducer's reconcile — this is purely the edge-side "new gift" toast decision, untouched by
// the ONE-PIPELINE migration.
let seen_incoming = new Set<string>()

export const use_inbox = create<InboxStore>((set, get) => ({
  ...empty_inbox_state(),
  loading: false,
  busy_id: null,

  load: async (address, opts) => {
    if (!address) return
    // IN-FLIGHT LATCH (M1 pattern) — a mount / focus-refire / 20s poll tick must not overlap-refire the read.
    if (get().loading) return
    set({ loading: true })
    try {
      const { incoming, outgoing } = await get_inbox(address)
      // New-gift toast (never on the first, silent load — that just seeds the seen set).
      if (!opts?.silent && get().loaded_once) {
        const fresh = incoming.filter((g) => !seen_incoming.has(g.gift_id))
        if (fresh.length > 0) {
          const count = fresh.reduce((n, g) => n + g.items.length, 0)
          use_toast.getState().add(i18n.t('gift.inbox.toast_received', { count }), 'info')
        }
      }
      seen_incoming = new Set(incoming.map((g) => g.gift_id))
      const { state, divergence } = reduce(get(), { type: 'snapshot', incoming, outgoing })
      if (divergence)
        game_log(
          'inbox',
          'gift divergence — predicted ≠ chain while still pending (holding, not resurrecting)',
          divergence
        )
      set({ ...state, loading: false })
    } catch (e) {
      // The /v1/inbox route isn't live yet. Keep last-good data for recovery, but mark the read unavailable so
      // the UI never misrepresents an absent route or a transient failure as a genuinely empty inbox.
      if (!(e instanceof RpcError)) game_log('inbox', 'load failed', e)
      set({ ...reduce(get(), { type: 'load_failed' }).state, loading: false })
    }
  },

  claim: async (gift) => {
    if (get().busy_id) return
    set({ busy_id: gift.gift_id })
    // Optimistic: the row leaves `incoming` instantly, dispatched as a `receipt` — never a raw set()
    // (ONE-PIPELINE law). A failure re-derives via `receipt_failed`, never a restored pre-claim snapshot.
    set((s) => reduce(s, { type: 'receipt', gift_id: gift.gift_id, kind: 'claim' }).state)
    use_toast
      .getState()
      .promise(
        write_gift().then(({ claim_gift }) =>
          claim_gift({ gift_id: gift.gift_id, sender_kiosk_id: gift.sender_kiosk_id })
        ),
        { pending: i18n.t('gift.inbox.pending_claim'), success: i18n.t('gift.inbox.toast_claimed') }
      )
      .catch(() => set((s) => reduce(s, { type: 'receipt_failed', gift_id: gift.gift_id, kind: 'claim' }).state))
      .finally(() => set({ busy_id: null }))
  },

  recall: async (gift) => {
    if (get().busy_id) return
    set({ busy_id: gift.gift_id })
    set((s) => reduce(s, { type: 'receipt', gift_id: gift.gift_id, kind: 'recall' }).state)
    use_toast
      .getState()
      .promise(
        write_gift().then(({ recall_gift }) =>
          recall_gift({ gift_id: gift.gift_id, sender_kiosk_id: gift.sender_kiosk_id })
        ),
        { pending: i18n.t('gift.inbox.pending_recall'), success: i18n.t('gift.inbox.toast_recalled') }
      )
      .catch(() => set((s) => reduce(s, { type: 'receipt_failed', gift_id: gift.gift_id, kind: 'recall' }).state))
      .finally(() => set({ busy_id: null }))
  },

  __inject: (data) =>
    set({
      ...reduce(get(), { type: 'snapshot', incoming: data.incoming ?? [], outgoing: data.outgoing ?? [] }).state,
      loading: false,
    }),

  reset: () => {
    seen_incoming = new Set()
    set({ ...empty_inbox_state(), loading: false, busy_id: null })
  },
}))

// DEV-only fixture seam (the /v1/inbox view isn't live — behavior key post-publish): exposes the store so a
// screenshot/QA harness can inject mocked rows via `window.__inbox.getState().__inject({...})`. Statically
// stripped from the prod build (import.meta.env.DEV is false → the branch drops).
if (import.meta.env.DEV && typeof window !== 'undefined')
  (window as unknown as { __inbox?: typeof use_inbox }).__inbox = use_inbox
