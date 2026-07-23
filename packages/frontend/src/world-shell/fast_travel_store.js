// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FAST-TRAVEL STORE — the ONE pure reducer that owns the dragon-ride state machine (plan §3.1; model:
// packages/world/src/presence.js). `reduce(state, input) → state`; effects live at the edges (resolve/join =
// fast_travel_target.js + the wiring, flight = fast_travel_pilot.js). No async callback ever `set()`s this store
// — every mutation is an INPUT folded through the reducer (FP constitution; CodeQL laundered-write gate).
//
// PHASES: idle → resolving → [joining → awaiting_boot →] flying → landing → idle.
//   • same world      → resolving → flying (no tx, no gas)
//   • foreign world    → resolving → joining (join tx) → awaiting_boot (session swap) → flying
//   • gated foreign     → resolving → idle + refusal (level gate OR non-catalog/dungeon world → realm-unreachable)
//
// THE ROUTING LAW lives in fold_resolved (plan §2-① / invariant 2): the target's WORLD comes ONLY from its /v1
// doc (carried on the `resolved` input); a live p2p position never routes worlds — the p2p room is global across
// all worlds, so overlapping coords in a DIFFERENT world would fly us to a phantom without this rule.

import { createStore } from 'zustand/vanilla'

const REALM_UNREACHABLE = 'fast_travel.realm_unreachable'

/** @typedef {'idle'|'resolving'|'joining'|'awaiting_boot'|'flying'|'landing'} FtPhase */
/** @typedef {{ character_id:string|null, address:string|null, name:string, world_id:string|null, x:number, z:number, live:boolean }} FtTarget */
/** @typedef {{ phase: FtPhase, target: FtTarget|null, refusal: string|null, refusal_seq:number }} FtState */

/** @returns {FtState} */
export function initial_ft_state() {
  return { phase: 'idle', target: null, refusal: null, refusal_seq: 0 }
}

const cleared = (state) => ({
  ...state,
  phase: 'idle',
  target: null,
  refusal: null,
  refusal_seq: state.refusal_seq ?? 0,
})
const with_refusal = (state, reason) => ({
  ...cleared(state),
  refusal: reason ?? REALM_UNREACHABLE,
  refusal_seq: (state.refusal_seq ?? 0) + 1,
})

const begin_target = (input) => {
  const x = Number(input.x)
  const z = Number(input.z)
  const has_position = Number.isFinite(x) && Number.isFinite(z)
  return {
    character_id: input.character_id ?? null,
    address: input.address ?? null,
    name: input.name ?? '',
    world_id: typeof input.world_id === 'string' ? input.world_id : null,
    x: has_position ? x : 0,
    z: has_position ? z : 0,
    live: has_position && !!input.live,
  }
}

/** THE ROUTING LAW — the target's /v1 world decides join-or-fly-or-refuse; a live p2p position never routes. */
function fold_resolved(state, input) {
  if (state.phase !== 'resolving') return state // a late resolve after cancel/reset is ignored
  const { world_id, x, z, live, my_world_id, my_level, required_level, catalog_has_world, character_id } = input
  const target = {
    ...(state.target ?? {}),
    ...(character_id ? { character_id } : {}), // an address-only begin learns its id from the /v1 resolve
    world_id,
    x: Number(x),
    z: Number(z),
    live: !!live,
  }
  // Same /v1 world → fly now (no tx). A FOREIGN world never flies here, even with a live p2p coord present.
  if (world_id && my_world_id && world_id === my_world_id) return { ...state, phase: 'flying', target, refusal: null }
  // Foreign world: the realm gates. A non-catalog world (dungeon/unknown, §4-B3) or a level lock (zones.move
  // ELevelTooLow) is the "realm you can't reach" refusal — back to idle so the edge only shows the toast.
  if (!catalog_has_world) return with_refusal(state, REALM_UNREACHABLE)
  if (required_level != null && my_level != null && my_level < required_level)
    return with_refusal(state, REALM_UNREACHABLE)
  return { ...state, phase: 'joining', target, refusal: null } // gated open — join the world, boot, then fly
}

/**
 * THE pure fast-travel fold. @param {FtState} state @param {any} input @returns {FtState}
 */
