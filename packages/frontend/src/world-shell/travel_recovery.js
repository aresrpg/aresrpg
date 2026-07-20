// ETravelTooFar RECOVERY — turn checkpoint::102 into an in-place return to chain truth. The failed tx is
// NEVER retried here (an executed failure may already have burned gas): the action only re-reads the character's
// proven checkpoint and asks the live voxel session to move its body there. The player's original action remains
// manual after the resync.

import i18n from '../i18n'
import { use_toast } from '../toast'
import { game_log } from '../core/log.js'
import { report_error } from '../core/report.js'
import { parse_move_abort } from '../game/core/abort_copy.js'

/** @param {unknown} error @param {(error: unknown) => any} parse_abort */
export function is_travel_too_far(error, parse_abort = parse_move_abort) {
  const abort = parse_abort(error)
  return abort?.module === 'checkpoint' && abort?.code === 102
}

/**
 * Side-effect shell kept dependency-injected so the action/latch contract is unit-testable without a renderer.
 * One live voxel session registers `resync`; the tx chokepoints call `offer` for every error. Repeated detections
 * replace the exact prior action toast, and repeated clicks share one in-flight checkpoint read/teleport.
 * @param {{
 *   parse_abort: (error: unknown) => any,
 *   translate: (key: string) => string,
 *   add_persistent: (message: string, type: 'error', action: {label:string,onClick:()=>Promise<boolean>}) => number,
 *   remove: (id: number) => void,
 *   on_failure?: (error: unknown) => void,
 * }} deps
 */
export function create_travel_recovery({ parse_abort, translate, add_persistent, remove, on_failure = () => {} }) {
  /** @type {null | (() => Promise<boolean> | boolean)} */
  let target = null
  /** @type {number | null} */
  let toast_id = null
  /** @type {Promise<boolean> | null} */
  let in_flight = null

  const resync = () => {
    if (in_flight) return in_flight
    const active = target
    if (!active) return Promise.resolve(false)
    in_flight = Promise.resolve()
      .then(active)
      .then((moved) => {
        if (!moved) return false
        if (toast_id != null) remove(toast_id)
        toast_id = null
        return true
      })
      .catch((error) => {
        on_failure(error)
        return false
      })
      .finally(() => {
        in_flight = null
      })
    return in_flight
  }

  return {
    /** Last-mounted live session wins; stale cleanup cannot clear a newer session's handler. */
    register(/** @type {() => Promise<boolean> | boolean} */ handler) {
      target = handler
      return () => {
        if (target === handler) target = null
      }
    },

    /** Offer the one-click recovery only for checkpoint::102; every other failure is untouched. */
    offer(error) {
      if (!is_travel_too_far(error, parse_abort)) return false
      if (toast_id != null) remove(toast_id)
      toast_id = add_persistent(translate('errors.travel_too_far'), 'error', {
        label: translate('errors.travel_resync_action'),
        onClick: resync,
      })
      return true
    },

    resync,
  }
}

const recovery = create_travel_recovery({
  parse_abort: parse_move_abort,
  translate: (key) => i18n.t(key),
  add_persistent: (message, type, action) => use_toast.getState().add_persistent(message, type, action),
  remove: (id) => use_toast.getState().remove(id),
  on_failure: (error) => {
    game_log('checkpoint', 'in-place travel resync failed', error)
    report_error(error, { area: 'checkpoint', action: 'travel_resync' })
  },
})

/** Register the live voxel body's checkpoint-resync handler. */
export const register_travel_resync_target = recovery.register

/** Detect checkpoint::102 and show the persistent one-click recovery action. */
export const offer_travel_resync = recovery.offer
