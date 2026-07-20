// Fixtures for js/aresrpg/effect-escapes-the-edge (CODE_LAW L-P4/L-P1) — the fight fold must be
// pure over (msg, now); effects live at the seam (txs.js) or enter as inputs.
import { create } from 'zustand'

import { decide } from '../../frontend/src/world-shell/turn_commit.js'

const recompute = (draft, now) => ({ ...draft, refreshed_at: now })

// RED A — a core-file helper performing network I/O.
const leak_telemetry = () => fetch('/telemetry')

export const use_fight = create((set, get) => ({
  refreshed_at: 0,
  // GREEN — `now = Date.now()` in parameter-default position is the sanctioned input edge.
  input: (msg, now = Date.now()) => {
    if (msg.type === 'tick') leak_telemetry()
    // RED B — a second clock scheduled inside the fold.
    if (msg.type === 'later') setTimeout(() => {}, 99)
    // (reaches RED D in turn_commit.js — nondeterminism OUTSIDE fight/, called from the fold)
    if (decide(get())) return set((s) => recompute(s, now))
    return undefined
  },
}))

// RED C — module-scope effect in a core file (a load-time clock).
setInterval(() => {}, 60000)
