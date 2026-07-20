// SPECTATE-UNTIL-JOINED — the session gate CORE: the player never holds the controller until their character
// has joined a world; until then only the pre-load spectate effect renders — the world is truly entered
// only once the character has joined.
//
// D770a W1 (fold-completion): ONE atom behind ONE `input(msg, now)` door. The pending stale-poll guard and
// the join-failsafe TIMER — formerly a module-scope "runtime" beside the frontend store, the last two
// impurities of the 07-17 refactor — are atom state now: the guard as `pending_manual_target`, the timer as
// the `failsafe` EFFECT REQUEST (`{character_id, deadline}`) an adapter executes (it owns the real timer and
// dispatches `join_timeout` back through the door — time as input, MODULE LAW). Discarded stale polls land
// as the `stale_poll` DATA row; the adapter's only job is to log it.
//
// Binding semantics are THREE-VALUED and that is load-bearing:
//   undefined — UNKNOWN (no doc read yet). The host proceeds down the session path and decides POST-RESOLVE
//               (the resolve-time fetch) — so an already-bound character enters RESIDENT directly, never
//               through a spectate flash — the bound-path no-regression floor.
//   null      — CONFIRMED UNBOUND. Spectate backdrop (D183, reused verbatim) — no controller, no physics,
//               no avatar. The auto-join runs against this backdrop; a join FAILURE leaves the binding
//               null → spectate stays (never a controller in an unjoined world).
//   '0x…'     — BOUND. The true resident session (controller + physics + avatar).
//
// WRITERS (all converge on the one door): the host's resolve-time fetch, the join success (world_join
// publishes optimistically the moment the tx lands), and DiscoveryPrompts' 10s char-doc poll (heals external
// changes). The roster rows are NOT a binding source: the chain-direct load_roster hydrate drops `world_id`
// on idle rows (only the RPC doc carries the truth).
//
// STALE-POLL GUARD: the poll is unconditional and can race a fresh travel's indexer catch-up window —
// `binding_published`'s `source` ('manual' | 'poll') gates that: a 'poll' write is discarded while it
// disagrees with the last trusted ('manual') write for that character, and confirms/clears the guard once
// it agrees.

import { createStore } from 'zustand/vanilla'

export const SCENE_SPECTATE = 'spectate'
export const SCENE_SESSION = 'session'

// Failsafe ceiling: a join that NEVER resolves (tx wedged, wallet prompt closed, poller unmounted) must not
// pin the loading veil forever — release after a generous window so the binding's own truth (spectate if
// still unbound) surfaces honestly (no-silent-hang law). The happy/sad paths end the hold far sooner.
export const JOIN_FAILSAFE_MS = 30000

/** @typedef {{ type: 'binding_published', character_id: string|null, world: string|null, source: 'manual'|'poll' }} BindingPublishedInput */
/** @typedef {{ type: 'join_started', character_id: string|null }} JoinStartedInput */
/** @typedef {{ type: 'join_ended' }} JoinEndedInput */
/** @typedef {{ type: 'join_failed'|'join_timeout', character_id: string|null }} JoinTerminalInput */
/** @typedef {{ type: 'character_selected', character_id: string, world_id: string|null }} CharacterSelectedInput */
/** @typedef {{ type: 'binding_reset' }} BindingResetInput */
/** @typedef {BindingPublishedInput|JoinStartedInput|JoinEndedInput|JoinTerminalInput|CharacterSelectedInput|BindingResetInput} SessionGateInput */
/** @typedef {{ character_id: string|null, deadline: number }} JoinFailsafeRequest */
/** @typedef {{ character_id: string|null }} JoinRequest */
/** @typedef {{ seq: number, character_id: string, target: string|null }} StalePollRow */
/**
 * @typedef {{
 *   character_id: string|null,
 *   world: string|null|undefined,
 *   joining: boolean,
 *   pending_manual_target: Map<string, string|null>,
 *   failsafe: JoinFailsafeRequest|null,
 *   join_request: JoinRequest|null,
 *   stale_poll: StalePollRow|null,
 *   input: (input: SessionGateInput, now?: number) => void
 * }} SessionGateState
 */

/**
 * The binding_published leg (a composed fold): stale-poll reconciliation + the pending-confirmation guard.
 * @param {SessionGateState} state
 * @param {BindingPublishedInput} input
 * @returns {SessionGateState}
 */
