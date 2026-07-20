// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  create_cpu_probe,
  create_hitch_probe,
  estimate_message_bytes,
  url_flag_on,
  url_switch_on,
} from './hitch_probe.js'

/** @param {number} start_time @param {number} duration */
function entry(start_time, duration) {
  return /** @type {PerformanceEntry} */ ({ startTime: start_time, duration })
}

describe('hitch probe flags + byte accounting', () => {
  test('follows exact opt-in and default-on switch conventions', () => {
    expect(url_flag_on('hitch', '?hitch=1')).toBe(true)
    expect(url_flag_on('hitch', '?hitch=0')).toBe(false)
    expect(url_switch_on('gpucull', '')).toBe(true)
    expect(url_switch_on('gpucull', '?gpucull=0')).toBe(false)
    expect(url_switch_on('mesh_slice', '')).toBe(true)
    expect(url_switch_on('mesh_slice', '?mesh_slice=0')).toBe(false)
  })

  test('counts transferred buffers once even through multiple views', () => {
    const buffer = new ArrayBuffer(1024)
    expect(estimate_message_bytes({ a: new Uint8Array(buffer), b: new Uint32Array(buffer) })).toBeGreaterThanOrEqual(
      1024
    )
    expect(estimate_message_bytes({ a: new Uint8Array(buffer), b: new Uint32Array(buffer) })).toBeLessThan(1100)
  })

  test('counts transferred buffers nested in carrier arrays', () => {
    const occupancy = [new Uint32Array(32), new Uint32Array(32), new Uint32Array(32)]
    expect(estimate_message_bytes({ occupancy })).toBeGreaterThanOrEqual(3 * 32 * Uint32Array.BYTES_PER_ELEMENT)
  })
})

