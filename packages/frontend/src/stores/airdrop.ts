// airdrop.ts — whitelist claim-MINT airdrops for external-collection holders (airdrop.move,
// DECISIONS 2026-07-13 18:4x). Each drop mints ONE reserved item into the whitelisted signer's OWN kiosk,
// kiosk-locked (mint-lock — no royalty, none bypassed); the claim REMOVES the address from the whitelist
// (one-claim by construction). Eligibility checks the connected identity set (the zkLogin address AND, when one
// is connected, an external wallet; the app's single-wallet session passes one address today, the
// array is the extension seam).
//
// The /v1/airdrops view + the whitelist CONTENT land "way later" — so the honest EMPTY state ("no active
// airdrops") is the default until then. `__inject` is the DEV fixture seam for the empty/populated screenshots.

import { create } from 'zustand'

import type { RpcAirdrop } from '../rpc/views'
import { get_airdrops, RpcError } from '../rpc/client'
import { use_toast } from '../toast'
import i18n from '../i18n'
import { game_log } from '../core/log.js'

// `write_gift.js` statically imports `../auth`, which registers Enoki wallets against `window` at module scope
// (a browser-only side effect). A LAZY import keeps that poisoned chain out of anything that merely imports the
// pure reducer below (bun test has no `window`) without touching auth/index.ts or write_gift.js.
const write_gift = () => import('../chain/write/write_gift')

// ─── THE ONE-PIPELINE REDUCER (M1 shop template — CLIENT-INDEPENDENCE law, project CLAUDE.md Principle 6) ──────
// Folds load + claim into ONE pure reducer so a stale 30s poll can never flip a just-claimed card back to
// "eligible" (CLIENT_DESIGN_AUDIT row #8). The client predicts its own claim into a pending ledger keyed by
// airdrop_id; the version is each row's `minted` (a monotonic claim counter — same shape as shop's). `floor[id]`
// is the minted a snapshot must reach to PROVE our claim. Merge law: minted ≥ floor, OR the drop omitted from the
// feed (genuinely gone — OMIT SEMANTICS: same drain-on-omit choice as M1's shop) → drain; minted < floor → stale,
// hold the optimistic claim (no bounce back to "eligible"); same-version eligibility mismatch → adopt chain +
// flag a divergence. Rollback is a `receipt_failed` input that re-derives from the snapshot base — never a
// stored pre-claim snapshot.

export type AirdropInput =
  | { type: 'snapshot'; airdrops: RpcAirdrop[] } // rpc load result — each row versioned by its `minted`
  | { type: 'receipt'; airdrop_id: string } // own claim succeeded — optimistic empty eligible_for, raise the floor
  | { type: 'receipt_failed'; airdrop_id: string } // own claim failed — drain the pending row, re-derive

export type AirdropState = {
  airdrops: RpcAirdrop[] // PROJECTED render rows (raw ⊕ pending) — the API-compatible selector components read
  raw: RpcAirdrop[] // last rpc snapshot — the reconcile base (internal)
  pending: Record<string, number> // per-drop optimistic claim units awaiting snapshot proof — always 1 (one-claim
  // by construction) but kept numeric for shape parity with the M1 pending ledger
  floor: Record<string, number> // per-drop proven `minted` watermark (the monotonic version floor)
  loaded_once: boolean
}

export type AirdropDivergence = { airdrop_id: string; predicted: number; snapshot: number; version: number } | null

export const empty_airdrop_state = (): AirdropState => ({
  airdrops: [],
  raw: [],
  pending: {},
  floor: {},
  loaded_once: false,
})

// Project raw snapshot rows through the pending ledger → render rows. A claimed row's whitelist entry clears
// (mirrors the pre-refactor optimistic update verbatim: the app's single-wallet session passes ONE connected
// address today, so "claimed" collapses `eligible_for` to empty — a multi-identity claim is the documented
// extension seam, unchanged by this migration).
function project(raw: RpcAirdrop[], pending: Record<string, number>): RpcAirdrop[] {
  if (Object.keys(pending).length === 0) return raw
  return raw.map((a) => {
    const units = pending[a.airdrop_id] ?? 0
    if (units <= 0) return a
    return { ...a, eligible_for: [], minted: (a.minted ?? 0) + units }
  })
}

