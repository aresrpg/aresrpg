// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useState } from 'react'

const CPU_SAMPLE_EVENT = 'ares:cpu-sample'
const CPU_SPAN_EVENT = 'ares:cpu-span'
// D770a W3b: peer position / chat / state / despawn / commission no longer ride context.events — they route
// through @aresrpg/world's presence atom (presence_input), so the p2p CPU probe watches only the party/fight
// bus nudges that remain transport→consumer events.
const P2P_EVENTS = ['packet/partyInviteNudge', 'packet/dungeonShare', 'packet/fightStream']

/** @param {string} system @param {number} start_ms @param {number} end_ms */
function emit_cpu_span(system, start_ms, end_ms) {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined' || end_ms <= start_ms) return
  window.dispatchEvent(new CustomEvent(CPU_SPAN_EVENT, { detail: { system, start_ms, end_ms } }))
}

/** @param {unknown} value @param {number} [digits] */
function number(value, digits = 1) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : '—'
}

/** Debug-only live CPU attribution. The host does not mount this component unless `?cpu=1`. */
export function CpuOverlay() {
  const [sample, set_sample] = useState(null)

  useEffect(() => {
    let disposed = false
    let p2p_loading = false
    /** @type {(() => void)[]} */
    let p2p_removers = []
    const attach_p2p_probe = async () => {
      if (disposed || p2p_loading || p2p_removers.length) return
      p2p_loading = true
      const { context } = await import('../../../core/game.js').catch(() => ({ context: null }))
      if (!context) {
        p2p_loading = false
        return
      }
      if (disposed) return
      p2p_removers = P2P_EVENTS.map((event_name) => {
        const start = () => {
          const started_ms = performance.now()
          queueMicrotask(() => emit_cpu_span('p2p', started_ms, performance.now()))
        }
        context.events.prependListener(event_name, start)
        return () => context.events.off(event_name, start)
      })
    }
    const on_sample = (event) => {
      set_sample(event.detail)
      // The static login never emits an engine sample, so CPU diagnostics do not pull the game core/P2P graph
      // into that capture. Attach after the first live engine frame; the next rolling window is fully covered.
      void attach_p2p_probe()
    }
    window.addEventListener(CPU_SAMPLE_EVENT, on_sample)

    return () => {
      disposed = true
      window.removeEventListener(CPU_SAMPLE_EVENT, on_sample)
      for (const remove of p2p_removers) remove()
    }
  }, [])

  return (
    <aside className="fixed top-3 right-3 z-[80] min-w-[250px] pointer-events-none border border-cyan/40 bg-bg/95 px-3 py-2 font-mono text-[10px] leading-5 tracking-wide text-text shadow-[0_10px_30px_rgba(0,0,0,.6)]">
      <div className="flex justify-between border-b border-white/10 pb-1 text-cyan">
        <span>cpu/5s</span>
        <span>{sample ? `${number(sample.fps, 0)} fps` : '…'}</span>
      </div>
      {sample && (
        <>
          <div className="grid grid-cols-2 gap-x-4 pt-1">
            <span>main_util_pct ≥</span>
            <span className="text-right">{number(sample.main_util_pct)}%</span>
            <span>engine_ms/frame</span>
            <span className="text-right">{number(sample.engine_ms)} ms</span>
            <span>render_ms/frame</span>
            <span className="text-right">{number(sample.render_ms)} ms</span>
            <span>scene_ms/frame</span>
            <span className="text-right">{number(sample.scene_ms)} ms</span>
            <span>react_ms/frame</span>
            <span className="text-right">{number(sample.react_ms)} ms</span>
            <span>p2p_ms/frame</span>
            <span className="text-right">{number(sample.p2p_ms, 2)} ms</span>
            <span>longtask_count/ms</span>
            <span className="text-right">
              {sample.longtask_count} / {number(sample.longtask_ms, 0)} ms
            </span>
            <span>heap_growth/gc_drop</span>
            <span className="text-right">
              {number(sample.heap_growth_mb)} / {number(sample.gc_drop_mb)} MB
            </span>
            <span>worker_msgs/mb</span>
            <span className="text-right">
              {number(sample.worker_messages_s, 0)}/s · {number(sample.worker_mb_s, 2)} MB/s
            </span>
          </div>
        </>
      )}
    </aside>
  )
}
