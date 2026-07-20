// Toast store — two distinct, complementary channels, both ephemeral UI (deliberately NOT engine
// game-state). Framework-agnostic (an EventEmitter + snapshots); React binds via useSyncExternalStore.
//
//   1. STATUS toast (single mutable slot) — the tx/login lifecycle channel: one in-flight
//      pending→success/error toast at a time (show_toast/update_toast/resolve_toast/...).
//   2. EVENT toast STACK (append-only queue) — fire-and-forget game notifications (loot, a player
//      joined, a cast result). Stacked info/success/error toasts per the approved demo. Each
//      auto-dismisses; the queue is capped so it never grows unbounded.

import { EventEmitter } from 'events'

const emitter = new EventEmitter()
let seq = 0
/** @typedef {{ id: number, state: 'pending' | 'success' | 'error', title: string, message: string }} ToastState */
/** @type {ToastState | null} */
let current = null

const emit = () => emitter.emit('change')

export const toast_store = {
  /** @returns {ToastState | null} */
  get: () => current,
  /** @param {() => void} cb @returns {() => void} */
  subscribe: (cb) => {
    emitter.on('change', cb)
    return () => emitter.off('change', cb)
  },
}

// ── event toast stack ──────────────────────────────────────────────────────────────────────────
const EVENT_CAP = 3 // visible at once; the oldest is dropped when a 4th arrives
const EVENT_TTL = 3400 // ms before an event toast auto-dismisses
/** @typedef {{ id: number, state: 'info' | 'success' | 'error' | 'progress', title: string, message: string, progress?: number }} EventToast */
/** @type {EventToast[]} */
let events = []

const emit_events = () => emitter.emit('events-change')

export const event_toast_store = {
  /** @returns {EventToast[]} a referentially-stable array between changes */
  get: () => events,
  /** @param {() => void} cb @returns {() => void} */
  subscribe: (cb) => {
    emitter.on('events-change', cb)
    return () => emitter.off('events-change', cb)
  },
}

/**
 * Push a fire-and-forget event toast onto the stack (auto-dismisses). Modules call this on
 * `packet/*` to surface a game event; React renders the stack from `event_toast_store`.
 * @param {{ state?: EventToast['state'], title: string, message?: string }} t @returns {number}
 */
export function push_event_toast({ state = 'info', title, message = '' }) {
  const id = ++seq
  events = [...events, { id, state, title, message }]
  if (events.length > EVENT_CAP) events = events.slice(events.length - EVENT_CAP)
  emit_events()
  setTimeout(() => dismiss_event_toast(id), EVENT_TTL)
  return id
}

/** @param {number} id remove this event toast (a no-op if already gone). */
export function dismiss_event_toast(id) {
  const next = events.filter((t) => t.id !== id)
  if (next.length === events.length) return
  events = next
  emit_events()
}

// ── progress event toast (S-18 discovery: the "Searching Zone…" RP beat) ───────────────────────
// A STICKY event-stack entry with a gold progress bar (state 'progress', `progress` 0..1): it rides the
// same top-right `.gw-toasts` stack (no new positions) but never auto-dismisses — the flow
// drives the bar, then RESOLVES it into a normal success/error toast (which then TTL-dismisses).

/**
 * Push a sticky progress toast. Returns its id — feed to update_progress_toast / resolve_progress_toast.
 * @param {{ title: string, message?: string }} t @returns {number}
 */
export function push_progress_toast({ title, message = '' }) {
  const id = ++seq
  events = [...events, { id, state: 'progress', title, message, progress: 0 }]
  if (events.length > EVENT_CAP) events = events.slice(events.length - EVENT_CAP)
  emit_events()
  return id
}

/** Drive the bar (clamped 0..1). No-op once resolved/dismissed. @param {number} id @param {number} progress */
export function update_progress_toast(id, progress) {
  let hit = false
  events = events.map((t) => {
    if (t.id !== id || t.state !== 'progress') return t
    hit = true
    return { ...t, progress: Math.max(0, Math.min(1, progress)) }
  })
  if (hit) emit_events()
}

/**
 * Resolve the progress toast into a terminal state (bar snaps full on success) + normal TTL dismiss.
 * @param {number} id @param {{ state?: 'success' | 'error', title: string, message?: string }} t
 */
export function resolve_progress_toast(id, { state = 'success', title, message = '' }) {
  events = events.map((t) =>
    t.id === id ? { ...t, state, title, message, progress: state === 'success' ? 1 : t.progress } : t
  )
  emit_events()
  setTimeout(() => dismiss_event_toast(id), EVENT_TTL)
}

// ── zone-reveal banner (SEARCH-ZONE JUICE) ──────────────────────────────────────────────────────
// A single-slot cinematic channel for the center-screen zone-reveal banner — the reward beat when a
// search resolves (a reward moment calling for a lot of feedback: sound + popup effect). Distinct from the
// top-right toast stack (that's the tx lifecycle); this is a one-shot hero moment. The seam fires
// reveal_zone() with the ZoneSearched counts; ZoneRevealBanner renders the current slot; the store
// self-clears after REVEAL_TTL (the banner's flash animation runs its full life, then unmounts clean).
const REVEAL_TTL = 2500
/** @typedef {{ id:number, zx:number, zy:number, mob_groups:number, resource_nodes:number }} ZoneReveal */
/** @type {ZoneReveal | null} */
let reveal = null
const emit_reveal = () => emitter.emit('reveal-change')

export const zone_reveal_store = {
  /** @returns {ZoneReveal | null} a referentially-stable snapshot between changes (useSyncExternalStore-safe) */
  get: () => reveal,
  /** @param {() => void} cb @returns {() => void} */
  subscribe: (cb) => {
    emitter.on('reveal-change', cb)
    return () => emitter.off('reveal-change', cb)
  },
}

