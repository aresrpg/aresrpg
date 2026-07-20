// Lifecycle regression for the LOGOUT crash: "THREE.WebGPUTextureUtils: Texture already initialized",
// thrown uncaught (and repeating) from clouds.refresh_shadow after the voxel world was torn down. Root
// cause: a disposed subsystem stayed reachable from a live time-of-day ticker — on logout the renderer is
// disposed but a late `set_time_of_day` poke still walked engine → atmosphere.on_time_of_day →
// clouds.refresh_shadow, which `computeAsync`'d the dead renderer. The house two-phase-dispose law: STOP
// the ticker reaching the GPU first, RELEASE the GPU second. These tests pin BOTH halves with a fake
// renderer (no real WebGPU needed — the TSL kernels build CPU-side; only compute submission is faked).

import { test, expect, describe } from 'bun:test'

import { create_clouds } from './clouds.js'

/** A renderer test double that records every compute submission — the ONLY thing a disposed clouds must
 *  never do. `.computeAsync`/`.compute` are the exact surface clouds.bake/refresh_shadow/tick drive. */
function fake_renderer() {
  const calls = []
  return {
    calls,
    computeAsync: async (k) => {
      calls.push(k?.name ?? '?')
    },
    compute: (k) => {
      calls.push(k?.name ?? '?')
    },
  }
}

describe('clouds dispose — the disposed subsystem is unreachable from the ticker (logout crash)', () => {
  test('refresh_shadow is LIVE before dispose, INERT + throw-free after', async () => {
    const clouds = create_clouds({}) // self-contained defaults (no sky/sun wiring needed)
    const r = fake_renderer()
    await clouds.bake(r) // arms shadow_kernel + snapshot_kernel (the pre-logout, in-world state)

    r.calls.length = 0
    await clouds.refresh_shadow(r) // in-world: the ticker legitimately re-bakes the shadow map
    expect(r.calls.length).toBeGreaterThan(0) // proves the path we must neutralize is genuinely active

    clouds.dispose() // == logout teardown (atmosphere.dispose → clouds.dispose)

    r.calls.length = 0
    // The exact post-logout poke: engine.set_time_of_day → atmo.on_time_of_day → clouds.refresh_shadow.
    // Must NOT reach the (now-dead) renderer, and must NOT throw (the uncaught "already initialized").
    await expect(clouds.refresh_shadow(r)).resolves.toBeUndefined()
    expect(r.calls).toEqual([]) // zero GPU submissions on a disposed clouds
  })

  test('tick drift re-bake also goes inert after dispose (the other compute path)', async () => {
    const clouds = create_clouds({})
    const r = fake_renderer()
    await clouds.bake(r)
    clouds.dispose()

    r.calls.length = 0
    // A big dt forces past SHADOW_REBAKE_S (2.5s) + a far camera jump forces a recenter — both re-bake
    // triggers at once. On a disposed clouds neither may submit a compute.
    expect(() => clouds.tick(r, 10, [99999, 99999])).not.toThrow()
    expect(r.calls).toEqual([])
  })

  test('dispose frees the baked GPU textures (no per-logout leak)', async () => {
    const clouds = create_clouds({})
    const r = fake_renderer()
    await clouds.bake(r)

    const freed = new Set()
    for (const name of ['base_noise', 'shadow_map', 'weather_map'])
      clouds[name].addEventListener('dispose', () => freed.add(name))

    clouds.dispose()
    expect(freed).toEqual(new Set(['base_noise', 'shadow_map', 'weather_map']))
  })
})
