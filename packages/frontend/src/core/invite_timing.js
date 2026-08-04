// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2159 — the party invite's click→visible trace (DoD ①). The three stages are the three honest legs an invite
// pays: the press, the moment the invite transaction is CERTIFIED (everything before it is PTB compose + sponsor
// + finality — the only leg with a physical floor), and the moment the inviter's UI actually says "invited".
// Keyed by the invited character id, so two invites in flight cannot close each other's trace.

import { create_latency_trace } from './latency_trace.js'

export const INVITE_STAGES = Object.freeze(['click', 'executed', 'visible'])

const trace = create_latency_trace({
  prefix: 'party-invite',
  stages: INVITE_STAGES,
  namespace: 'invite-perf',
  label: 'party invite',
})

export const INVITE_MARK_NAMES = trace.names.marks
export const INVITE_MEASURE_NAMES = trace.names.measures

/** The invite press, for the exact character being invited. */
export const start_invite_timing = (invited_character_id, source = 'player-menu') =>
  trace.start(invited_character_id, source)

/** The invite transaction executed and its effects are certified — everything after this is local reflection. */
export const mark_invite_executed = (invited_character_id) => trace.stage('executed', invited_character_id)

/** The inviter can SEE the pending invitation. Returns the durations (test seam). */
export const finish_invite_timing = (invited_character_id) => trace.finish(invited_character_id)

/** A refused/failed invite cannot finish; its partial marks stay inspectable until the next press. */
export const cancel_invite_timing = () => trace.cancel()

/** Unit seam: the character whose invite is currently being measured, or null. */
export const invite_timing_character_id = () => trace.key()
