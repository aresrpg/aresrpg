// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// classify_input.js — the ONE bridge from a CURRENT fight-store door message to a `fight_input` union
// payload (V2 build step 1, commit ②). The store's `input(msg, now)` is the ONLY writer of fight state,
// so every ingress the machinery consumes — journal poll, courtesy (p2p) rows, tx submit/refuse/status
// (busy + settlement, digest and all), draft/commit dispatches, clock ticks, lifecycle — converges here
// as a `{ type, ... }` message. This maps each `type` onto exactly one union member.
//
// ONE HOME: the recorder tee (live capture) AND the format-1→2 converter (historical corpus) both call
// this — the captured trace_format-1 `msg` and the live door `msg` are the same shape, so the mapping is
// written once. Pure, node-clean, never mutates `msg` (fields are referenced, not cloned — the tee's hot
// path stays allocation-cheap; serialization happens only at dump time).

import {
  journal_rows_received,
  tx_submitted,
  tx_refused,
  tx_status,
  player_draft,
  player_commit,
  clock_observed,
  lifecycle,
  session_opened,
  session_closed,
} from './envelope.js'

// The chain-read messages, keyed by the source label the union carries. `rows` is the source's native
// delivery: a receipt object, an events array, the decoded fight object, or a journal batch.
const rows_of = (msg) => {
  if (msg.type === 'snapshot') return msg.fight
  if (msg.type === 'receipt') return msg.receipt ?? msg.events
  if (msg.type === 'journal') return msg.batch
  return msg.events ?? msg.receipt // poll | p2p
}

const DRAFT_KINDS = new Set(['arm', 'hover_spell', 'board_click', 'stage', 'clear_staged', 'hand_update'])
const COMMIT_KINDS = new Set(['intent', 'predicted', 'rollback', 'drop_traps', 'drop_glyphs'])

/**
 * classify_input — a CURRENT door message → its `fight_input` union payload. Total over every `type` the
 * store's door accepts (current + historical `journal`); an unrecognized type maps to `lifecycle`
 * `{ phase: 'unknown' }` so nothing is ever silently dropped.
 * @param {{ type: string, [k: string]: unknown }} msg
 * @returns {object} a kind-tagged fight_input payload
 */
