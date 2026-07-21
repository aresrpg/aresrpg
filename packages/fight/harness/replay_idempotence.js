// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// @aresrpg/fight harness — the REPLAY-IDEMPOTENCE property (issue #281). A presentation beat must be a
// function of an OBSERVED STATE DELTA, never of an EVENT ARRIVAL: the same authoritative fact carried by
// receipt + poll + p2p arrives 2-3× for one on-chain truth, and the eye must see it play EXACTLY ONCE
// (the double-death family — a kill re-animated because a duplicate receipt re-emitted its death beat).
//
// The property, over ANY scenario's input log: run(single delivery) and run(each authoritative input
// delivered 2-3× interleaved) produce a BYTE-IDENTICAL presentation trace — the ordered wave/beat list the
// renderer would play. Pure + dependency-free: the caller injects a store factory; nothing here touches a
// store's internals beyond the public `input(msg, now)` door and the `wave` projection.

/** The delivery classes that carry ON-CHAIN truth and therefore arrive redundantly (receipt + the 4s poll +
 *  a p2p relay all speak the same version). Local pushes (`intent`/`predicted`) and acks (`presented`) are
 *  single-shot by construction — a click happens once — so they are never duplicated. */
export const AUTHORITATIVE = new Set(['receipt', 'poll', 'p2p', 'snapshot'])

/** The duplicated-delivery log: each authoritative input delivered `2 + (i % 2)` times IN PLACE (same msg,
 *  same clock) — the "one fact, three transports" model, interleaved into the stream rather than batched.
 *  Deterministic, and exercises both the 2× and 3× multiplicities. Everything else passes through once. */
export const duplicated_delivery = (log) =>
  log.flatMap((step, i) =>
    AUTHORITATIVE.has(step.msg?.type) ? Array.from({ length: 2 + (i % 2) }, () => step) : [step]
  )

// A wave turn's raw `source_event` (the decoded chain event) and `source_turn` bookkeeping tag are PROVENANCE,
// not presentation identity — drop them so the trace is the honest "what the eye plays" (kinds, cells, damage,
// paths, timing) and stays JSON-stable. Keys are sorted so the image is canonical regardless of build order.
const strip = (value) => {
  if (typeof value === 'bigint') return { $bigint: value.toString() }
  if (Array.isArray(value)) return value.map(strip)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => key !== 'source_event' && key !== 'source_turn')
        .map((key) => [key, strip(value[key])])
    )
  return value
}

/** One emitted wave turn as its presentation signature — the fields that decide what plays and when. */
const turn_signature = (turn) => ({
  seq: turn.seq,
  version: turn.version ?? null,
  is_local: !!turn.is_local,
  source_id: turn.source_id ?? null,
  from_idx: turn.from_idx ?? null,
  until_idx: turn.until_idx ?? null,
  duration: turn.duration ?? 0,
  beats: (turn.beats ?? []).map(strip),
})

/**
 * Drive a fresh store through `log` and serialize the ORDERED presentation output — every wave turn ever
 * emitted, in first-seen order. A turn is IMMUTABLE once appended (a `presented` ack only removes it from the
 * live wave, never rewrites it), so first-sighting captures exactly what would have played, even for turns
 * that drain before the run ends. This is the honest serialization of "what would present".
 * @param {() => { getState: () => { input: Function, wave: any[] } }} store_factory
 * @param {{ msg: object, now: number }[]} log
 * @returns {string} the byte image (JSON) of the ordered wave/beat list
 */
export const presentation_trace = (store_factory, log) => {
  const store = store_factory()
  // Fold the run, appending every wave turn the moment it FIRST appears. `seen`/`order` are a reduce
  // accumulator — local construction, not shared mutation (docs/CODE_LAW.md L-I3); `order` grows by spread,
  // never a mutator. The capture runs once before the first input (total) and after every input.
  const capture = (acc) => {
    const fresh = (store.getState().wave ?? []).filter((turn) => !acc.seen.has(turn))
    for (const turn of fresh) acc.seen.add(turn)
    return { seen: acc.seen, order: [...acc.order, ...fresh] }
  }
  const { order } = log.reduce(
    (acc, { msg, now }) => {
      store.getState().input(msg, now)
      return capture(acc)
    },
    capture({ seen: new Set(), order: [] })
  )
  return JSON.stringify(order.map(turn_signature))
}

/** The property's two runs for a scenario: the single-delivery trace and the duplicated-delivery trace.
 *  Equal strings ⇒ presentation is delivery-idempotent (the observe discipline holds). */
export const replay_idempotent = (store_factory, log) => ({
  single: presentation_trace(store_factory, log),
  duplicated: presentation_trace(store_factory, duplicated_delivery(log)),
})
