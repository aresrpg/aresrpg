// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/trace_export.js — the dual-capsule trace export (spec §8).
//
// TWO ALREADY-SHIPPED FORMATS, ONE FILE. The simulator invents no trace format; it downloads the two the repo
// already owns and already replays:
//
//   · envelope capsule (trace_format-2) — `packages/fight/src/capsule.js capsule_export`, produced by the door
//     tee (`world-shell/fight_trace_tee.js`, which parks its dumper on `window.__ARES_FIGHT_CAPSULE_DUMP`) and
//     replayed by `packages/fight/src/v2/replay.js replay_trace`. It carries the PRESENTATION/fold pipeline.
//   · sim capsule — `packages/sim/src/timeline.js`, produced by sim_chain's recorder ring and replayed by
//     `timeline.js replay_capsule`. It carries arena + templates + initial state + the COMMAND LIST, which is
//     the deterministic one: seed + commands re-fold byte-identically, so a captured fight is a fixture
//     candidate for `packages/sim/test/fixtures/replay/`.
//
// THE SEED RIDES BOTH, MECHANICALLY. A simulator fight id is `sim:<seed>:<n>` (spec §4.7), and that id is the
// envelope capsule's `session_id` — so the determinism root is inside the envelope format with no change to
// it. `seed_from_fight_id` below is the ONE home for that convention (and `sim_fight_id` its inverse), so the
// claim "the seed rides both exports" is a checked property rather than a comment: `build_sim_trace` refuses to
// shape a payload whose envelope session id disagrees with the seed the sim capsule was recorded under.
//
// PURE CORE, THIN EDGE: `build_sim_trace` / `trace_filename` / the id codec are pure and tested; only
// `export_sim_trace` touches Blob/anchor/IndexedDB, and every one of its collaborators is injected.

import { stringify_trace } from '@aresrpg/fight/trace_tap'

/** The wrapper's own version — bumped only if the two-capsule envelope shape itself changes. */
export const SIM_TRACE_FORMAT = 'aresrpg-simfight-1'

/** The IDB `traces` ring depth (spec §6). Newest first; the oldest export falls off the end. */
export const TRACE_RING_LIMIT = 10

const hex_seed = (seed) => (seed >>> 0).toString(16).padStart(8, '0')

/** The §4.7 fight id: `sim:<seed-hex>:<n>`. START always mints a fresh one, so `n` is the page's fight counter. */
export const sim_fight_id = (seed, n) => `sim:${hex_seed(seed)}:${Number(n)}`

/** The inverse — the determinism root recovered from any simulator trace, or null for a foreign id. */
export const seed_from_fight_id = (fight_id) => {
  const match = /^sim:([0-9a-f]{8}):\d+$/.exec(String(fight_id ?? ''))
  return match ? Number.parseInt(match[1], 16) : null
}

/** `aresrpg-simfight-<seed>-<fight_id>.json` (spec §8), with the id's colons flattened for every filesystem. */
export const trace_filename = (seed, fight_id) =>
  `aresrpg-simfight-${hex_seed(seed)}-${String(fight_id).replace(/[^a-zA-Z0-9_-]/g, '_')}.json`

/**
 * Shape the downloadable payload. Throws rather than shipping a trace whose two halves disagree about which
 * fight they came from — a mismatched pair is worse than no file: it replays two different fights and looks
 * like a determinism bug in the sim.
 * @param {{ seed:number, fight_id:string, sim_capsule:any, envelope_capsule:any, captured_at?:number }} parts
 */
export const build_sim_trace = ({ seed, fight_id, sim_capsule, envelope_capsule, captured_at = Date.now() }) => {
  const rooted = seed_from_fight_id(fight_id)
  if (rooted == null) throw new Error(`simulator trace: "${fight_id}" is not a sim:<seed>:<n> fight id`)
  if (rooted !== (seed >>> 0))
    throw new Error(`simulator trace: fight id carries seed ${hex_seed(rooted)}, recorded seed is ${hex_seed(seed)}`)
  const session = envelope_capsule?.session_id ?? null
  if (session != null && String(session) !== String(fight_id))
    throw new Error(`simulator trace: envelope capsule is for "${session}", not "${fight_id}"`)
  return {
    format: SIM_TRACE_FORMAT,
    seed: seed >>> 0,
    fight_id,
    captured_at,
    sim_capsule: sim_capsule ?? null,
    envelope_capsule: envelope_capsule ?? null,
  }
}

/** The ring update — newest first, one row per fight id (a re-export of the same fight replaces its row). */
export const push_trace_ring = (ring, trace, limit = TRACE_RING_LIMIT) =>
  [trace, ...(ring ?? []).filter((row) => row?.fight_id !== trace.fight_id)].slice(0, limit)

/**
 * Download the dual capsule and hand it to the ring. Every collaborator is injected so this is drivable
 * headless; the defaults are the production ones.
 *
 * `dump_envelope` defaults to the tee's own window dumper — the tee is the ONE owner of that global
 * (fight_trace_tee.js's header), so this reads it through the same name the game's export button does rather
 * than reaching into the capsule ring itself.
 *
 * @returns {{ ok: boolean, reason?: string, trace?: any }} — never a fabricated empty file (no-silent-failure).
 */
export const export_sim_trace = ({
  seed,
  fight_id,
  sim_capsule = null,
  dump_envelope = () => (typeof window === 'undefined' ? null : window.__ARES_FIGHT_CAPSULE_DUMP?.() ?? null),
  download = default_download,
  save = null,
  now = Date.now,
}) => {
  const envelope_capsule = dump_envelope()
  if (!envelope_capsule && !sim_capsule) return { ok: false, reason: 'nothing_captured' }
  const trace = build_sim_trace({ seed, fight_id, sim_capsule, envelope_capsule, captured_at: now() })
  // BigInt-safe, like the game's own export: a snapshot input's chain u64 fields ride the envelope verbatim and
  // a bare JSON.stringify throws the instant the walk reaches one (fight_trace_export.js's note).
  download(trace_filename(seed, fight_id), stringify_trace(trace, 2))
  if (save) void save(trace)
  return { ok: true, trace }
}

/** The Blob/anchor dance, isolated so every other line above is testable without a DOM. */
function default_download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
