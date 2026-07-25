// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// fight_v2_shadow.js — THE SHADOW COMPARATOR (fight-client V2 migration, issue #522). Consumer-only: it
// compares two already-folded committed boards and returns a verdict. It writes to neither side — a
// divergence is DATA (the verdict this module returns), never a thrown fault, a store write, or a DOM
// mutation. The integration seam (fight_trace_tee.js) owns every `window` read/write; this module stays
// hermetic and node-testable.
//
// BOX 4 FLIPPED THE DIRECTION. Through box 3 this module OWNED a dark v2 core and diffed it against the
// live pipeline. The core is now the TRUTH OWNER and lives in the fight store's own atom (`state.core`,
// folded by the one door — fight/src/store.js), so this module no longer ingests anything: the tee hands it
// the truth board (`project_board(state.core)`) and the LEGACY board (`committed_state(state)`), and the
// legacy fold is what is on trial. Same comparator, same telemetry, reversed roles.
//
// THE COMPARISON is scoped to the fields the ticket names as stable across both folds: per-fighter position
// (cell) / hp / alive / turn count (turn_number), plus the board-level "whose turn" pointer (active). Both
// sides derive every one of these through the SAME `apply_action` reducer (packages/fight/src/inputs.js) —
// the legacy side via `committed_state` (fight/src/fold.js), the core via `project_board`
// (fight/src/v2/project.js) — so under the shuffle property (fight/test/v2/shuffle.test.js) they are
// expected to agree whenever fed the same input. ap/mp/invisible/turn_deadline_ms/action_contexts are
// deliberately OUT of this pass's field set (the ticket scoped the comparison to positions/hp/alive/turn) —
// widen `FIGHTER_FIELDS` in a follow-up if a real desync ever needs a wider net.
//
// ONE KNOWN, BY-DESIGN DIVERGENCE CLASS: an UNVERIFIED courtesy (p2p) row. The legacy fold commits a peer's
// relayed action immediately; the core buffers it as courtesy and admits it only once a verified chain row
// matches it (v2/inbox.js, rider R1). In a party fight the legacy board therefore runs ahead of chain truth
// for the courtesy window and this comparator reports it — correctly. It is the legacy side that is wrong.
//
// STATE lives in a FACTORY (`create_shadow_driver`), never a module-level binding — bun test runs a whole
// suite in one process (scripts/order-independence-gate.sh), so a bare module `let` would leak counters
// across fights and test files. The one instance this build wires lives in the `install_fight_trace_tee`
// closure (fight_trace_tee.js): a fresh call there makes a fresh instance.
//
// NAMING NOTE: no binding in this file spells `_v2`/`_V2` (D756's app-identifier extension,
// scripts/check-constraints.sh `--app-clean-names`, bans an underscore immediately before v2/V2 in app
// source). `v2` appears only inside quoted strings, which the identifier scan exempts.

import { push_bounded, capsule_export, CAPSULE_RING_LIMIT } from '@aresrpg/fight/capsule'

import { game_log } from '../core/log.js'

/** The switch's public spelling — a query key and a localStorage key. Both are STRING DATA (quoted literals
 *  are exempt from the D756 identifier scan), so the string content is free to say "v2shadow". */
export const SHADOW_QUERY_PARAM = 'v2shadow'
export const SHADOW_STORAGE_KEY = 'ares_v2shadow'

/**
 * shadow_enabled_from — the pure arm check. DEFAULT-ON as of box 3 (issue #522): live inputs fan to the new
 * log for every session, so this switch is now a KILL switch rather than an opt-in. `?v2shadow=0` disarms
 * this page load; localStorage `ares_v2shadow='0'` disarms stickily; an explicit query value always beats the
 * stored preference (a URL is a deliberate act, a stored key is a leftover). `=1` still arms explicitly, so
 * every spelling that worked while the shadow was opt-in keeps working unchanged. `search`/`storage_get` are
 * injected so this is testable without a DOM `window` (mirrors fight_state_trace.js's `fight_trace_enabled`).
 * @param {{ search?: string, storage_get?: (key: string) => string | null }} [fields]
 * @returns {boolean}
 */
export const shadow_enabled_from = ({ search = '', storage_get = () => null } = {}) => {
  const query = new URLSearchParams(search).get(SHADOW_QUERY_PARAM)
  if (query != null) return query !== '0'
  return storage_get(SHADOW_STORAGE_KEY) !== '0'
}

/**
 * The envelope kinds that provably CANNOT move committed truth on EITHER side, so comparing the two boards
 * would only re-prove the previous envelope's verdict at the cost of a full re-fold per side. The core's door
 * documents both as fold no-ops (`player_draft` returns the state unchanged; `clock_observed` writes only
 * `state.clock`, which `project_board`'s fold never reads — v2/ingest.js), and the legacy side is symmetric: a
 * draft or a tick writes staged/commit/wave bookkeeping, never the view/entries/view_version/retired
 * quadruple `committed_state` folds (fight/src/fold.js). Both kinds still reach the core through the store's
 * own door — the input log stays complete and the clock cursor keeps advancing — only the COMPARISON is
 * skipped. This is what makes it affordable: FightTimeline drives a 4 Hz `tick` for the whole of every turn
 * (FightTimeline.jsx), so comparing on ticks would spend a full legacy re-fold four times a second, all
 * fight, to reprint a verdict neither side could have changed. A divergence introduced under one of these
 * kinds is impossible by construction; the very next truth-moving envelope compares the whole board anyway,
 * so detection is never weakened — only its timestamp moves to the next real input.
 */
