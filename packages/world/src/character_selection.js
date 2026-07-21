// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Active-character selection orchestration shared by CharacterSwitcher and its store-level proof. This leaf
// accepts the concrete stores/actions as dependencies so the state transition has one explicit order and the
// test can exercise it without process-global module mocks.

import { createStore } from 'zustand/vanilla'

export const CHARACTER_SWITCH_IN_PROGRESS = 'switch_in_progress'
export const CHARACTER_SWITCH_INVALID = 'invalid_character'
export const CHARACTER_SWITCH_SESSION_CHANGED = 'session_changed'

/** @typedef {'idle'|'switching'|'done'|'failed'} CharacterSwitchPhase */
/** @typedef {'done'|'failed'|'refused'} CharacterSwitchResultStatus */
/**
 * @typedef {{
 *   phase: CharacterSwitchPhase,
 *   target_id: string|null,
 *   request_id: number|null,
 *   request_seq: number,
 *   notice: { seq:number, reason:string, target_id:string|null }|null,
 *   notice_seq: number,
 *   last_result: { status:CharacterSwitchResultStatus, request_id:number, target_id:string|null, error?:unknown, reason?:string }|null,
 * }} CharacterSwitchState
 */

/** @returns {CharacterSwitchState} */
export function initial_character_switch_state() {
  return {
    phase: 'idle',
    target_id: null,
    request_id: null,
    request_seq: 0,
    notice: null,
    notice_seq: 0,
    last_result: null,
  }
}

/** Every refused click gets a fresh sequence, including repeated clicks for the same reason. */
const with_switch_notice = (state, reason, target_id) => {
  const notice_seq = state.notice_seq + 1
  return { ...state, notice_seq, notice: { seq: notice_seq, reason, target_id: target_id ?? null } }
}

/**
 * The one active-character switch fold. A click always emits exactly one observable output: either a fresh
 * request sequence or a fresh notice sequence. Terminal inputs are request-correlated, so a late promise can
 * never settle a replacement attempt.
 * @param {CharacterSwitchState} state
 * @param {any} input
 * @returns {CharacterSwitchState}
 */
export function reduce_character_switch(state, input) {
  switch (input.type) {
    case 'clicked': {
      const target_id = input.character_id ?? null
      if (!target_id) return with_switch_notice(state, CHARACTER_SWITCH_INVALID, null)
      if (state.phase !== 'idle') return with_switch_notice(state, CHARACTER_SWITCH_IN_PROGRESS, target_id)
      const request_id = state.request_seq + 1
      return {
        ...state,
        phase: 'switching',
        target_id,
        request_id,
        request_seq: request_id,
        notice: null,
        last_result: null,
      }
    }
    case 'succeeded':
      return state.phase === 'switching' && state.request_id === input.request_id
        ? {
            ...state,
            phase: 'done',
            last_result: { status: 'done', request_id: input.request_id, target_id: state.target_id },
          }
        : state
    case 'failed':
      return state.phase === 'switching' && state.request_id === input.request_id
        ? {
            ...state,
            phase: 'failed',
            last_result: input.reason
              ? { status: 'refused', request_id: input.request_id, target_id: state.target_id, reason: input.reason }
              : { status: 'failed', request_id: input.request_id, target_id: state.target_id, error: input.error },
          }
        : state
    case 'settled':
      return state.request_id === input.request_id && (state.phase === 'done' || state.phase === 'failed')
        ? { ...state, phase: 'idle', target_id: null, request_id: null }
        : state
    case 'reset':
      return {
        ...state,
        ...initial_character_switch_state(),
        request_seq: state.request_seq,
        notice_seq: state.notice_seq,
      }
    default:
      return state
  }
}

const make_character_switch_input = (set, get) => (input) => {
  const state = get()
  const next = reduce_character_switch(state, input)
  if (next !== state) set(next, true)
  return next
}

/** @returns {import('zustand/vanilla').StoreApi<CharacterSwitchState & { input:(input:any)=>CharacterSwitchState }>} */
export function create_character_switch_store() {
  return createStore((set, get) => ({
    ...initial_character_switch_state(),
    input: make_character_switch_input(set, get),
  }))
}

/** App-lifetime active-character switch atom. Tests use the factory above for isolated state. */
export const character_switch_store = create_character_switch_store()

const normalize_switch_outcome = (outcome) => {
  if (outcome == null || outcome.status === 'done') return { status: 'done' }
  if (outcome.status === 'refused') return { status: 'refused', reason: outcome.reason ?? CHARACTER_SWITCH_IN_PROGRESS }
  if (outcome.status === 'failed') return { status: 'failed', error: outcome.error }
  return { status: 'failed', error: new Error('character switch returned an invalid outcome') }
}

