// [C1 SLICED PIPELINE COMPILE] Unit contract for the frame-budgeted pipeline warm queue — the D221-class
// warm generalized to LATE-ARRIVING renderables (entity/avatar/cosmetic GLBs). House law (engine.js D1
// SHADER-DIET): only the REAL render path compiles the pipelines the live frame reuses (a depth-0
// renderer.compileAsync forges duplicate RenderObjects/WGSL), so the queue mounts each queued root INTO
// the scene for exactly one rendered frame — epsilon-scaled (never scale 0: a zero world matrix puts
// every vertex at clip w=0, the far-warmer zero-AREA lesson) and culling-forced-off — then releases it
// and resolves. ≤1 entry mounts per tick (the slice: one first-use compile burst per frame, never a
// 5s wedge); flush_all() batches every pending entry into the D221 boot warm frame (behind the veil).
import { describe, expect, test } from 'bun:test'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene } from 'three'

import {
  clear_active_pipeline_warm_queue,
  create_pipeline_warm_queue,
  set_active_pipeline_warm_queue,
  warm_pipelines_once,
} from './pipeline_warm_queue.js'

/** Minimal detached rig: a Group with one castShadow mesh, culling ON so restore is observable. */
function make_rig() {
  const root = new Group()
  const mesh = new Mesh(new BoxGeometry(1, 2, 1), new MeshStandardMaterial())
  mesh.castShadow = true
  mesh.frustumCulled = true
  root.add(mesh)
  root.scale.setScalar(0.5) // a meaningful prepared scale — must survive the warm round-trip exactly
  return { root, mesh }
}

function make_queue() {
  const scene = new Scene()
  let shadow_requests = 0
  const queue = create_pipeline_warm_queue({
    scene,
    request_shadow_update: () => {
      shadow_requests += 1
    },
  })
  return { scene, queue, shadow_count: () => shadow_requests }
}