export function reduce(
  state: AirdropState,
  input: AirdropInput
): { state: AirdropState; divergence: AirdropDivergence } {
  switch (input.type) {
    // Own claim landed: predict the whitelist removal into the pending ledger, and raise the floor to the
    // `minted` the chain must reach before a snapshot may drop this row's pending entry.
    case 'receipt': {
      const base = state.raw.find((a) => a.airdrop_id === input.airdrop_id)
      if (!base) return { state, divergence: null }
      const pending = { ...state.pending, [input.airdrop_id]: (state.pending[input.airdrop_id] ?? 0) + 1 }
      const floor = { ...state.floor, [input.airdrop_id]: (base.minted ?? 0) + pending[input.airdrop_id] }
      return { state: { ...state, pending, floor, airdrops: project(state.raw, pending) }, divergence: null }
    }

    // Own claim failed after painting: drain the pending unit and RE-DERIVE from the current snapshot base —
    // never a stored pre-claim snapshot.
    case 'receipt_failed': {
      const held = state.pending[input.airdrop_id] ?? 0
      if (held <= 0) return { state, divergence: null }
      const pending = { ...state.pending }
      const floor = { ...state.floor }
      delete pending[input.airdrop_id]
      delete floor[input.airdrop_id]
      return { state: { ...state, pending, floor, airdrops: project(state.raw, pending) }, divergence: null }
    }

    // rpc snapshot: reconcile each PENDING row against the snapshot's `minted`. minted ≥ floor (or the drop
    // dropped from the feed — genuinely gone) → drain, chain wins; minted < floor → STALE, hold the optimistic
    // claim (no bounce). A same-version eligibility mismatch is adopted and flagged. Non-pending drops adopt
    // directly.
    case 'snapshot': {
      const by_id = new Map(input.airdrops.map((r) => [r.airdrop_id, r]))
      const pending: Record<string, number> = {}
      const floor: Record<string, number> = {}
      let divergence: AirdropDivergence = null
      for (const [id, units] of Object.entries(state.pending)) {
        const snap = by_id.get(id)
        const fl = state.floor[id] ?? 0
        if (!snap || (snap.minted ?? 0) >= fl) {
          if (snap && (snap.minted ?? 0) === fl) {
            const predicted = state.airdrops.find((a) => a.airdrop_id === id)
            if (predicted && predicted.eligible_for.length !== snap.eligible_for.length)
              divergence = {
                airdrop_id: id,
                predicted: predicted.eligible_for.length,
                snapshot: snap.eligible_for.length,
                version: fl,
              }
          }
          continue // proven by chain (or gone from the feed) — self-drain
        }
        pending[id] = units // stale snapshot — keep the optimistic claim
        floor[id] = fl
      }
      return {
        state: {
          ...state,
          raw: input.airdrops,
          pending,
          floor,
          airdrops: project(input.airdrops, pending),
          loaded_once: true,
        },
        divergence,
      }
    }

    default:
      return { state, divergence: null }
  }
}

interface AirdropStore extends AirdropState {
  loading: boolean
  busy_id: string | null
  /** `addresses` = the connected identity set (zkLogin + optional external wallet). Degrades to empty on a read miss. */
  load: (addresses: string[]) => Promise<void>
  claim: (airdrop: RpcAirdrop) => Promise<void>
  __inject: (airdrops: RpcAirdrop[]) => void
  reset: () => void
}

export const use_airdrops = create<AirdropStore>((set, get) => ({
  ...empty_airdrop_state(),
  loading: false,
  busy_id: null,

  load: async (addresses) => {
    // IN-FLIGHT LATCH (M1 pattern) — a mount / focus-refire / 30s poll tick must not overlap-refire the read.
    if (get().loading) return
    const ids = addresses.filter(Boolean)
    set({ loading: true })
    if (ids.length === 0) {
      // No connected identity: dispatch an empty snapshot through the SAME merge law (any pending claim drains
      // via the ordinary omission rule) rather than a bespoke early-return set().
      set({ ...reduce(get(), { type: 'snapshot', airdrops: [] }).state, loading: false })
      return
    }
    try {
      const airdrops = await get_airdrops(ids)
      const { state, divergence } = reduce(get(), { type: 'snapshot', airdrops })
      if (divergence)
        game_log('airdrop', 'eligibility divergence — predicted ≠ chain at same version (adopting chain)', divergence)
      set({ ...state, loading: false })
    } catch (e) {
      // /v1/airdrops isn't live + no whitelist content yet ⇒ honest empty state (already empty pre-publish). A
      // transient failure post-publish now KEEPS last-good data (M1 pattern) instead of flashing to empty.
      if (!(e instanceof RpcError)) game_log('airdrop', 'load failed', e)
      set({ loading: false, loaded_once: true })
    }
  },

  claim: async (airdrop) => {
    if (get().busy_id) return
    set({ busy_id: airdrop.airdrop_id })
    // Optimistic: dispatched as a `receipt` input, reconciled by reduce — never a raw set() (ONE-PIPELINE law).
    set((s) => reduce(s, { type: 'receipt', airdrop_id: airdrop.airdrop_id }).state)
    use_toast
      .getState()
      .promise(
        write_gift().then(({ claim_airdrop }) =>
          claim_airdrop({ airdrop_id: airdrop.airdrop_id, template_id: airdrop.template_id })
        ),
        { pending: i18n.t('airdrop.pending_claim'), success: i18n.t('airdrop.toast_claimed') }
      )
      // A failure re-derives from the current snapshot base via `receipt_failed` — never a stored pre-claim
      // snapshot (the humanized reason toasts separately).
      .catch(() => set((s) => reduce(s, { type: 'receipt_failed', airdrop_id: airdrop.airdrop_id }).state))
      .finally(() => set({ busy_id: null }))
  },

  __inject: (airdrops) => set({ ...reduce(get(), { type: 'snapshot', airdrops }).state, loading: false }),

  reset: () => set({ ...empty_airdrop_state(), loading: false, busy_id: null }),
}))

// DEV-only fixture seam (the /v1/airdrops view + whitelist content are not implemented yet): exposes the store
// so a screenshot/QA harness can inject mocked drops via `window.__airdrops.getState().__inject([...])`.
// Statically stripped from the prod build.
if (import.meta.env.DEV && typeof window !== 'undefined')
  (window as unknown as { __airdrops?: typeof use_airdrops }).__airdrops = use_airdrops
