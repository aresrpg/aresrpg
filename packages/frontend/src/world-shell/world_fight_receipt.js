// Receipt-first world-fight convergence. A successful create/join transaction already proves the Fight id; the
// full object may still be temporarily unreadable from the serving node. Keep that receipt-owned id mounted and
// retry the existing full-board reader forever with capped exponential backoff. Cancellation is state-driven: a
// different session replacing the id (or an explicit teardown clearing `fight_syncing`) stops the loop.

const sync_min_delay_ms = 250
const sync_max_delay_ms = 8000

/** Capped exponential delay for a zero-based retry attempt. */
export function fight_sync_delay_ms(attempt) {
  const exponent = Math.max(0, Number(attempt) || 0)
  return Math.min(sync_max_delay_ms, sync_min_delay_ms * 2 ** exponent)
}

/**
 * Decide whether a receipt-owned fight may enter the shared board store. Re-entering the same id is deliberately
 * a no-op: when the full read catches up it enriches the existing session instead of mounting a second board.
 */
export function receipt_entry_decision({ current_fight_id, current_run_pass_id, next_fight_id, character_id }) {
  if (!next_fight_id || !character_id) return 'invalid'
  if (current_fight_id === next_fight_id) return 'same'
  if (current_fight_id || current_run_pass_id) return 'busy'
  return 'enter'
}

/** True only for the unreadable Fight id whose executed receipt is still the local source of truth. */
export function should_hold_receipt_fight(state, fight_id) {
  return Boolean(state?.fight_syncing && fight_id && state?.fight_id === fight_id)
}

/** @returns {'pending'|'hydrated'|'cancelled'} */
function receipt_sync_state(state, fight_id) {
  if (state?.dungeon?.id === fight_id) return 'hydrated'
  return should_hold_receipt_fight(state, fight_id) ? 'pending' : 'cancelled'
}

const sleep_ms = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Poll the full-board reader until the receipt-owned Fight hydrates or its session is explicitly replaced. There
 * is no attempt ceiling: a lagging projection stays visibly syncing instead of becoming a refresh-only dead end.
 * Reader errors are another lag sample, not a reason to discard an executed receipt.
 *
 * @param {{ fight_id:string, get_state:()=>any, refresh:()=>Promise<any>, sleep?:(ms:number)=>Promise<any> }} args
 * @returns {Promise<'hydrated'|'cancelled'>}
 */
export async function poll_receipt_fight({ fight_id, get_state, refresh, sleep = sleep_ms }) {
  let attempt = 0
  while (receipt_sync_state(get_state(), fight_id) === 'pending') {
    try {
      await refresh()
    } catch {
      // The store reader normally contains its own error surface. An injected/transport throw still must retry.
    }
    const state = receipt_sync_state(get_state(), fight_id)
    if (state !== 'pending') return state
    await sleep(fight_sync_delay_ms(attempt))
    attempt += 1
  }
  return receipt_sync_state(get_state(), fight_id) === 'hydrated' ? 'hydrated' : 'cancelled'
}

/**
 * Execute a world-fight join, then enter from that very receipt boundary. A rejection never enters; a resolved
 * receipt enters before the caller closes its modal, so party members do not wait for a later discovery poll.
 */
export async function enter_after_world_join_receipt({ execute, enter, fight_id, world_id = null, character_id }) {
  const receipt = await execute()
  enter({ fight_id, world_id, character_id })
  return receipt
}