export const classify_input = (msg = {}) => {
  switch (msg.type) {
    // ── lifecycle / session ──────────────────────────────────────────────────────────────────────
    case 'init':
      // init IS the boot: a fight id opens a session; a null id is the reset/teardown (dungeon exit).
      return msg.fight_id != null
        ? session_opened({ fight_id: msg.fight_id, my_key: msg.my_key ?? null, ctx: msg.ctx })
        : session_closed({ fight_id: null, reason: 'reset' })
    case 'ctx':
      return lifecycle({ phase: 'ctx', ctx: msg.ctx })
    case 'presented':
      return lifecycle({ phase: 'presented', seq: msg.seq })
    case 'error':
      return lifecycle({ phase: 'error', message: msg.message })
    case 'turn_lost_shown':
      return lifecycle({ phase: 'turn_lost_shown', key: msg.key })
    case 'divergence_shown':
      return lifecycle({ phase: 'divergence_shown', version: msg.version, action: msg.action })
    case 'flush':
      return lifecycle({ phase: 'flush' })

    // ── the clock (the ONLY time source) ─────────────────────────────────────────────────────────
    case 'tick':
      return clock_observed({
        last_action_ms: msg.last_action_ms,
        draft_count: msg.draft_count,
        enabled: msg.enabled,
        latch: msg.latch,
      })

    // ── chain reads (journal poll / courtesy / receipt / snapshot / terminal) ─────────────────────
    case 'receipt':
    case 'poll':
    case 'p2p':
    case 'snapshot':
      return journal_rows_received({
        source: msg.type,
        fight_id: msg.fight_id,
        version: msg.version,
        rows: rows_of(msg),
        ...(msg.type === 'snapshot' ? { snapshot_head: msg.journal_head, accepted_head: msg.accepted_head } : {}),
      })
    case 'journal':
      return journal_rows_received({
        source: msg.batch?.source ?? 'journal',
        fight_id: msg.fight_id,
        version: msg.version ?? msg.batch?.head,
        rows: msg.batch,
      })
    case 'terminal_confirmation':
      return journal_rows_received({
        source: 'terminal',
        fight_id: msg.fight_id,
        version: msg.version,
        rows: { phase: msg.phase, last_room: msg.last_room, source: msg.source },
      })

    // ── tx lifecycle (busy mirror + settlement machine) ──────────────────────────────────────────
    case 'busy':
      // The run store mirrors tx flight through this input; `latch` carries the EXECUTED-failure proof
      // (`{ turn_key, digest, ... }`) — a digest means gas burned, so it lands as a refusal, never retried.
      if (msg.latch)
        return tx_refused({
          phase: 'busy',
          reason: 'executed_failure',
          digest: msg.latch?.digest ?? null,
          turn_key: msg.latch?.turn_key,
        })
      return msg.value === true
        ? tx_submitted({ phase: 'busy' })
        : tx_status({ phase: 'busy', busy: false, latch: msg.latch ?? null })
    case 'settlement_attempt':
      return tx_submitted({ phase: 'settlement', signal: msg.signal })
    case 'settlement_outcome':
      return msg.verdict === 'executed_failure'
        ? tx_refused({ phase: 'settlement', reason: 'executed_failure', verdict: msg.verdict, signal: msg.signal })
        : tx_status({ phase: 'settlement_outcome', verdict: msg.verdict, signal: msg.signal })
    case 'settlement_request_consumed':
      return tx_status({ phase: 'settlement_consumed', signal: msg.signal })

    // ── player drafts (pre-commit UI) ────────────────────────────────────────────────────────────
    case 'arm':
    case 'hover_spell':
      return player_draft({ draft_kind: msg.type, spell_id: msg.spell_id ?? null })
    case 'board_click':
      return player_draft({ draft_kind: 'board_click', cell: msg.cell ?? null, targetable: msg.targetable })
    case 'stage':
      return player_draft({ draft_kind: 'stage', intent: msg.intent })
    case 'clear_staged':
      return player_draft({ draft_kind: 'clear_staged' })
    case 'hand_update':
      return player_draft({ draft_kind: 'hand_update', hand: msg.hand })
    case 'placement_ghost':
      // a peer's uncommitted placement pick, relayed p2p (courtesy) — a draft, just not mine.
      return player_draft({
        draft_kind: 'placement_ghost',
        fight_id: msg.fight_id,
        character: msg.character,
        cell: msg.cell,
      })

    // ── player commits (optimistic prediction log + its reversals) ───────────────────────────────
    case 'intent':
      return player_commit({
        commit_kind: 'intent',
        intent: msg.intent,
        version: msg.version,
        event_idx: msg.event_idx,
        beats: msg.beats,
      })
    case 'predicted':
      return player_commit({
        commit_kind: 'predicted',
        actions: msg.actions,
        intent_id: msg.intent_id,
        basis_version: msg.basis_version,
        beats: msg.beats,
        place_traps: msg.place_traps,
        place_glyphs: msg.place_glyphs,
      })
    case 'rollback':
      return player_commit({ commit_kind: 'rollback', intent_id: msg.intent_id, predicts: msg.predicts })
    case 'drop_traps':
    case 'drop_glyphs':
      return player_commit({ commit_kind: msg.type, cells: msg.cells, draft_ids: msg.draft_ids })

    default:
      return lifecycle({ phase: 'unknown', type: msg.type })
  }
}

// The message types classify_input recognizes as a first-class mapping (everything else → lifecycle
// `unknown`). Exported so the converter can flag a historical capture that carried an unmapped type.
export const KNOWN_INPUT_TYPES = new Set([
  'init',
  'ctx',
  'presented',
  'error',
  'turn_lost_shown',
  'divergence_shown',
  'flush',
  'tick',
  'receipt',
  'poll',
  'p2p',
  'snapshot',
  'journal',
  'terminal_confirmation',
  'busy',
  'settlement_attempt',
  'settlement_outcome',
  'settlement_request_consumed',
  ...DRAFT_KINDS,
  'placement_ghost',
  ...COMMIT_KINDS,
])
