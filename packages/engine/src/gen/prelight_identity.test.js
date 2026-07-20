import { describe, expect, test } from 'bun:test'

import { fill_simple_light } from '../chunks/light_engine.js'

import { build_column_profile, create_gen_context, fill_chunk_from_profile } from './column_gen.js'
import { decorate_chunk } from './surface_decorator.js'

describe('decorated generation lights only final voxels', () => {
  test('skipping the dead pre-decoration flood leaves final ids and light byte-identical', () => {
    const ctx = create_gen_context()
    const [cx, cy, cz] = [-4, 4, 0]
    const profile = build_column_profile(ctx, cx, cz)

    const old_path = fill_chunk_from_profile(ctx, profile, cx, cy, cz)
    expect(old_path.light.some((value) => value !== 0)).toBe(true)
    decorate_chunk(old_path, profile, cx, cy, cz, ctx.seeds.decorators, ctx)
    fill_simple_light(old_path)

    const optimized = fill_chunk_from_profile(ctx, profile, cx, cy, cz, false)
    expect(optimized.light.every((value) => value === 0)).toBe(true)
    decorate_chunk(optimized, profile, cx, cy, cz, ctx.seeds.decorators, ctx)
    fill_simple_light(optimized)

    expect(optimized.ids).toEqual(old_path.ids)
    expect(optimized.light).toEqual(old_path.light)
  })
})