export function reduce_fast_travel(state, input) {
  switch (input.type) {
    case 'begin': {
      if (state.phase !== 'idle') return state // re-begin while active is refused — no clobber (plan §4-B4)
      if (input.refusal) return with_refusal(state, input.refusal) // friend preflight: same guarded request door
      if (!input.character_id && !input.address) return state // need something to resolve (character id OR owner)
      return {
        ...state,
        phase: 'resolving',
        refusal: null,
        target: begin_target(input),
      }
    }
    case 'resolved':
      return fold_resolved(state, input)
    case 'refused':
      return state.phase === 'resolving' || state.phase === 'joining' ? with_refusal(state, input.reason) : state
    case 'world_joined':
      return state.phase === 'joining' ? { ...state, phase: 'awaiting_boot' } : state
    case 'boot_ready':
      return state.phase === 'awaiting_boot' && input.world_id === state.target?.world_id
        ? { ...state, phase: 'flying' }
        : state
    case 'retarget': {
      if (state.phase !== 'flying' || !state.target) return state // no pre-flight p2p drive (routing law)
      return { ...state, target: { ...state.target, x: Number(input.x), z: Number(input.z), live: true } }
    }
    case 'target_lost':
      if (state.phase !== 'flying' || !state.target) return state
      return { ...state, target: { ...state.target, live: false } } // freeze last-known; edge shows the info toast
    case 'arrived':
      return state.phase === 'flying' ? { ...state, phase: 'landing' } : state
    case 'cancel':
      return state.phase === 'idle' ? state : cleared(state)
    case 'reset':
      return cleared(state)
    default:
      return state
  }
}

// ── selectors (renderer/edge-complete) ───────────────────────────────────────────────────────────────────────
/** @param {FtState} state */
export const ft_active = (state) => state.phase !== 'idle'

/** The live flight target for the pilot, or null when not flying/landing. @param {FtState} state */
export const ft_flight_target = (state) =>
  state.phase === 'flying' || state.phase === 'landing'
    ? {
        x: state.target?.x ?? 0,
        z: state.target?.z ?? 0,
        live: !!state.target?.live,
        landing: state.phase === 'landing',
      }
    : null

// ── keyed by TRAVELER character id — the app drives a non-active character's dragon exactly like the active one
// (owner ruling 2026-07-23). Each traveler folds through the SAME pure reduce_fast_travel; a begin for one
// traveler never touches another's flight, so the active player and a catching-up follower each own a slot. A
// parallel store instance was rejected — one keyed home, the pure reducer parameterized by traveler. ────────────
/**
 * Route one input to its traveler's flight slice. The input's `traveler_id` names WHO is flying (the active
 * player, or a follower the group loop is steering) — distinct from `target.character_id`, WHO they fly to.
 * @param {Record<string, FtState>} travelers @param {any} input @returns {Record<string, FtState>}
 */
export function reduce_travelers(travelers, input) {
  const cid = input?.traveler_id
  if (!cid) return travelers // the door always stamps a traveler_id; a raw input is inert
  const prev = travelers[cid] ?? initial_ft_state()
  const next = reduce_fast_travel(prev, input)
  return next === prev ? travelers : { ...travelers, [cid]: next }
}

/** One traveler's flight slice (idle when that character has no flight). @param {{travelers?:Record<string,FtState>}} state */
export const ft_for = (state, cid) => (cid && state.travelers?.[cid]) || initial_ft_state()

// ── the singleton store + its ONE input door (no external set) ─────────────────────────────────────────────────
const make_input = (set, get) => (input) => {
  const travelers = reduce_travelers(get().travelers, input)
  if (travelers !== get().travelers) set({ travelers }) // merge (never replace — the input door survives)
}

/** @returns {import('zustand/vanilla').StoreApi<{ travelers:Record<string,FtState>, input:(i:any)=>void }>} */
export function create_fast_travel_store() {
  return createStore((set, get) => ({ travelers: {}, input: make_input(set, get) }))
}

/** App-lifetime singleton — every traveler (active player + steered followers) keyed by character id. */
export const fast_travel_store = create_fast_travel_store()

/** Dispatch an input into the singleton (the menu, the pilot, and the effect wiring all pull this one lever). */
export function ft_dispatch(input) {
  fast_travel_store.getState().input(input)
}
