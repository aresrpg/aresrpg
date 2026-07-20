// @aresrpg/world — the headless world core (D770a): THREE reducer atoms behind three input doors,
// effects as exported subscriptions, renderers consume projections and compute nothing.
//
//   session_gate — WHICH session is live (the three-valued world binding, the joining hold, the
//                  stale-poll guard, the scene plan projection, the join-failsafe effect request).
//   spawns_zones — where am I PROVEN to be and what exists/is claimable there (W2).
//   presence     — who/what is around me NOW, freshness-law'd ephemera (W3).
//
// Cross-domain facts travel as TYPED INPUTS ferried by the composition root — cores never import
// cores, never import stores, and never perform an effect.

export * from './session_gate.js'
export * from './character_selection.js'
export * from './spawns_zones.js'
export * from './spawns_reconcile.js'
export * from './checkpoint.js'
export * from './gather_gate.js'
export * from './openness.js'
export * from './presence.js'
export * from './nearby_fights.js'
export * from './friend_target.js'