/**
 * Run one reducer-admitted switch effect. Both thrown boundary failures and failure-as-data results re-enter
 * through `failed`; `settled` runs unconditionally afterward, so a failed attempt can never latch the door.
 * @param {ReturnType<typeof create_character_switch_store>} store
 * @param {{ character:any, is_session_current?:()=>boolean, perform_switch:(character:any, request:{request_id:number,is_current:()=>boolean})=>Promise<any>|any }} options
 * @returns {Promise<any>}
 */
export async function run_character_switch(store, { character, is_session_current = () => true, perform_switch }) {
  const before = store.getState()
  const clicked = before.input({ type: 'clicked', character_id: character?.id ?? null })
  if (clicked.request_seq === before.request_seq)
    return { status: 'refused', reason: clicked.notice?.reason ?? CHARACTER_SWITCH_INVALID }

  const { request_id } = clicked
  const owns_request = () => {
    const state = store.getState()
    return state.phase === 'switching' && state.request_id === request_id
  }
  const is_current = () => owns_request() && is_session_current()
  let outcome
  try {
    outcome = normalize_switch_outcome(await perform_switch(character, { request_id, is_current }))
  } catch (error) {
    outcome = { status: 'failed', error }
  }

  // Wallet/session teardown invalidates the request through the reducer's reset input. A late promise is not
  // allowed to publish a terminal result or report stale success into the replacement session.
  if (!is_current()) {
    // Auth can change before the dynamically-loaded wallet teardown runs. Release only this request; a reset or
    // replacement request has a different id and must remain untouched.
    if (owns_request()) {
      store.getState().input({ type: 'failed', request_id, reason: CHARACTER_SWITCH_SESSION_CHANGED })
      store.getState().input({ type: 'settled', request_id })
    }
    return {
      status: 'refused',
      reason: CHARACTER_SWITCH_SESSION_CHANGED,
      request_id,
      target_id: character?.id ?? null,
    }
  }

  store
    .getState()
    .input(
      outcome.status === 'done'
        ? { type: 'succeeded', request_id }
        : { type: 'failed', request_id, error: outcome.error, reason: outcome.reason }
    )
  store.getState().input({ type: 'settled', request_id })
  return { ...outcome, request_id, target_id: character?.id ?? null }
}

/**
 * Persist a lobby target, leave any follow-only view, re-key the resident world/fight sessions, then commit the
 * selected id. The old selection remains active until every fallible rebind leg succeeds, while persistence
 * still completes before the host rebind can read a previous last-played preference.
 * @param {{ id?: string, world_id?: string | null }} character
 * @param {{
 *   select_character: (id: string) => void,
 *   persist_character: (id: string) => Promise<any>,
 *   stop_follow: () => void,
 *   rebind_session: (id: string, world_id: string | null | undefined) => void | Promise<void>,
 *   rebind_fight?: (id: string, request: {is_current:()=>boolean}) => void | Promise<void>,
 *   is_current?: () => boolean,
 *   is_session_current?: () => boolean,
 * }} deps
 * @returns {Promise<string>}
 */
export async function select_character_session(character, deps) {
  const character_id = character?.id
  if (!character_id) throw new Error('cannot select a character without an id')
  const assert_current = () => {
    if (deps.is_current && !deps.is_current()) throw new Error('character switch belongs to a previous session')
  }
  // Keep the old character selected until every fallible rebind leg has completed. The sidebar's active marker
  // is therefore proof of a completed switch, never an optimistic latch that blocks retry after a failure.
  assert_current()
  await deps.persist_character(character_id)
  assert_current()
  // Keep the old scene stable while IndexedDB settles, then flip follow + binding together. This avoids an
  // intermediate remount of the previous character when repairing a tab left in the old follow-mode path.
  deps.stop_follow()
  await deps.rebind_session(character_id, character.world_id)
  assert_current()
  // FIGHT half: the world scene re-keyed above (rebind_session); now rebind the FIGHT so char A's
  // board is torn down and char B's own live fight is resumed — the fight mounts off use_dungeon, not the
  // active character, so without this the switch stays "forced to remain on the first character fight".
  await deps.rebind_fight?.(character_id, { is_current: deps.is_current ?? (() => true) })
  assert_current()
  deps.select_character(character_id)
  return character_id
}

/**
 * The CharacterSwitcher click boundary. Failures are converted into one caller-owned visible toast/report,
 * never an unhandled fire-and-forget rejection or a dead click.
 * @param {{ id?: string, world_id?: string | null }} character
 * @param {Parameters<typeof select_character_session>[1]} deps
 * @param {(error: unknown) => void} on_failure
 * @returns {Promise<boolean>}
 */
export async function handle_character_click(character, deps, on_failure) {
  const outcome = await run_character_switch(character_switch_store, {
    character,
    is_session_current: deps.is_session_current,
    perform_switch: async (target, request) => {
      await select_character_session(target, { ...deps, is_current: request.is_current })
      return { status: 'done' }
    },
  })
  if (outcome.status === 'failed') on_failure(outcome.error)
  if (outcome.status === 'refused') on_failure(new Error(`character switch refused: ${outcome.reason}`))
  return outcome.status === 'done'
}