describe('hitch probe frame ownership', () => {
  test('snapshots the completed interval, then resets counters for the next one', () => {
    /** @type {string[]} */
    const lines = []
    const probe = create_hitch_probe({ search: '?hitch=1', log: (line) => lines.push(line), observe: () => () => {} })
    probe.frame(16, 16) // prime: boot work is deliberately discarded
    probe.chunk_meshed()
    probe.mesh_integration(3.6)
    probe.chunk_uploaded(2 * 1024 * 1024)
    probe.worker_message(new Uint8Array(512))
    probe.lod_promoted()
    probe.aerial_dispatched()
    probe.gpu_culled()
    probe.frame(40, 56)
    probe.frame(30, 86)

    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('meshes+1')
    expect(lines[0]).toContain('integ 4ms')
    expect(lines[0]).toContain('uploads 2.0MB (1 chunks)')
    expect(lines[0]).toContain('msgs 1/512B')
    expect(lines[0]).toContain('lod+1')
    expect(lines[0]).toContain('aerial+1')
    expect(lines[0]).toContain('culls+1')
    expect(lines[1]).toContain('meshes+0')
    expect(lines[1]).toContain('integ 0ms')
    expect(lines[1]).toContain('uploads 0B (0 chunks)')
  })

  test('matches observer-before-frame delivery and emits one line, not a duplicate watchdog line', () => {
    /** @type {string[]} */
    const lines = []
    /** @type {(entry: PerformanceEntry) => void} */
    let emit = () => {}
    const probe = create_hitch_probe({
      search: '?hitch=1',
      log: (line) => lines.push(line),
      observe: (callback) => {
        emit = callback
        return () => {}
      },
    })
    probe.frame(16, 16)
    probe.chunk_meshed()
    emit(entry(20, 35))
    probe.frame(40, 56)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('[hitch] 40ms')
    expect(lines[0]).toContain('meshes+1')
  })

  test('matches delayed observer delivery to retained snapshots without duplicating a watchdog report', () => {
    /** @type {string[]} */
    const lines = []
    /** @type {(entry: PerformanceEntry) => void} */
    let emit = () => {}
    const probe = create_hitch_probe({
      search: '?hitch=1',
      log: (line) => lines.push(line),
      observe: (callback) => {
        emit = callback
        return () => {}
      },
    })
    probe.frame(16, 16)
    probe.frame(50, 66)
    emit(entry(20, 35))
    expect(lines).toHaveLength(1)
  })

  test('longtask observer can report a retained interval below the frame-watchdog threshold', () => {
    /** @type {string[]} */
    const lines = []
    /** @type {(entry: PerformanceEntry) => void} */
    let emit = () => {}
    const probe = create_hitch_probe({
      search: '?hitch=1',
      log: (line) => lines.push(line),
      observe: (callback) => {
        emit = callback
        return () => {}
      },
    })
    probe.frame(16, 16)
    probe.frame(20, 36)
    expect(lines).toHaveLength(0)
    emit(entry(18, 30))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('[hitch] 30ms')
  })

  test('wraps and restores three backend pipeline creation hooks', () => {
    /** @type {string[]} */
    const lines = []
    const backend = {
      createRenderPipeline: () => 'render',
      createComputePipeline: () => 'compute',
    }
    const original_render = backend.createRenderPipeline
    const probe = create_hitch_probe({ search: '?hitch=1', log: (line) => lines.push(line), observe: () => () => {} })
    probe.watch_renderer({ backend })
    probe.frame(16, 16)
    expect(backend.createRenderPipeline()).toBe('render')
    expect(backend.createComputePipeline()).toBe('compute')
    probe.frame(30, 46)
    expect(lines[0]).toContain('pipelines+2')
    probe.dispose()
    expect(backend.createRenderPipeline).toBe(original_render)
  })

  test('counts device-level texture pipelines without double-counting backend calls', () => {
    /** @type {string[]} */
    const lines = []
    const device = {
      createRenderPipeline: () => 'render',
      createRenderPipelineAsync: async () => 'render-async',
      createComputePipeline: () => 'compute',
      createComputePipelineAsync: async () => 'compute-async',
    }
    const original_render = device.createRenderPipeline
    const backend = {
      device,
      createRenderPipeline: () => device.createRenderPipeline(),
      createComputePipeline: () => device.createComputePipeline(),
    }
    const probe = create_hitch_probe({ search: '?hitch=1', log: (line) => lines.push(line), observe: () => () => {} })
    probe.watch_renderer({ backend })
    probe.frame(16, 16)
    backend.createRenderPipeline() // one device call, not backend + device double-counting
    device.createRenderPipeline() // direct texture-transfer pipeline
    backend.createComputePipeline()
    probe.frame(30, 46)
    expect(lines[0]).toContain('pipelines+3')
    probe.dispose()
    expect(device.createRenderPipeline).toBe(original_render)
  })

  test('exposes cumulative sync-vs-async pipeline creation counts behind the hitch flag', async () => {
    const device = {
      createRenderPipeline: () => 'render',
      createRenderPipelineAsync: async () => 'render-async',
      createComputePipeline: () => 'compute',
      createComputePipelineAsync: async () => 'compute-async',
    }
    const probe = create_hitch_probe({ search: '?hitch=1', observe: () => () => {} })
    probe.watch_renderer({ backend: { device } })
    device.createRenderPipeline()
    await device.createRenderPipelineAsync()
    device.createComputePipeline()
    await device.createComputePipelineAsync()
    expect(probe.pipeline_creation_counts()).toEqual({ sync: 2, async: 2 })
    probe.dispose()
  })

  test('[C1] names the pipeline variants compiled inside a hitch frame (descriptor labels in the report)', () => {
    /** @type {string[]} */
    const lines = []
    const device = {
      createRenderPipeline: (/** @type {{label?: string}} */ _descriptor) => 'render',
      createComputePipeline: () => 'compute',
    }
    const probe = create_hitch_probe({ search: '?hitch=1', log: (line) => lines.push(line), observe: () => () => {} })
    probe.watch_renderer({ backend: { device } })
    probe.frame(16, 16)
    device.createRenderPipeline({ label: 'renderPipeline_MeshStandardNodeMaterial_42' })
    device.createRenderPipeline({ label: 'renderPipeline_terrain_solid_7' })
    probe.frame(120, 136)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('pipelines+2')
    expect(lines[0]).toContain('renderPipeline_MeshStandardNodeMaterial_42')
    expect(lines[0]).toContain('renderPipeline_terrain_solid_7')
    probe.dispose()
  })

  test('[C1] caps the per-frame label list and reports the overflow count, then resets next frame', () => {
    /** @type {string[]} */
    const lines = []
    const device = { createRenderPipeline: (/** @type {{label?: string}} */ _d) => 'render' }
    const probe = create_hitch_probe({ search: '?hitch=1', log: (line) => lines.push(line), observe: () => () => {} })
    probe.watch_renderer({ backend: { device } })
    probe.frame(16, 16)
    for (let i = 0; i < 20; i += 1) device.createRenderPipeline({ label: `p_${i}` })
    probe.frame(120, 136)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('p_0')
    expect(lines[0]).toContain('p_15')
    expect(lines[0]).not.toContain('p_16') // capped at 16 named labels
    expect(lines[0]).toContain('+4 more')
    device.createRenderPipeline({ label: 'p_next_frame' })
    probe.frame(120, 256)
    expect(lines).toHaveLength(2)
    expect(lines[1]).not.toContain('p_0') // label list reset with the counters
    expect(lines[1]).toContain('p_next_frame')
    probe.dispose()
  })
})