const TRUTH_STILL_KINDS = new Set(['clock_observed', 'player_draft'])

// The stable per-fighter fields both folds derive through the same `apply_action` reducer (see header).
const FIGHTER_FIELDS = ['cell', 'hp', 'alive', 'turn_number']

const field_of = (fighters, key, field) => fighters?.[key]?.[field] ?? null

const values_differ = (a, b) => (Number.isNaN(a) && Number.isNaN(b) ? false : a !== b)

/**
 * diff_boards — the stable-field comparator. Pure and symmetric. A fighter present on only one side reads real
 * values against `null` on the other, so a missing fighter surfaces on its own — no separate presence check.
 * @param {{ active?: any, fighters?: Record<string, any> }} shadow_board committed_state(store state) — on trial
 * @param {{ active?: any, fighters?: Record<string, any> }} truth_board project_board(store state's core)
 * @returns {string[]} sorted dotted field paths that disagree (`[]` when the boards agree)
 */
export const diff_boards = (shadow_board, truth_board) => {
  const diffs = []
  if (values_differ(shadow_board?.active ?? null, truth_board?.active ?? null)) diffs.push('active')
  const keys = new Set([...Object.keys(shadow_board?.fighters ?? {}), ...Object.keys(truth_board?.fighters ?? {})])
  for (const key of [...keys].sort())
    for (const field of FIGHTER_FIELDS)
      if (values_differ(field_of(shadow_board?.fighters, key, field), field_of(truth_board?.fighters, key, field)))
        diffs.push(`fighters.${key}.${field}`)
  return diffs
}

/**
 * create_shadow_driver — THE FACTORY. Each call returns a fresh instance: its own per-fight envelope ring (for
 * the divergence capsule dump) and its own counters. Never shared module state, and — since box 4 — never a
 * fold of its own: the boards it judges are both folded by the store.
 * @param {{ app_version?: string | null }} [opts]
 * @returns {{ observe: (envelope: object, boards: object) => object, status: () => object }}
 */
export const create_shadow_driver = ({ app_version = null } = {}) => {
  let fight_envelopes = [] // this fight's envelope stream — reset per session_opened, bounded like the tee's ring
  let fights_shadowed = 0
  let divergences = 0
  let last = null
  let logged_fight_id = null // throttle: the fight_id whose FIRST divergence already logged + dumped a capsule

  /**
   * observe — record ONE envelope and judge the LEGACY board against the core's board at the same instant (the
   * caller reads both off the store right after its own commit — see fight_trace_tee.js). Total: never throws,
   * always returns a verdict.
   * @param {{ payload?: { kind?: string }, observed_at_ms?: number }} envelope
   * @param {{ truth_board: object, shadow_board: object, fight_id?: string | null }} boards
   * @returns {{ diverged: boolean, first_for_fight?: boolean, fight_id?: string | null, fields?: string[], capsule?: object }}
   */
  const observe = (envelope, { truth_board, shadow_board, fight_id = null }) => {
    if (envelope?.payload?.kind === 'session_opened') {
      fights_shadowed += 1
      fight_envelopes = []
      logged_fight_id = null
    }
    fight_envelopes = push_bounded(fight_envelopes, envelope, CAPSULE_RING_LIMIT)
    // RECORDED above (the capsule must replay the whole input stream), compared below only when the envelope
    // could have moved truth — see TRUTH_STILL_KINDS.
    if (TRUTH_STILL_KINDS.has(envelope?.payload?.kind)) return { diverged: false }

    const fields = diff_boards(shadow_board, truth_board)
    if (!fields.length) return { diverged: false }

    divergences += 1
    last = { fight_id, at: envelope?.observed_at_ms ?? null, fields }
    if (logged_fight_id === fight_id) return { diverged: true, first_for_fight: false, fight_id, fields }

    // THROTTLE: only the FIRST divergence per fight logs + dumps (a desynced fight would otherwise diverge on
    // every following beat too) — `divergences`/`last` above still track every occurrence, logged or not.
    logged_fight_id = fight_id
    game_log('v2-shadow', 'divergence', { fight_id, fields })
    const capsule = capsule_export({
      session_id: fight_id,
      app_version,
      captured_at: envelope?.observed_at_ms ?? Date.now(),
      capsules: fight_envelopes,
      flags: { reason: 'shadow_divergence', fields },
    })
    return { diverged: true, first_for_fight: true, fight_id, fields, capsule }
  }

  const status = () => ({ fights_shadowed, divergences, last })

  return { observe, status }
}
