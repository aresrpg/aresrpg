// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { EnginePresentation, EngineQuality, QualityProfile } from './types.ts'

export const QUALITY_OPTIONS = Object.freeze(['low', 'medium', 'high'] as const)

export const QUALITY_PROFILES = Object.freeze({
  low: Object.freeze({
    name: 'low',
    render: Object.freeze({ scale: 0.75, scene_scale: 0.88, sharpness: 0.45, dpr_max: 1, pixel_max: 1_500_000 }),
    chunks: Object.freeze({
      near_radius: 1,
      mid_radius: 2,
      far_radius: 3,
      evict_per_frame: 4,
      request_per_frame: 2,
      max_in_flight: 4,
      upload_bytes_per_frame: 131_072,
      upload_time_ms: 1,
      horizon_radius: 640,
      horizon_step: 32,
    }),
    sky: 'low',
    terrain: Object.freeze({ kind: 'flat', texture_size: 16 }),
    fog: Object.freeze({ near: 200, far: 640 }),
    shadows: Object.freeze({ kind: 'none', map_size: 0 }),
    effects: Object.freeze({ bloom: null, sun_shafts: null }),
  }),
  medium: Object.freeze({
    name: 'medium',
    render: Object.freeze({ scale: 0.9, scene_scale: 0.82, sharpness: 0.5, dpr_max: 1.5, pixel_max: 3_500_000 }),
    chunks: Object.freeze({
      near_radius: 2,
      mid_radius: 4,
      far_radius: 6,
      evict_per_frame: 8,
      request_per_frame: 4,
      max_in_flight: 8,
      upload_bytes_per_frame: 524_288,
      upload_time_ms: 2,
      horizon_radius: 1200,
      horizon_step: 24,
    }),
    sky: 'medium',
    terrain: Object.freeze({ kind: 'lit', texture_size: 32 }),
    fog: Object.freeze({ near: 250, far: 1000 }),
    shadows: Object.freeze({ kind: 'basic', map_size: 1024 }),
    effects: Object.freeze({ bloom: null, sun_shafts: null }),
  }),
  high: Object.freeze({
    name: 'high',
    render: Object.freeze({ scale: 1, scene_scale: 1, sharpness: null, dpr_max: 2, pixel_max: 6_000_000 }),
    chunks: Object.freeze({
      near_radius: 3,
      mid_radius: 6,
      far_radius: 11,
      evict_per_frame: 12,
      request_per_frame: 6,
      max_in_flight: 12,
      upload_bytes_per_frame: 1_048_576,
      upload_time_ms: 3,
      horizon_radius: 1900,
      horizon_step: 16,
    }),
    sky: 'high',
    terrain: Object.freeze({ kind: 'pbr', texture_size: 32 }),
    fog: Object.freeze({ near: 500, far: 1750 }),
    shadows: Object.freeze({ kind: 'soft', map_size: 2048 }),
    effects: Object.freeze({
      bloom: Object.freeze({ strength: 0.18, radius: 0.65, threshold: 1.6 }),
      sun_shafts: Object.freeze({
        samples: 24,
        resolution: 0.4,
        density: 0.72,
        decay: 0.93,
        strength: 0.12,
        threshold: 1.45,
      }),
    }),
  }),
} satisfies Readonly<Record<EngineQuality, QualityProfile>>)

// THE one door every consumer derives the effective chunk radius from — the player's
// render-distance override wins over the tier default, for voxels AND the far shell alike.
export const effective_render_distance = (tier_far_radius: number, override: number | null): number =>
  override ?? tier_far_radius

export const get_quality_profile = (quality: EngineQuality): QualityProfile => QUALITY_PROFILES[quality]

export const uses_world_post_processing = (quality: EngineQuality, presentation: EnginePresentation): boolean =>
  presentation === 'world' && quality !== 'low'

export const quality_pixel_ratio = ({
  quality,
  css_width,
  css_height,
  device_pixel_ratio,
  presentation = 'world',
}: Readonly<{
  quality: EngineQuality
  css_width: number
  css_height: number
  device_pixel_ratio: number
  presentation?: EnginePresentation
}>): number => {
  const { scale, dpr_max, pixel_max } = get_quality_profile(quality).render
  const fight_dpr_max = quality === 'low' ? 1 : quality === 'medium' ? 1.5 : 2
  const requested =
    presentation === 'fight'
      ? Math.min(device_pixel_ratio, fight_dpr_max) * (quality === 'low' ? 0.66 : 1)
      : Math.min(device_pixel_ratio, dpr_max) * scale
  const pixel_limit = Math.sqrt(pixel_max / Math.max(1, css_width * css_height))
  return Math.min(requested, pixel_limit)
}