describe('pipeline_warm_queue — sliced real-render pipeline warm (C1)', () => {
  test('warm() queues without touching the scene; the next tick mounts epsilon-scaled with culling off + a shadow request', () => {
    const { scene, queue, shadow_count } = make_queue()
    const { root, mesh } = make_rig()
    let resolved = false
    queue.warm(root).then(() => {
      resolved = true
    })
    expect(scene.children.length).toBe(0) // queued, not mounted — the mount belongs to the frame tick
    queue.tick()
    expect(scene.children).toContain(root) // mounted for THIS frame's render
    expect(root.scale.x).toBeGreaterThan(0) // never scale 0 (clip-w0 hazard)
    expect(root.scale.x).toBeLessThan(1e-4) // but degenerate — zero pixels rasterize
    expect(mesh.frustumCulled).toBe(false) // forced: an origin-parked warm mesh must not be culled out of the compile
    expect(shadow_count()).toBe(1) // the caster's shadow-depth pipeline compiles in the SAME warm frame
    expect(resolved).toBe(false) // not resolved until its warm frame has rendered
    queue.dispose()
  })

  test('the tick after the warm frame releases: scene emptied, scale + culling restored exactly, promise resolved', async () => {
    const { scene, queue } = make_queue()
    const { root, mesh } = make_rig()
    const done = queue.warm(root)
    queue.tick() // mount (frame N renders the warm rig)
    queue.tick() // release (frame N+1)
    expect(scene.children.length).toBe(0)
    expect(root.parent).toBe(null) // detached again — the caller mounts it for real
    expect(root.scale.x).toBeCloseTo(0.5, 10) // the prepared scale survives byte-exact
    expect(mesh.frustumCulled).toBe(true) // restored to the rig's own policy
    await done // resolved — consumer may now mount with every pipeline warm
    queue.dispose()
  })

  test('the slice law: at most ONE queued entry mounts per tick', () => {
    const { scene, queue } = make_queue()
    const a = make_rig()
    const b = make_rig()
    queue.warm(a.root)
    queue.warm(b.root)
    queue.tick()
    expect(scene.children).toContain(a.root)
    expect(scene.children).not.toContain(b.root) // b waits its own frame
    queue.tick()
    expect(scene.children).not.toContain(a.root) // a released
    expect(scene.children).toContain(b.root) // b mounted
    queue.tick()
    expect(scene.children.length).toBe(0)
    queue.dispose()
  })

  test('warm_once dedupes by key: one mount total, the second caller rides the first warm', async () => {
    const { scene, queue } = make_queue()
    const first = make_rig()
    const second = make_rig()
    const p1 = queue.warm_once('glb:rabbit', first.root)
    const p2 = queue.warm_once('glb:rabbit', second.root)
    queue.tick()
    expect(scene.children).toContain(first.root)
    expect(scene.children).not.toContain(second.root) // deduped — never queued
    queue.tick()
    await p1
    await p2 // both resolve off the single warm
    expect(scene.children.length).toBe(0)
    queue.dispose()
  })

  test('flush_all mounts EVERY pending entry into the same (boot warm) frame; the next tick releases them all', async () => {
    const { scene, queue } = make_queue()
    const a = make_rig()
    const b = make_rig()
    const pa = queue.warm(a.root)
    const pb = queue.warm(b.root)
    queue.flush_all()
    expect(scene.children).toContain(a.root)
    expect(scene.children).toContain(b.root) // batched behind the veil — the D221 warm frame is free
    queue.tick()
    expect(scene.children.length).toBe(0)
    await pa
    await pb
    queue.dispose()
  })

  test('dispose releases mounted entries, restores their state, and resolves every pending promise', async () => {
    const { scene, queue } = make_queue()
    const mounted = make_rig()
    const pending = make_rig()
    const pm = queue.warm(mounted.root)
    queue.tick() // mounted.root is in the scene
    const pp = queue.warm(pending.root) // still queued
    queue.dispose()
    expect(scene.children.length).toBe(0)
    expect(mounted.root.scale.x).toBeCloseTo(0.5, 10)
    expect(mounted.mesh.frustumCulled).toBe(true)
    await pm // best-effort: a torn-down engine must never hang a consumer await
    await pp
  })

  test('module registry: no active queue ⇒ warm_pipelines_once resolves immediately (tests/headless unaffected)', async () => {
    set_active_pipeline_warm_queue(null)
    const { root } = make_rig()
    await warm_pipelines_once('glb:free', root) // resolves without any tick driving it
    expect(root.parent).toBe(null)
  })

  test("module registry: a stale session's conditional clear never clobbers the replacement session's queue", () => {
    const old_session = make_queue()
    const new_session = make_queue()
    set_active_pipeline_warm_queue(new_session.queue) // tier-swap reboot registered its queue first
    clear_active_pipeline_warm_queue(old_session.queue) // the OLD session's late teardown
    const { root } = make_rig()
    warm_pipelines_once('glb:survivor', root)
    new_session.queue.tick()
    expect(new_session.scene.children).toContain(root) // the live queue still receives warms
    new_session.queue.dispose()
    clear_active_pipeline_warm_queue(new_session.queue)
    old_session.queue.dispose()
  })

  test('module registry: an active queue receives warm_pipelines_once; a NEW queue gets a fresh dedupe set', async () => {
    const first = make_queue()
    set_active_pipeline_warm_queue(first.queue)
    const rig_a = make_rig()
    const pa = warm_pipelines_once('glb:wolf', rig_a.root)
    first.queue.tick()
    expect(first.scene.children).toContain(rig_a.root)
    first.queue.tick()
    await pa
    first.queue.dispose()
    set_active_pipeline_warm_queue(null)

    // a fresh session (new renderer = pipelines gone) must re-warm the same key
    const second = make_queue()
    set_active_pipeline_warm_queue(second.queue)
    const rig_b = make_rig()
    const pb = warm_pipelines_once('glb:wolf', rig_b.root)
    second.queue.tick()
    expect(second.scene.children).toContain(rig_b.root) // NOT deduped across queue lifetimes
    second.queue.tick()
    await pb
    second.queue.dispose()
    set_active_pipeline_warm_queue(null)
  })
})
