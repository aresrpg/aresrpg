// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// UNOPENED FIGHT RESULTS — the LAST-RESORT recovery pill (#1383). It is NOT the normal flow: a settled fight
// resolves itself (result_resolver.js re-simulates the open for free on a backoff until it lands), so this
// renders NOTHING while that is working. It appears only when a result is genuinely STUCK — the spend guard's
// circuit opened on it (an executed failure burned gas: never re-sent) or it has kept refusing pre-flight past
// RESOLVER_STUCK_REFUSALS. `result_is_stuck` is that ONE verdict; this file only paints it.
// A character with an unopened outcome cannot enter another fight (fight_marker → abort 111); `results::open` is
// the only discharge. TWO shapes, one pill:
//   leaf 2 — a still-indexed victory/defeat fight doc = settle never ran → the auto-settle sweep takes world
//            fights; a DUNGEON-bound one needs this press (auto never improvises a permissionless janitor tx);
//   leaf 3 — a `/v1/pending-outcomes` row, rendered ONLY on the stuck verdict above.
// Reactivity: the memoized per-wallet fetch + subscribe_attempts (registry transitions re-derive the beat) —
// zero polling. The manual press keeps the recover_pending flow (one attempt per press, never auto-retried).

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { use_auth } from '../../../auth'
import { get_fights } from '../../../rpc/client'
import { use_dungeon } from '../../../world-shell/dungeon_store.js'
import { find_pending_outcome } from '../../../world-shell/dungeon_settlement.js'
import { attempt_state, subscribe_attempts, result_open_intent } from '../../../world-shell/pending_outcomes.js'
import { spend_guard_attempts, spend_guard_circuit_open } from '../../../world-shell/spend_guard.js'
import { result_is_stuck } from '../../../world-shell/result_resolver.js'

/**
 * @param {{ character_id: string }} props
 */
export function PendingOutcomeBadge({ character_id }) {
  const { t } = useTranslation()
  const address = use_auth((s) => s.address)
  // idle = nothing pending, still checking, OR the resolver is quietly working on it → render null;
  // pending = genuinely STUCK (result_is_stuck) or a leaf-2 unsettled fight → the manual press;
  // recovering = the manual press in flight; done = resolved this mount → render null; error = the manual press
  // failed (loud toast already fired) → the button stays so the player can retry (one press, one attempt).
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
      // leaf 3 — the ONE pending-outcomes projection, rendered only on the stuck verdict (the resolver loop owns
      // every normal case and needs no UI at all).
      let row = null
      try {
        row = await find_pending_outcome(address, character_id)
      } catch {
        /* projection hiccup → no pill; the next signal re-checks */
      }
      if (!live) return
      // Row gone: resolved (or none) — but never stomp a manual press mid-flight (its own flow sets the state).
      if (!row) return set_state((cur) => (cur === 'recovering' || cur === 'error' ? cur : 'idle'))
      const intent = result_open_intent(row.outcome_id)
      const stuck = result_is_stuck({
        attempt: attempt_state(row.outcome_id), // 'opened' (receipt tombstone) and 'inflight' are never stuck
        circuit_open: spend_guard_circuit_open(intent),
        refusals: spend_guard_attempts(intent),
      })
      set_state(stuck ? 'pending' : 'idle')
    })()
    return () => {
      live = false
    }
  }, [character_id, address, tick])

  if (state === 'idle' || state === 'done') return null

  const busy = state === 'recovering'
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
      title={t('errors.fight_result_stuck')}
    >
      <span className="chr-pending__dot" aria-hidden="true" />
      <span className="chr-pending__label">{busy ? t('dungeons.opening_outcome') : t('dungeons.pending_outcome')}</span>
      {!busy && <span className="chr-pending__cta">{t('dungeons.open_outcome')}</span>}
    </button>
  )
}
