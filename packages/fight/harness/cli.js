// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// @aresrpg/fight harness — the pseudo-CLI's plumbing: beat rows → human lines, and the core wave → §7b
// BeatTraceRow rows (the machine twin's input), clocked EXACTLY like the serial render queue (each turn from
// its own head). The optional `vfx` lane marks each cast's NATURAL impact — delivery = cast start + the
// untouched CAST_BEAT_MS clip — so E2 (delivery → floater) is measurable in node for natural-branch turns
// (the "at least 1s late" floater-timing class; compressed long turns stay beat-lane-only, exactly like envelopes_7b).

import { CAST_BEAT_MS } from '../src/fight_render_events.js'

const sec = (ms) => `${(ms / 1000).toFixed(1)}s`.padStart(6)

/** One stream beat → one printable line (null = silent bookkeeping). Everything read straight off
 *  {kind, at, duration, payload} — the renderer contract: nothing here computes game state. */
export const beat_line = (head_ms, b) => {
  const t = `[${sec(head_ms + b.at)}]`
  const p = b.payload ?? {}
  switch (b.kind) {
    case 'turn_start':
      return `${t} ── turn opens`
    case 'turn_end':
      return `${t} ── turn ends`
    case 'move':
      return `${t} ${p.entity_id} walks ${p.path?.length ?? 0} cells`
    case 'cast':
      return `${t} ${p.entity_id} casts ${p.spell_id ?? 'strike'} → (${p.target?.x},${p.target?.y})`
    case 'damage':
      return `${t} ${p.target_id} takes ${p.damage} dmg → ${p.new_health} hp`
    case 'death':
      return `${t} ${p.target_id} dies`
    case 'fight_end':
      return `${t} ★ fight over — ${p.outcome}`
    case 'arrival':
      return null
    default:
      return `${t} ${b.kind}`
  }
}

/** Core wave rows → §7b trace rows. Non-local turns only (§7b's domain); serial head clock (+1ms queue tick). */
export const trace_of = (wave, { t0 = 0, vfx = false } = {}) => {
  const rows = []
  let head = t0
  for (const turn of wave.filter((t) => !t.is_local)) {
    for (const b of turn.beats) {
      rows.push({
        t: head + b.at,
        lane: 'beat',
        kind: b.kind,
        id: b.payload?.entity_id ?? b.payload?.target_id ?? null,
      })
      if (vfx && b.kind === 'cast')
        rows.push({ t: head + b.at + CAST_BEAT_MS, lane: 'vfx', kind: 'delivery', id: b.payload?.entity_id ?? null })
    }
    head += turn.duration + 1
  }
  return rows
}