function fold_binding_published(state, input) {
  const id = input.character_id ?? null
  const world = input.world ?? null
  // FLOOR (character↔world binding, v33): a POLL only ever REFINES the ACTIVE character's binding; it
  // never SWITCHES which character is active. A stale in-flight doc read for a previously-active character
  // (e.g. one that resolves right after a switch) must not rebind the session BACKWARDS — switches are always
  // the 'manual' write (character_selected / join). Bootstrap is untouched: with no active char yet
  // (character_id null) a poll may still establish the first binding.
  if (id && input.source === 'poll' && state.character_id != null && id !== state.character_id)
    return {
      ...state,
      stale_poll: { seq: (state.stale_poll?.seq ?? 0) + 1, character_id: id, target: state.world ?? null },
    }
  let pending = state.pending_manual_target
  if (id && input.source === 'poll' && pending.has(id)) {
    const target = pending.get(id) ?? null
    // Disagreeing poll during the indexer catch-up window: DISCARD, surface the stale row as data.
    if (world !== target)
      return { ...state, stale_poll: { seq: (state.stale_poll?.seq ?? 0) + 1, character_id: id, target } }
    // Agreeing poll CONFIRMS and clears the guard — later polls resume their ghost-world-healer role.
    pending = new Map(pending)
    pending.delete(id)
  }
  // A trusted manual write arms (or re-targets) the pending confirmation guard for this character.
  if (id && input.source === 'manual' && (!pending.has(id) || pending.get(id) !== world)) {
    pending = new Map(pending)
    pending.set(id, world)
  }
  if (state.character_id === id && state.world === world && pending === state.pending_manual_target) return state
  return { ...state, character_id: id, world, pending_manual_target: pending }
}

/**
 * THE pure session-gate fold — every async result is a typed input; stale-poll reconciliation, the joining
 * hold, and late/duplicate join-terminal rejection all happen here. The pending map is cloned on mutation so
 * the fold never mutates its arguments; an input that changes nothing returns the SAME state reference (the
 * door skips the commit). `now` is the only clock — the failsafe deadline is derived from it, never read.
 * @param {SessionGateState} state
 * @param {SessionGateInput} input
 * @param {number} now
 * @returns {SessionGateState}
 */
export function reduce_session_gate(state, input, now) {
  switch (input.type) {
    case 'binding_published':
      return fold_binding_published(state, input)
    case 'join_started': {
      // Arming is part of the fold: the failsafe EFFECT REQUEST carries an absolute deadline derived from
      // `now` — a repeat join_started re-arms (fresh request identity), exactly the old timer semantics. The
      // join_request EFFECT REQUEST is the create RECEIPT driving the actual join: the post-create
      // world join fires off the receipt, one pipeline — never a DiscoveryPrompts poll noticing `unjoined`.
      // A fresh object each time so a repeat begin_join re-fires the edge (like the failsafe).
      const character_id = input.character_id ?? null
      return {
        ...state,
        character_id,
        joining: true,
        failsafe: { character_id, deadline: now + JOIN_FAILSAFE_MS },
        join_request: { character_id },
      }
    }
    case 'join_ended':
      return state.joining || state.failsafe || state.join_request
        ? { ...state, joining: false, failsafe: null, join_request: null }
        : state
    case 'join_failed':
    case 'join_timeout': {
      // Late or duplicate terminal delivery for a different (or already-released) join changes nothing —
      // and deliberately leaves a CURRENT join's failsafe armed.
      const character_id = input.character_id ?? null
      return state.joining && state.character_id === character_id
        ? { ...state, joining: false, failsafe: null, join_request: null }
        : state
    }
    case 'character_selected':
      // A roster selection re-keys the session: release any joining hold, then publish the card's
      // binding truth as a trusted manual write — two composed folds inside the one door.
      return reduce_session_gate(
        reduce_session_gate(state, { type: 'join_ended' }, now),
        {
          type: 'binding_published',
          character_id: input.character_id,
          world: input.world_id ?? null,
          source: 'manual',
        },
        now
      )
    case 'binding_reset': {
      const blank =
        state.character_id === null &&
        state.world === undefined &&
        !state.joining &&
        state.pending_manual_target.size === 0 &&
        state.failsafe === null &&
        state.join_request === null &&
        state.stale_poll === null
      return blank
        ? state
        : {
            ...state,
            character_id: null,
            world: undefined,
            joining: false,
            pending_manual_target: new Map(),
            failsafe: null,
            join_request: null,
            stale_poll: null,
          }
    }
    default:
      return state
  }
}

