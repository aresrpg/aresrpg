// FIGHT OPENNESS — the HUD toggle ("a toggle on the hud to start fights as group only or
// as public"). A world fight you START carries an on-chain openness (fight.move `public_fight` + `party_id`).
// D770a W2: the VALUE lives in the spawns core atom (`openness` — the claim_tx effect request carries it), and
// localStorage hydration is an INPUT (MODULE LAW): this adapter owns exactly the storage edge + the React
// binding. Persisted (same idiom as the HP display + render-quality prefs) so the choice survives a
// reload. Default PUBLIC — the friendliest, most-discoverable default; a solo player with no party who picked
// GROUP would otherwise create un-joinable fights unknowingly.

import { OPENNESS_PUBLIC, OPENNESS_GROUP } from '@aresrpg/world'

import { spawns_store, spawns_input, use_spawns } from './spawns_adapter.js'

const STORAGE_KEY = 'ares.fight_openness'

// HYDRATION AS INPUT: the persisted choice enters through the core's door once at module load (SSR/denied-
// storage safe — the core default already is PUBLIC).
try {
  const stored = globalThis.localStorage?.getItem(STORAGE_KEY)
  if (stored === OPENNESS_GROUP) spawns_input({ type: 'openness_set', value: OPENNESS_GROUP })
} catch {
  /* denied storage — the core default holds */
}

/** Set the openness of the NEXT started fight ('public' | 'group') — dispatches + persists. */
export function set_openness(next) {
  const value = next === OPENNESS_GROUP ? OPENNESS_GROUP : OPENNESS_PUBLIC
  spawns_input({ type: 'openness_set', value })
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, value)
  } catch {
    /* denied storage — the in-memory choice still holds for this session */
  }
}

/** Flip public ↔ group. */
export function toggle_openness() {
  set_openness(spawns_store.getState().openness === OPENNESS_PUBLIC ? OPENNESS_GROUP : OPENNESS_PUBLIC)
}

/** React selector over the live choice (the FightOpennessToggle renders this). */
export function use_openness() {
  return use_spawns((s) => s.openness)
}

/** Is the NEXT started fight public? (imperative read for tx edges). */
export function is_openness_public() {
  return spawns_store.getState().openness === OPENNESS_PUBLIC
}
