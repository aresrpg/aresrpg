// S1 device-detection unit tests. pick_starting_tier is a PURE classifier over injected DetectSignals
// (no GPU / navigator needed), so it tests deterministically with synthetic signals. The behavior the
// owner GO'd (2026-07-14): mobile FLOORS to 'low' regardless of adapter strength; scarce RAM biases down;
// a very dense panel caps a desktop 'high' at 'medium'; no-WebGPU / fallback adapter → 'low'.

import { test, expect, describe } from 'bun:test'

import { pick_starting_tier } from './detect.js'

/** A beefy-desktop baseline signal (scores 'high') that individual tests override field-by-field. */
const beefy = () => ({
  vendor: 'nvidia',
  architecture: 'ada',
  is_fallback_adapter: false,
  max_buffer_size_bytes: 2 << 30,
  max_storage_buffer_binding_bytes: 2 << 30,
  hardware_concurrency: 16,
  device_memory_gb: 16,
  is_ios: false,
  is_mobile: false,
  device_pixel_ratio: 1,
  has_webgpu: true,
})

describe('pick_starting_tier', () => {
  test('no WebGPU → low', () => {
    expect(pick_starting_tier({ ...beefy(), has_webgpu: false })).toBe('low')
  })

  test('fallback (software) adapter → low', () => {
    expect(pick_starting_tier({ ...beefy(), is_fallback_adapter: true })).toBe('low')
  })

  test('a beefy dGPU desktop → high', () => {
    expect(pick_starting_tier(beefy())).toBe('high')
  })

  test('OWNER FLOOR: mobile → low even with a strong adapter', () => {
    // A phone reporting a strong-looking adapter must still boot at the floor ("low low low then adapt").
    expect(pick_starting_tier({ ...beefy(), is_mobile: true })).toBe('low')
    // iOS implies mobile — also low (supersedes the old iOS→medium ceiling).
    expect(pick_starting_tier({ ...beefy(), is_ios: true, is_mobile: true })).toBe('low')
  })

  test('scarce RAM (≤4 GB) biases the pick down', () => {
    // Same machine, only deviceMemory scarce: the −1 pulls it off the top rung.
    const scarce = { ...beefy(), device_memory_gb: 4 }
    expect(pick_starting_tier(scarce)).not.toBe('high')
  })

  test('DPR ≥ 3 caps a desktop high at medium; DPR 2 does not', () => {
    expect(pick_starting_tier({ ...beefy(), device_pixel_ratio: 3 })).toBe('medium')
    expect(pick_starting_tier({ ...beefy(), device_pixel_ratio: 2 })).toBe('high')
  })

  test('integrated Intel laptop → conservative (not high)', () => {
    const intel = {
      ...beefy(),
      vendor: 'intel',
      architecture: 'gen12',
      hardware_concurrency: 8,
      device_memory_gb: 8,
      max_storage_buffer_binding_bytes: 0,
    }
    expect(pick_starting_tier(intel)).not.toBe('high')
  })
})