/** The ONE store write door: every source, including timers/promises, dispatches a typed input here. */
const make_session_gate_input =
  (set, get) =>
  (input, now = Date.now()) => {
    const state = get()
    const next = reduce_session_gate(state, input, now)
    if (next !== state) set(next, true)
  }

/**
 * Create ONE session-gate atom (zustand/vanilla — the React binding is the adapter's). `getState().input`
 * is the door; everything else is committed fold output.
 * @returns {import('zustand/vanilla').StoreApi<SessionGateState>}
 */
export function create_session_gate_store() {
  return createStore((set, get) => ({
    character_id: null,
    world: undefined,
    // ONE-BOOT create→play: a fresh
    // create drives create → JOIN → spawn as ONE loading hold, not the old decorative→spectate→resident boot
    // storm. While `joining`, the host holds ONE loading veil and NEVER mounts the spectate backdrop; the
    // resident scene boots ONCE when the join lands (world resolved).
    joining: false,
    pending_manual_target: new Map(),
    failsafe: null,
    join_request: null,
    stale_poll: null,
    input: make_session_gate_input(set, get),
  }))
}

/**
 * Effect edge (exported subscription — the package never performs effects): watch the failsafe EFFECT
 * REQUEST. On every request change the previous timer is cleared; a live request re-arms. The adapter's
 * `arm` owns the real timer and dispatches `join_timeout` back through the door.
 * @param {import('zustand/vanilla').StoreApi<SessionGateState>} store
 * @param {{ arm: (request: JoinFailsafeRequest) => void, clear: () => void }} edges
 * @returns {() => void} unsubscribe
 */
export function subscribe_join_failsafe(store, { arm, clear }) {
  return store.subscribe((state, prev) => {
    if (state.failsafe === prev.failsafe) return
    clear()
    if (state.failsafe) arm(state.failsafe)
  })
}

/**
 * Effect edge: each DISCARDED stale poll lands exactly once (row identity — seq-stamped by the fold).
 * @param {import('zustand/vanilla').StoreApi<SessionGateState>} store
 * @param {(row: StalePollRow) => void} on_row
 * @returns {() => void} unsubscribe
 */
export function subscribe_stale_poll(store, on_row) {
  return store.subscribe((state, prev) => {
    if (state.stale_poll && state.stale_poll !== prev.stale_poll) on_row(state.stale_poll)
  })
}

/**
 * Effect edge: the create→play JOIN REQUEST. On each NEW request (a fresh begin_join / create
 * receipt) the adapter fires the actual world join (auto_join_world) at the edge — the package performs
 * nothing. A null→request or a re-armed request identity both fire; the request clearing to null never does.
 * @param {import('zustand/vanilla').StoreApi<SessionGateState>} store
 * @param {(request: JoinRequest) => void} fire
 * @returns {() => void} unsubscribe
 */
export function subscribe_join_request(store, fire) {
  return store.subscribe((state, prev) => {
    if (state.join_request && state.join_request !== prev.join_request) fire(state.join_request)
  })
}

/**
 * THE scene-mode decision (pure). `world` is the three-valued binding above for the SELECTED character.
 * UNKNOWN stays on the session path (the host decides post-resolve — no spectate flash for bound
 * characters); CONFIRMED-UNBOUND forces spectate — UNLESS a create→play join is
 * in flight (`joining`), which holds the session path so the spectate sky-view detour NEVER mounts mid-join.
 * @param {{ on_world_tab: boolean, authenticated: boolean, world: string|null|undefined, joining?: boolean }} args
 * @returns {'spectate' | 'session'}
 */
export function scene_target({ on_world_tab, authenticated, world, joining = false }) {
  if (!on_world_tab || !authenticated) return SCENE_SPECTATE
  if (joining && typeof world !== 'string') return SCENE_SESSION
  if (world === null) return SCENE_SPECTATE
  return SCENE_SESSION
}

