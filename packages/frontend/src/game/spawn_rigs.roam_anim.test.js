// RED-FIRST PROBE (2026-07-19): mobs roaming in the world were not using a walk/run
// animation — they glided without animation. This is the INSTRUMENT-BEFORE-FIX proof for create_rig_layer's
// idle↔move blend (spawn_rigs.js): loads a REAL reference-corpus mob GLB (hy_bunny — IDLE/WALK/RUN, the same
// fixture packages/engine's mob_render_parity.test.js already proves loads headless) through the REAL
// create_mob_model factory, mirrors spawn_rig's own clip-selection (spawn_rig itself is a private closure, not
// exported — these 6 lines are copied verbatim from spawn_rigs.js so drift shows up as a diff, not a silent
// skip), then drives the REAL exported `roam_member` for two seconds of "walking" and asserts the move clip's
// mixer TIME actually advances (not just that a weight number moved) — the only way to tell "playing a walk
// clip" from "frozen bind pose sliding across the ground" from outside three's render loop.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { AnimationMixer } from 'three'
import { create_mob_model } from '@aresrpg/engine3/player'

import { create_rig_layer } from './spawn_rigs.js'

const globals = /** @type {any} */ (globalThis)
const previous_create_image_bitmap = globals.createImageBitmap
const previous_progress_event = globals.ProgressEvent

// Same headless-GLTFLoader shims as packages/engine/src/tactical/mob_render_parity.test.js (the established,
// working precedent for loading a REAL creature GLB in bun:test with no browser/DOM).
beforeAll(() => {
  globals.createImageBitmap = async () => ({ width: 1, height: 1, close() {} })
  globals.ProgressEvent = class {
    constructor(/** @type {string} */ type, /** @type {Record<string, any>} */ init = {}) {
      Object.assign(this, { type, ...init })
    }
  }
})

afterAll(() => {
  if (previous_create_image_bitmap === undefined) delete globals.createImageBitmap
  else globals.createImageBitmap = previous_create_image_bitmap
  if (previous_progress_event === undefined) delete globals.ProgressEvent
  else globals.ProgressEvent = previous_progress_event
})

// packages/frontend/src/game/ → packages/frontend/public/sprites/mobs/models/hy_bunny.glb
const fixture_path = new URL('../../public/sprites/mobs/models/hy_bunny.glb', import.meta.url)

async function fixture_data_url() {
  const bytes = await Bun.file(fixture_path).arrayBuffer()
  return `data:model/gltf-binary;base64,${Buffer.from(bytes).toString('base64')}`
}

describe('roam_member — locomotion clip while a world-spawn member walks (regression: reported gliding)', () => {
  it('a real reference-corpus rig (hy_bunny: IDLE/WALK/RUN) blends the move clip to full weight AND its mixer time advances while mem.moving — proves it is playing WALK, not holding a frozen pose', async () => {
    const url = await fixture_data_url()
    const { root, clips, measured, dispose } = await create_mob_model(url, { label: 'hy_bunny:roam-anim-probe' })
    // Asset sanity — this fixture must actually carry locomotion clips or the probe proves nothing.
    expect(clips.map((c) => c.name)).toEqual(expect.arrayContaining(['IDLE', 'WALK', 'RUN']))

    // Verbatim mirror of spawn_rig's clip-selection (spawn_rigs.js create_rig_layer, ~line 138-144) — the
    // closure itself is not exported, so this is the smallest faithful copy (6 lines) rather than a mock.
    const mixer = new AnimationMixer(root)
    const idle_clip = clips.find((c) => /idle/i.test(c.name)) ?? clips[0]
    const move_clip = clips.find((c) => /run|walk|move|hop|jump/i.test(c.name)) ?? idle_clip
    const idle_action = idle_clip ? mixer.clipAction(idle_clip) : null
    const move_action = move_clip && move_clip !== idle_clip ? mixer.clipAction(move_clip) : null
    idle_action?.play()
    if (move_action) {
      move_action.play()
      move_action.weight = 0
    }
    expect(move_action).not.toBeNull() // the selection must resolve a DISTINCT move clip (WALK, here)
    expect(move_action.getClip().name).toBe('WALK') // amble picks WALK over RUN (array order — IDLE,WALK,RUN)

    const { roam_member } = create_rig_layer({
      engine: { add_to_scene() {}, remove_from_scene() {} },
      sample: () => 5, // flat ground at y=5 everywhere — feet_of() → 6
      resolve_template: () => null,
      is_disposed: () => false,
    })

    // A member already mid-walk toward a waypoint 5 blocks east — skips the probabilistic decide-timer so the
    // "moving" state is deterministic for the probe (decide_t pinned far in the future).
    const mem = {
      mrng: () => 0.99,
      ax: 0,
      az: 0,
      mx: 0,
      mz: 0,
      tx: 5,
      tz: 0,
      decide_t: 999,
      walking: true,
      moving: false,
      cell_key: '0:0',
      yaw: 0,
      rig: { root, mixer, h: measured.height, idle_action, move_action, move_w: 0 },
    }

    for (let i = 0; i < 60; i += 1) roam_member(mem, 1 / 30) // 2 simulated seconds of walking @ 30fps

    expect(mem.moving).toBe(true) // sanity: the pure wander core agrees the member is walking
    expect(mem.mx).toBeGreaterThan(0) // sanity: it actually translated (the "glide" half of the bug report)
    expect(mem.rig.move_w).toBeGreaterThan(0.9) // blended to (near) full move weight
    expect(move_action.weight).toBeGreaterThan(0.9)
    expect(idle_action.weight).toBeLessThan(0.1)
    // THE decisive assertion: a frozen/never-playing action's mixer time stays 0 forever. A REAL playing WALK
    // clip advances with wall time (mixer.update(dt) accumulates on the action internally).
    expect(move_action.time).toBeGreaterThan(0)

    dispose()
  })

  it('a static (non-moving) member holds idle at full weight — the move clip never bleeds in while standing still', async () => {
    const url = await fixture_data_url()
    const { root, clips, measured, dispose } = await create_mob_model(url, { label: 'hy_bunny:roam-anim-probe-idle' })
    const mixer = new AnimationMixer(root)
    const idle_clip = clips.find((c) => /idle/i.test(c.name)) ?? clips[0]
    const move_clip = clips.find((c) => /run|walk|move|hop|jump/i.test(c.name)) ?? idle_clip
    const idle_action = idle_clip ? mixer.clipAction(idle_clip) : null
    const move_action = move_clip && move_clip !== idle_clip ? mixer.clipAction(move_clip) : null
    idle_action?.play()
    if (move_action) {
      move_action.play()
      move_action.weight = 0
    }

    const { roam_member } = create_rig_layer({
      engine: { add_to_scene() {}, remove_from_scene() {} },
      sample: () => 5,
      resolve_template: () => null,
      is_disposed: () => false,
    })

    const mem = {
      mrng: () => 0.99,
      ax: 0,
      az: 0,
      mx: 0,
      mz: 0,
      tx: 0,
      tz: 0,
      decide_t: 999,
      walking: false, // never armed a waypoint — should stay idle the whole probe
      moving: false,
      cell_key: '0:0',
      yaw: 0,
      rig: { root, mixer, h: measured.height, idle_action, move_action, move_w: 0 },
    }

    for (let i = 0; i < 60; i += 1) roam_member(mem, 1 / 30)

    expect(mem.moving).toBe(false)
    expect(mem.rig.move_w).toBeLessThan(0.1)
    expect(idle_action.weight).toBeGreaterThan(0.9)

    dispose()
  })
})