describe('CPU probe rolling attribution', () => {
  test('has zero registrations, sampling, and timers when the flag is off', () => {
    let observe_calls = 0
    let listener_calls = 0
    let memory_calls = 0
    let emit_calls = 0
    const probe = create_cpu_probe({
      search: '',
      observe: () => {
        observe_calls += 1
        return () => {}
      },
      event_target: /** @type {EventTarget} */ (
        /** @type {unknown} */ ({
          addEventListener: () => {
            listener_calls += 1
          },
          removeEventListener: () => {},
          dispatchEvent: () => true,
        })
      ),
      read_memory: () => {
        memory_calls += 1
        return 0
      },
      emit: () => {
        emit_calls += 1
      },
    })

    expect(probe).toBe(null)
    expect({ observe_calls, listener_calls, memory_calls, emit_calls }).toEqual({
      observe_calls: 0,
      listener_calls: 0,
      memory_calls: 0,
      emit_calls: 0,
    })
  })

  test('unions overlapping work and emits per-system, heap, worker, and long-task signals', () => {
    /** @type {(entry:PerformanceEntry)=>void} */
    let emit_longtask = () => {}
    /** @type {(event:Event)=>void} */
    let emit_span = () => {}
    let disconnected = 0
    let listener_removed = 0
    let clock = 0
    let memory = 100 * 1024 * 1024
    /** @type {Record<string, any>[]} */
    const samples = []
    const event_target = /** @type {EventTarget} */ (
      /** @type {unknown} */ ({
        addEventListener(/** @type {string} */ _name, /** @type {EventListenerOrEventListenerObject} */ callback) {
          emit_span = /** @type {(event:Event)=>void} */ (callback)
        },
        removeEventListener() {
          listener_removed += 1
        },
        dispatchEvent: () => true,
      })
    )
    const probe = create_cpu_probe({
      search: '?cpu=1',
      now: () => clock,
      observe: (callback) => {
        emit_longtask = callback
        return () => {
          disconnected += 1
        }
      },
      event_target,
      read_memory: () => memory,
      emit: (sample) => samples.push(sample),
    })
    expect(probe).not.toBe(null)
    if (!probe) throw new Error('cpu probe did not enable')

    emit_span(
      /** @type {Event} */ (
        /** @type {unknown} */ ({
          detail: { system: 'react', start_ms: 20, end_ms: 25 },
        })
      )
    )
    emit_span(/** @type {Event} */ (/** @type {unknown} */ ({ detail: { system: 'p2p', start_ms: 30, end_ms: 32 } })))
    emit_span(
      /** @type {Event} */ (/** @type {unknown} */ ({ detail: { system: 'scene', start_ms: 1_002, end_ms: 1_003 } }))
    )
    emit_longtask(entry(40, 50))
    clock = 100
    probe.worker_message(new Uint8Array(1024 * 1024))
    memory += 1024 * 1024
    probe.frame({ start_ms: 1_000, render_start_ms: 1_004, render_end_ms: 1_008, end_ms: 1_010, frame_ms: 16 })

    expect(samples).toHaveLength(1)
    expect(samples[0].engine_ms).toBe(6)
    expect(samples[0].render_ms).toBe(4)
    expect(samples[0].scene_ms).toBe(1)
    expect(samples[0].react_ms).toBe(5)
    expect(samples[0].p2p_ms).toBe(2)
    expect(samples[0].longtask_count).toBe(1)
    expect(samples[0].heap_growth_mb).toBe(1)
    expect(samples[0].worker_mb_s).toBeGreaterThan(0.9)
    expect(samples[0].main_util_pct).toBeCloseTo((67 / 1010) * 100, 5)

    probe.dispose()
    expect(disconnected).toBe(1)
    expect(listener_removed).toBe(1)
  })

  test('reports heap counters as unavailable when the browser exposes no memory API', () => {
    /** @type {Record<string, any>[]} */
    const samples = []
    const probe = create_cpu_probe({
      search: '?cpu=1',
      now: () => 0,
      observe: () => () => {},
      event_target: null,
      read_memory: () => null,
      emit: (sample) => samples.push(sample),
    })
    if (!probe) throw new Error('cpu probe did not enable')

    probe.frame({ start_ms: 0, render_start_ms: 2, render_end_ms: 4, end_ms: 1_000, frame_ms: 16 })

    expect(samples[0].heap_growth_mb).toBe(null)
    expect(samples[0].gc_drop_mb).toBe(null)
  })
})
