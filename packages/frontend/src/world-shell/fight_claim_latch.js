// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One-attempt auto-claim coordinator. `run_latched_claim` keeps its registry injected for headless units;
// `run_signal_settlement` adds the app edge that feeds confirmations/outcomes through the fight reducer.

import * as project from '@aresrpg/fight/project'
import { STATUS_FAILED } from '@aresrpg/fight/board_state'
import { fight_store } from '@aresrpg/fight/store'

import { get_sdk } from '../chain/sdk'

import { read_fight_liveness } from './fight_liveness.js'
import { attempt_state } from './pending_outcomes.js'

/**
 * @param {{ attempt_id:string, manual?:boolean,
 *   begin:(id:string, opts:{manual:boolean})=>boolean,
 *   end:(id:string, verdict:'settled'|'transient'|'executed_failure')=>void,
 *   run:(note_failure:(verdict:'transient'|'executed_failure')=>void)=>Promise<boolean> }} args
 */
export async function run_latched_claim({ attempt_id, manual = false, begin, end, run }) {
  if (!attempt_id || !begin(attempt_id, { manual })) return false
  let failure = 'executed_failure'
  const note_failure = (verdict) => {
    failure = verdict === 'transient' ? 'transient' : 'executed_failure'
  }
  let landed = false
  try {
    landed = Boolean(await run(note_failure))
    return landed
  } finally {
    end(attempt_id, landed ? 'settled' : failure)
  }
}

// SELF-DRIVING RETRY ("why would we have pending outcomes??" — the world-HUD fallback chip is deleted,
// so a settlement stall can no longer hide behind a manual press): claim() (dungeon_run_store.js) stops the
// ambient refresh() poll and tears the session down BEFORE this fires, so a TRANSIENT (pre-flight, zero-gas —
// nothing executed) settle failure whose immediate liveness recheck does not yet show 'settled' used to fall
// back to a fight_store.subscribe() wait for a fresh reducer fold that NOTHING would ever deliver (no poll, no
// live session) — the outcome sat genuinely unclaimed until a SEPARATE wallet-level wire (page reload / the
// next abort-111 refusal) eventually rescanned it. Bounded backoff instead: keep re-checking chain liveness
// directly — cheap reads, no tx — until it reports 'settled' (then retry the SAME settle attempt once more) or
// the budget runs out (falls back to the wallet-level wires exactly as before — never worse than today).
const LIVENESS_RETRY_MS = 2000 // mirrors dungeon_run_store.js's POLL_MS cadence — a read backoff, not a budget
const LIVENESS_RETRY_ATTEMPTS = 5 // ~10s of headroom for a fullnode dry-run/finality lag to clear on its own

/** One retry per newer reducer confirmation; a post-refusal liveness read is the only signal this edge creates.
 * `store`/`read_fight_liveness_fn`/`get_sdk_fn`/`sleep`/`max_liveness_retries` are injectable so a unit test
 * drives the retry on an isolated store + a fake clock — production callers (dungeon_fight_shim.js's
 * route_settlement) take every default and behave byte-identical to before, minus the dead subscription. */
export async function run_signal_settlement(
  status,
  fight_id,
  run,
  {
    store = fight_store,
    read_fight_liveness_fn = read_fight_liveness,
    get_sdk_fn = get_sdk,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    max_liveness_retries = LIVENESS_RETRY_ATTEMPTS,
    retry_delay_ms = LIVENESS_RETRY_MS,
  } = {}
) {
  const attempt = async (delivered_request = null) => {
    const request = delivered_request ?? project.settlement_request(store.getState())
    if (!request || request.status !== status) return false
    store.getState().input({ type: 'settlement_attempt', signal: request.signal })
    const landed = await Promise.resolve()
      .then(run)
      .then(Boolean)
      .catch(() => false)
    const verdict = landed ? 'opened' : attempt_state(fight_id) === 'latched' ? 'executed_failure' : 'transient'
    store.getState().input({ type: 'settlement_outcome', signal: request.signal, verdict })
    if (verdict !== 'transient') return landed
    for (let left = max_liveness_retries; left > 0; left--) {
      if (project.settlement_request(store.getState())) return attempt() // a real fold beat us to it — adopt it
      const liveness = await read_fight_liveness_fn(await get_sdk_fn(), fight_id).catch(() => null)
      if (liveness?.state === 'settled') {
        // Priority 3 (terminal_source_priority) always wins a fresh signal — this is what re-opens the request
        // the 'transient' outcome just gated shut, WITHOUT re-firing the tx blindly (the burn-law latch stays
        // entirely inside run_latched_claim; this only feeds the confirmation the next attempt() reads).
        store.getState().input({
          type: 'terminal_confirmation',
          phase: status === STATUS_FAILED ? 'defeat' : 'victory',
          last_room: true,
          source: 'settlement_snapshot',
          version: Number(liveness.read?.version ?? 0),
        })
        return attempt()
      }
      if (liveness?.state === 'absent') return false // gone elsewhere (a racing settle) — the pending-outcomes leaf owns it now
      await sleep(retry_delay_ms)
    }
    return false // budget exhausted — the wallet-level boot/abort-111 wires remain the backstop, unchanged
  }
  // The board consumes its UI delivery before a killing wave necessarily drains. Adopt that already-fired
  // request exactly once here; every retry above still requires a fresh, normally projected confirmation.
  return attempt(project.settlement_request(store.getState(), { include_consumed: true }))
}
