// Fixtures for js/aresrpg/dual-home-store-copy (CODE_LAW L-P4, ONE reducer per domain).
// RED cases are violations the query MUST flag; GREEN cases are sanctioned shapes it must NOT.
import { create } from 'zustand'

// Store A — fight truth: the ONE home for the fight fact.
export const use_fight = create((set) => ({
  hp: 10,
  fight: { id: 'f1', turn: 0 },
  input: (msg) => set({ hp: msg.hp }),
}))

// Store B — the HUD shell tempted to hold a copy.
export const use_hud = create((set) => ({
  fight: null,
  hp_copy: 0,
  last_fight_id: null,
  active: false,
  adopt: (fight) => set({ fight }),
  // GREEN — B deriving B's own next state is the normal reducer move, not a dual home.
  clear: () => set({ fight: null, active: false }),
}))

// RED 1 — THE INCIDENT SHAPE (2026-07-17 fight mirror): a subscribe pump copying A's slice into B
// "so every consumer flips source without a rewrite" — every mirror consumer is a staleness bug.
export const arm_mirror = () => use_fight.subscribe((state) => use_hud.setState({ fight: state.fight }))

// RED 2 — mirroring THROUGH B's door: the door is the sanctioned async re-entry, but a payload
// that is another store's state is still a second home for that fact.
export const arm_door_mirror = () => use_fight.subscribe((state) => use_hud.getState().adopt(state.fight))

// RED 3 — one-shot copy, no pump: a getState read written straight into a foreign store.
export const copy_once = () => use_hud.setState({ hp_copy: use_fight.getState().hp })

// RED 4 (DOCUMENTED) — the teardown scalar snapshot: one scalar, copied once. The query cannot
// see "once" or "primitive" — a VERBATIM copy flags regardless of size; a deliberately
// sanctioned snapshot rides the baseline ratchet (a fingerprint row), never an inline
// suppression.
export const teardown = () => {
  const { id } = use_fight.getState().fight
  use_hud.setState({ last_fight_id: id })
}

// GREEN — DERIVATION is not a copy: value flow stops at the operator, so deriving a predicate
// (`!= null`) instead of copying the fact passes by construction — exactly the law's advice.
export const sync_mode = () => use_fight.subscribe((state) => use_hud.setState({ active: state.fight != null }))

// GREEN — same-store: a store re-writing its own state is one home talking to itself.
export const rearm = () => use_fight.setState({ fight: use_fight.getState().fight })

// GREEN — foreign DATA (network) entering B through its door is the pipeline, not a mirror.
export const legal_poll = () => fetch('/x').then((r) => use_hud.getState().adopt(r.status))