/**
 * THE full scene plan (pure): the coarse mode PLUS the mount identity KEY and the concrete ACTION the host
 * executes. The KEY encodes the WHOLE mount identity (mode + character), so a decorative lobby (no
 * character) and a resident lobby (character X) are DIFFERENT keys — the host re-boots into the character
 * reactively, WITHOUT the old spectate→resident churn (that key change was the extra boot).
 *   • 'hidden'   — the world is off-screen (a meta tab); do nothing.
 *   • 'await-auth' — auth is still resolving a stored session (is_loading, not yet authenticated): HOLD, no
 *                  mount. Booting the spectate backdrop here would dispose + re-boot it the instant the
 *                  wallet reconnects — a double engine boot (loads, freezes, loads something else, shows
 *                  up, freezes again).
 *   • 'spectate' — the logged-out landing backdrop OR a confirmed-unbound character (S-57), NOT mid-join.
 *   • 'hold'     — a create→play join is in flight and the world is not yet resolved: ONE loading veil, no
 *                  mount.
 *   • 'resident' — the world is KNOWN (bound): mount the resident session for `character_id`, world trusted
 *                  (no lagging /v1 re-read — the binding store already carries chain-truth from the join).
 *                  The KEY includes the bound world id (lobby only) so a travel re-boots the scene into the
 *                  new world.
 *   • 'session'  — UNKNOWN world (no read yet): the host resolves the character + fetches the binding, then
 *                  mounts resident (bound) or the spectate backdrop (confirmed-unbound) post-resolve.
 * @param {{ show_world: boolean, authenticated: boolean, on_world_tab: boolean, joining?: boolean,
 *           world: string|null|undefined, character_id?: string|null, following?: boolean,
 *           auth_loading?: boolean }} args
 * @returns {{ action: 'hidden'|'await-auth'|'spectate'|'hold'|'resident'|'session', key: string|null }}
 */
export function plan_scene({
  show_world,
  authenticated,
  on_world_tab,
  joining = false,
  world,
  character_id = null,
  following = false,
  auth_loading = false,
}) {
  if (!show_world) return { action: 'hidden', key: null }
  // BOOT ONCE — never the double engine boot (loads, freezes, loads something else, shows up, freezes again):
  // `address` is null at first render (Enoki reconnect is async + slower than the game-bundle import), so an
  // authenticating returning player would first mount the SPECTATE decorative world, then dispose + re-boot
  // the resident world the instant the wallet reconnects — two full engine boots. While auth is still
  // deciding a stored session (is_loading, no address yet), HOLD instead of booting that throwaway backdrop.
  // Auth always resolves: a reconnect → resident/session in ONE boot; a confirmed logged-out visitor
  // (is_loading=false, no address) still gets the spectate landing below. On the login-from-landing
  // handshake this holds the EXISTING spectate scene (no dispose), so it never blanks.
  if (!authenticated && auth_loading) return { action: 'await-auth', key: null }
  // v30 P1 — the confirmed logged-out landing mounts the LIVE WORLD backdrop unconditionally —
  // the pre-auth world preview is its own legal input path (public read data). The d6d32bc "LOGIN CPU
  // GATE" (static page until the watch-live-world opt-in) is repealed; that gesture survives only as
  // the INTERACTION gate: a display-only canvas until spectate is chosen or login.
  if (scene_target({ on_world_tab, authenticated, world, joining }) === SCENE_SPECTATE)
    return { action: 'spectate', key: 'spectate' }
  // Session mode. A create→play join with the world not yet resolved holds ONE loading veil (never spectate).
  if (joining && typeof world !== 'string') return { action: 'hold', key: 'joining' }
  // TRAVEL REMOUNT (2026-07-13): the RESIDENT lobby key carries the bound WORLD id, so a travel A→B changes
  // the mount identity → the host disposes world A's scene and boots world B (its biome recipe + checkpoint
  // spawn). Without it, a travel published a new `bound_world` but left the key `lobby:<char>` unchanged, so
  // the host's identity guard early-returned and the canvas stayed on world A — a toast fired but
  // nothing else happened. Follow mode (spectating another player) has no travel action and the host resolves
  // no world there, so its key stays character-only — a world segment would only thrash. 'session' (world
  // UNKNOWN) also stays world-less; the host resolves + publishes the world, flipping this to the
  // world-keyed resident key in one step.
  const world_seg = !following && typeof world === 'string' ? `:${world}` : ''
  const key = `${following ? 'follow' : 'lobby'}:${character_id ?? 'none'}${world_seg}`
  return { action: typeof world === 'string' ? 'resident' : 'session', key }
}

/** Post-resolution mount mode: a resolved character with no bound world mounts the spectate backdrop. */
export function resolved_mode(world) {
  return world ? SCENE_SESSION : SCENE_SPECTATE
}
