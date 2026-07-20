// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// UNOPENED FIGHT RESULTS — the roster pill, a pure RENDERER (detection/firing moved to
// the boot + abort-111 refusal wires in dungeon_store.js — "auto open whenever DETECTED" must not depend on a
// UI surface mounting, since a session can restore straight into the world without this badge ever mounting). A
// character with an unopened outcome cannot enter another fight (fight_marker → abort 111); `results::open` is
// the only discharge. TWO shapes, one pill:
//   leaf 2 — a still-indexed victory/defeat fight doc = settle never ran → MANUAL pill (the press drives the
//            full settle+open chain; auto-settling a race-prone permissionless janitor tx is NOT in scope);
//   leaf 3 — a `/v1/pending-outcomes` row: rendered from the SHARED state the wires drive — 'opening' while an
//            auto attempt is in flight (a transient status beat, not a call-to-action; the success beat is the
//            XP/loot toast), the amber manual press when latched/blocked (executed-failure latch, dungeon-bound
//            rows, live-session guard).
// Reactivity: the memoized per-wallet fetch + subscribe_attempts (registry transitions re-derive the beat) —
// zero polling. The manual press keeps the recover_pending flow (one attempt per press, never auto-retried).

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { use_auth } from '../../../auth'
import { get_fights } from '../../../rpc/client'
import { use_dungeon } from '../../../world-shell/dungeon_store.js'
import { find_pending_outcome } from '../../../world-shell/dungeon_settlement.js'
import { attempt_state, subscribe_attempts } from '../../../world-shell/pending_outcomes.js'

/**
 * @param {{ character_id: string }} props
 */
export function PendingOutcomeBadge({ character_id }) {
  const { t } = useTranslation()
  const address = use_auth((s) => s.address)
  // idle = nothing pending (or still checking) → render null; opening = an AUTO attempt is in flight (passive
  // beat); pending = the manual fallback press (latched / blocked / leaf-2 unsettled); recovering = the manual
  // press in flight; done = resolved this mount → render null; error = the manual press failed (loud toast
  // already fired) → the button stays so the player can retry (one attempt per press, never auto).
  const [state, set_state] = useState('idle')
  // Registry transitions (the wires' attempts beginning/ending) re-derive the beat — no polling.
  const [tick, set_tick] = useState(0)
  useEffect(() => subscribe_attempts(() => set_tick((n) => n + 1)), [])

  useEffect(() => {
    if (!character_id || !address) return undefined
    let live = true
    ;(async () => {
      // ONE /v1 fights read serves both gates: a LIVE (placement/active) fight → no pill; a TERMINAL doc =
      // leaf 2 (settle never ran) → manual pill.
      let fights = []
      try {
        fights = (await get_fights({ character: character_id })) ?? []
      } catch {
        /* read hiccup → fall through to the pending-outcomes read (never claim a state we could not confirm) */
      }
      if (!live) return
      if (fights.some((f) => f && (f.status === 'placement' || f.status === 'active'))) return set_state('idle')
      if (fights.some((f) => f && (f.status === 'victory' || f.status === 'defeat'))) return set_state('pending')
      // leaf 3 — RENDER the shared unopened-results state (the boot/refusal wires own the trigger).
      let row = null
      try {
        row = await find_pending_outcome(address, character_id)
      } catch {
        /* projection hiccup → no pill; the next signal re-checks */
      }
      if (!live) return
      // Row gone: resolved (or none) — but never stomp a manual press mid-flight (its own flow sets the state).
      if (!row) return set_state((cur) => (cur === 'recovering' || cur === 'error' ? cur : 'idle'))
      set_state(attempt_state(row.outcome_id) === 'inflight' ? 'opening' : 'pending')
    })()
    return () => {
      live = false
    }
  }, [character_id, address, tick])

  if (state === 'idle' || state === 'done') return null

  const busy = state === 'opening' || state === 'recovering'
  const on_open = async () => {
    if (busy) return
    set_state('recovering')
    const outcome = await use_dungeon.getState().recover_pending(character_id)
    // 'clean' = the read raced and it is already resolved — treat as done (hide). 'failed' = keep, allow retry.
    set_state(outcome === 'failed' ? 'error' : 'done')
  }

  return (
    <button
      type="button"
      className={`chr-pending${state === 'error' ? ' is-error' : ''}`}
      onClick={on_open}
      disabled={busy}
      title={t('errors.fight_unclaimed_result')}
    >
      <span className="chr-pending__dot" aria-hidden="true" />
      <span className="chr-pending__label">{busy ? t('dungeons.opening_outcome') : t('dungeons.pending_outcome')}</span>
      {!busy && <span className="chr-pending__cta">{t('dungeons.open_outcome')}</span>}
    </button>
  )
}
