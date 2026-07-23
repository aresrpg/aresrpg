// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// fight_v2_shadow.js — THE SHADOW FAN-OUT core (fight-client V2 migration, build-order step 3, issue #522).
// DARK, consumer-only: this module reads the landed headless core (packages/fight/src/v2) and compares its
// fold against the OLD pipeline's committed board. It writes to neither side — a divergence is DATA (a
// verdict this module returns), never a thrown fault, a store write, or a DOM mutation. The integration seam
// (fight_trace_tee.js) owns every `window` read/write; this module stays hermetic and node-testable.
//
// THE COMPARISON is scoped to the fields the ticket names as stable across both folds: per-fighter position
// (cell) / hp / alive / turn count (turn_number), plus the board-level "whose turn" pointer (active). Both
// sides derive every one of these through the SAME `apply_action` reducer (packages/fight/src/inputs.js) —
// the old pipeline via `committed_state` (fight/src/fold.js), the new core via `project_board`
// (fight/src/v2/project.js) — so under the shuffle property (fight/test/v2/shuffle.test.js) they are
// expected to agree whenever fed the same input. ap/mp/invisible/turn_deadline_ms/action_contexts are
// deliberately OUT of this pass's field set (the ticket scoped the comparison to positions/hp/alive/turn) —
// widen `FIGHTER_FIELDS` in a follow-up if a real desync ever needs a wider net.
//
// STATE lives in a FACTORY (`create_shadow_driver`), never a module-level binding — bun test runs a whole
// suite in one process (scripts/order-independence-gate.sh), so a bare module `let` would leak a v2 core
// across fights and test files. The one instance this build wires lives in the `install_fight_trace_tee`
// closure (fight_trace_tee.js): a fresh call there makes a fresh instance.
//
// NAMING NOTE: no binding in this file spells `_v2`/`_V2` (D756's app-identifier extension,
// scripts/check-constraints.sh `--app-clean-names`, bans an underscore immediately before v2/V2 in app
// source). `v2` appears only as a LEADING prefix (`v2_board`, never `_v2`) — the same discipline the landed
// v2/ core itself already keeps (its own exports carry no "v2" at all; the directory is the only marker).

import { empty_core_state, ingest, project_board } from '@aresrpg/fight/v2'
import { push_bounded, capsule_export, CAPSULE_RING_LIMIT } from '@aresrpg/fight/capsule'

import { game_log } from '../core/log.js'

/** The arming switch's public spelling — a query key and a localStorage key. Both are STRING DATA (quoted
 *  literals are exempt from the D756 identifier scan), so the string content is free to say "v2shadow". */
export const SHADOW_QUERY_PARAM = 'v2shadow'
export const SHADOW_STORAGE_KEY = 'ares_v2shadow'

/**
 * shadow_enabled_from — the pure arm check. `search`/`storage_get` are injected so this is testable without
 * a DOM `window` (mirrors fight_state_trace.js's `fight_trace_enabled(search)`).
 * @param {{ search?: string, storage_get?: (key: string) => string | null }} [fields]
 * @returns {boolean}
 */
export const shadow_enabled_from = ({ search = '', storage_get = () => null } = {}) => {
  if (new URLSearchParams(search).get(SHADOW_QUERY_PARAM) === '1') return true
  return storage_get(SHADOW_STORAGE_KEY) === '1'
}

// The stable per-fighter fields both folds derive through the same `apply_action` reducer (see header).
const FIGHTER_FIELDS = ['cell', 'hp', 'alive', 'turn_number']

const field_of = (fighters, key, field) => fighters?.[key]?.[field] ?? null

const values_differ = (a, b) => (Number.isNaN(a) && Number.isNaN(b) ? false : a !== b)

/**
 * diff_boards — the stable-field comparator. Pure. A fighter present on only one side reads real values
 * against `null` on the other, so a missing fighter surfaces on its own — no separate presence check needed.
 * @param {{ active?: any, fighters?: Record<string, any> }} old_board committed_state(old pipeline state)
 * @param {{ active?: any, fighters?: Record<string, any> }} v2_board project_board(v2 core state)
 * @returns {string[]} sorted dotted field paths that disagree (`[]` when the boards agree)
 */
export const diff_boards = (old_board, v2_board) => {
  const diffs = []
  if (values_differ(old_board?.active ?? null, v2_board?.active ?? null)) diffs.push('active')
  const keys = new Set([...Object.keys(old_board?.fighters ?? {}), ...Object.keys(v2_board?.fighters ?? {})])
  for (const key of [...keys].sort())
    for (const field of FIGHTER_FIELDS)
      if (values_differ(field_of(old_board?.fighters, key, field), field_of(v2_board?.fighters, key, field)))
        diffs.push(`fighters.${key}.${field}`)
  return diffs
}

/**
 * create_shadow_driver — THE FACTORY. Each call returns a fresh instance: its own v2 core state, its own
 * per-fight envelope ring (for the divergence capsule dump), its own counters. Never shared module state.
 * @param {{ app_version?: string | null }} [opts]
 * @returns {{ ingest_envelope: (envelope: object, old_board: object) => object, status: () => object }}
 */
export const create_shadow_driver = ({ app_version = null } = {}) => {
  let v2_state = empty_core_state()
  let fight_envelopes = [] // this fight's envelope stream — reset per session_opened, bounded like the tee's ring
  let fights_shadowed = 0
  let divergences = 0
  let last = null
  let logged_fight_id = null // throttle: the fight_id whose FIRST divergence already logged + dumped a capsule

  /**
   * ingest_envelope — feed ONE envelope through the v2 core and compare the resulting board against the OLD
   * pipeline's board at the same instant (the caller reads `old_board` right after its own commit — see
   * fight_trace_tee.js). Total: never throws, always returns a verdict.
   * @param {{ payload?: { kind?: string }, observed_at_ms?: number }} envelope
   * @param {{ active?: any, fighters?: Record<string, any> }} old_board
   * @returns {{ diverged: boolean, first_for_fight?: boolean, fight_id?: string | null, fields?: string[], capsule?: object }}
   */
  const ingest_envelope = (envelope, old_board) => {
    v2_state = ingest(v2_state, envelope)
    if (envelope?.payload?.kind === 'session_opened') {
      fights_shadowed += 1
      fight_envelopes = []
      logged_fight_id = null
    }
    fight_envelopes = push_bounded(fight_envelopes, envelope, CAPSULE_RING_LIMIT)

    const fields = diff_boards(old_board, project_board(v2_state))
    if (!fields.length) return { diverged: false }

    divergences += 1
    const { fight_id } = v2_state
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

  return { ingest_envelope, status }
}
