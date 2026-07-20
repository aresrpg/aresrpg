// P0 STORAGE-BINDING GATE (QA F2 / B2) — the HIGH-tier tab-crash fix, proven on the real Metal GPU.
//
// ROOT CAUSE: core/renderer.js requested only maxTextureArrayLayers at WebGPU device creation, so the
// device kept the DEFAULT maxStorageBufferBindingSize (128 MiB). The densest terrain pool (HIGH r8 solid)
// is ONE storage buffer of ~138 MiB > 128 MiB → the storage bind group is invalid → GPUValidationError →
// the tab CRASHES on a HIGH boot. FIX: request maxStorageBufferBindingSize sized to max_pool_storage_bytes
// (clamped to the adapter), so the buffer binds. This gate boots the demo at HIGH, reads the GRANTED
// storage limit the device actually got, and asserts (1) granted ≥ the pool needs, (2) ZERO GPU
// validation / device-lost errors after terrain streams and the pool mesh renders.
//
// HEADED on the Studio's Metal GPU (playwright.config.js) — the only path that exposes a hardware adapter;
// a headless Mac run falls back to software and the pool limits would be meaningless. ONE browser.

import { expect, test } from '@playwright/test'

import { max_pool_storage_bytes } from '../src/render/pool_renderer.js'

import { attach_gpu_error_watcher, goto_demo, probe_gpu_adapter } from './harness.js'

test('HIGH tier: device grants a storage-binding limit ≥ the terrain pool, no GPU errors', async ({ page }) => {
  const needed = max_pool_storage_bytes('high')

  // Collect every renderer boot line so the assertion reads the device's ACTUAL granted limit, not a guess.
  /** @type {string[]} */
  const renderer_lines = []
  page.on('console', (message) => {
    const text = message.text()
    if (text.includes('[renderer]')) renderer_lines.push(text)
  })
  const gpu = attach_gpu_error_watcher(page)

  await goto_demo(page, { tier: 'high', timeout_ms: 45_000 })

  // Real hardware adapter (not SwiftShader) — else the storage limits are software defaults, not a proof.
  const adapter = await probe_gpu_adapter(page)
  expect(adapter.ok, `hardware adapter required: ${adapter.reason ?? ''}`).toBe(true)

  // Let terrain stream in and the pool mesh render a few frames — the 138 MiB storage buffer binds on the
  // first pool draw, so any binding-size validation error surfaces here, not at construction.
  await page.evaluate(async () => {
    for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r))
  })

  // The GRANTED runtime-provenance line renderer.js logs post-init: "storage-binding GRANTED=<n> B · pool
  // needs <m> B · tier high · OK". Parse the granted bytes and assert the device met the pool's need.
  const granted_line = renderer_lines.find((l) => l.includes('storage-binding GRANTED='))
  expect(granted_line, `no GRANTED line — renderer lines:\n${renderer_lines.join('\n')}`).toBeTruthy()
  const granted = Number(/GRANTED=(\d+)/.exec(granted_line ?? '')?.[1])
  console.log(`[gate] ${granted_line}`)
  console.log(`[gate] request line: ${renderer_lines.find((l) => l.includes('terrain pool storage')) ?? '(none)'}`)
  expect(granted).toBeGreaterThanOrEqual(needed)
  expect(granted_line).toContain('· OK')

  // The whole point: no storage-binding validation error, no device loss across the HIGH boot + render.
  expect(gpu.errors, `GPU errors after HIGH boot:\n${gpu.errors.join('\n')}`).toEqual([])
})