/**
 * Fire the center-screen zone-reveal banner with the search findings. Auto-clears after REVEAL_TTL (only
 * if a newer reveal hasn't replaced it). @param {{ zx:number, zy:number, mob_groups?:number,
 * resource_nodes?:number }} r @returns {number} the reveal id
 */
export function reveal_zone({ zx, zy, mob_groups = 0, resource_nodes = 0 }) {
  const id = ++seq
  reveal = { id, zx, zy, mob_groups, resource_nodes }
  emit_reveal()
  setTimeout(() => {
    if (reveal?.id !== id) return // a newer reveal already took the slot — leave it
    reveal = null
    emit_reveal()
  }, REVEAL_TTL)
  return id
}

// ── search-press flash (SEARCH-PRESS JUICE) ─────────────────────────────────────────────────────
// A one-shot full-viewport border-flash trigger fired the INSTANT [F] search is pressed
// (DiscoveryPrompts.jsx's on_trigger — optimistic, before the kiosk resolve/tx ever await; the
// reward-beats law: "fires ON PRESS"). Distinct from zone_reveal_store above (the ON-SUCCESS center
// banner): this is the ON-PRESS acknowledgement beat (a subtle on-screen effect: flashing borders).
// A bare incrementing id — ZoneSearchFlash keys its DOM node off it so React mounts
// a FRESH node (replaying the one-shot CSS animation) on every press, even back-to-back.
let flash_id = 0
const emit_flash = () => emitter.emit('flash-change')

export const search_flash_store = {
  /** @returns {number} the current flash id (0 = never fired this session) */
  get: () => flash_id,
  /** @param {() => void} cb @returns {() => void} */
  subscribe: (cb) => {
    emitter.on('flash-change', cb)
    return () => emitter.off('flash-change', cb)
  },
}

/** Fire the one-shot border-flash pulse. @returns {void} */
export function trigger_search_flash() {
  flash_id += 1
  emit_flash()
}

// ── fight impact flash (FIGHT-FEEL screen grade) ─────────────────────────────────────────────────
// A one-shot element-coloured screen-edge vignette pulse fired by the adapter's impact package
// (voxel_fight_adapter.impact_package) the instant a cast lands — plus an optional full-screen GRADE moment:
// 'warm' (a heal glows), 'desaturate' (a death blow drains colour), 'element-wash' (a big AoE washes the edges
// in the element colour). Pure CSS pulses on the .fight-impact-flash vignette layer — NO post-process pass
// (the engine ban stands). FightImpactFlash keys its DOM node off `n` so a FRESH node replays the one-shot CSS
// animation every hit; the colour/intensity ride CSS vars, the grade a data-attr. Subtle + ~220 ms + frequency-
// capped so there is zero epilepsy risk. getSnapshot returns a STABLE object ref between fires
// (replaced only on trigger) so useSyncExternalStore never loops.
let fight_flash = /** @type {{ n: number, color: string, intensity: number, grade: string | null }} */ ({
  n: 0, color: '#ffffff', intensity: 0.4, grade: null,
})
let last_fight_flash_ts = 0
const FIGHT_FLASH_MIN_GAP_MS = 90 // frequency cap — coalesce same-frame AoE multi-hits into one pulse
const emit_fight_flash = () => emitter.emit('fight-flash-change')

export const fight_flash_store = {
  /** @returns {typeof fight_flash} */
  get: () => fight_flash,
  /** @param {() => void} cb @returns {() => void} */
  subscribe: (cb) => {
    emitter.on('fight-flash-change', cb)
    return () => emitter.off('fight-flash-change', cb)
  },
}

/** Fire one impact flash. `intensity` is clamped to a subtle ceiling; back-to-back fires inside the frequency
 *  cap are dropped (no strobing). @param {{ color?: string, intensity?: number, grade?: string | null }} [o] */
export function trigger_fight_flash({ color = '#ffffff', intensity = 0.4, grade = null } = {}) {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (now - last_fight_flash_ts < FIGHT_FLASH_MIN_GAP_MS) return
  last_fight_flash_ts = now
  fight_flash = { n: fight_flash.n + 1, color, intensity: Math.max(0, Math.min(0.55, intensity)), grade }
  emit_fight_flash()
}

/**
 * Show (replace) the toast. Returns an id; later update/dismiss calls are no-ops if a newer toast
 * has since replaced this one (so overlapping flows can't fight over the single slot).
 * @param {{ state?: ToastState['state'], title?: string, message?: string }} t
 * @returns {number}
 */
export function show_toast({ state = 'pending', title = '', message = '' }) {
  const id = ++seq
  current = { id, state, title, message }
  emit()
  return id
}

/** @param {number} id @param {Partial<ToastState>} patch */
export function update_toast(id, patch) {
  if (current?.id !== id) return
  current = { ...current, ...patch }
  emit()
}

/** @param {number} [id] dismiss only if this id is still current (omit to force-clear) */
export function dismiss_toast(id) {
  if (id != null && current?.id !== id) return
  current = null
  emit()
}

/** Show a success toast that auto-dismisses. @param {number} id @param {string} message */
export function resolve_toast(id, message) {
  update_toast(id, { state: 'success', message })
  setTimeout(() => dismiss_toast(id), 2200)
}

/** Show an error toast that auto-dismisses (slower). @param {number} id @param {string} message */
export function reject_toast(id, message) {
  update_toast(id, { state: 'error', message })
  setTimeout(() => dismiss_toast(id), 4000)
}
