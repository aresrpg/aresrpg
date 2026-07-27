// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Live journal rows are canonical truth and presentation input. The canonical copy remains `type:'journal'`;
// each unseen contiguous transaction first takes the existing receipt-shaped presentation route so spectators
// and partners receive the same paced beat grammar as an actor without teaching the renderer a second vocabulary.

import { u64 } from '@aresrpg/fight/journal_u64'

const raw_event = (event) => ({
  type: `journal::${event.kind}`,
  parsedJson: event.data ?? {},
})

const unseen_contiguous_events = (batches, accepted_head) => {
  let expected = (u64(accepted_head) ?? -1n) + 1n
  let events = []

  for (const batch of batches ?? []) {
    for (const event of batch?.events ?? []) {
      const seq = u64(event?.seq)
      if (seq == null || seq < expected) continue
      if (seq > expected) return events
      events = [...events, event]
      expected += 1n
    }
  }
  return events
}

const transaction_groups = (events) => {
  let groups = []
  for (const event of events) {
    if (event.version == null) break
    const identity = `${String(event.version)}:${String(event.digest ?? '')}`
    const prior = groups.at(-1)
    groups =
      prior?.identity === identity
        ? [...groups.slice(0, -1), { ...prior, events: [...prior.events, event] }]
        : [...groups, { identity, version: event.version, digest: event.digest ?? null, events: [event] }]
  }
  return groups
}

/**
 * Presentation copies followed by the unchanged canonical journal batches. The presentation copies contain only
 * the contiguous unseen prefix above `accepted_head`; a gap is left for the journal accept machine to surface and
 * re-walk. Transaction boundaries come from the journal's version+digest provenance, so a page split cannot batch
 * unrelated turns or split one transaction's natural beat sequence.
 *
 * @param {{ fight_id:string, batches:any[], accepted_head:string|number|bigint|null, trap_cells?:number[] }} args
 * @returns {any[]}
 */
export const journal_replay_messages = ({ fight_id, batches, accepted_head, trap_cells = [] }) => {
  const presentation = transaction_groups(unseen_contiguous_events(batches, accepted_head)).map((group) => ({
    type: 'receipt',
    fight_id,
    version: group.version,
    trap_cells: [...trap_cells],
    receipt: {
      digest: group.digest,
      events: group.events.map(raw_event),
    },
  }))
  const canonical = (batches ?? []).map((batch) => ({ type: 'journal', fight_id, batch }))
  return [...presentation, ...canonical]
}
