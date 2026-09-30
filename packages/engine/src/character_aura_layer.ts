// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  type Camera,
  type Scene,
  type Vector3,
} from 'three'

import { CHARACTER_HEIGHT } from './character_model.ts'
import { character_entity_scale } from './entities.ts'
import { create_character_aura_material } from './character_aura_material.ts'
import { advance_aura_trail, AURA_TRAIL_LIFETIME, AURA_TRAIL_LIMIT, type AuraTrail } from './character_aura_motion.ts'
import type { CharacterEntityRender, EngineQuality, EntityRender, Vec3 } from './types.ts'

const CAPACITY = 256
const QUALITY = {
  low: { range: 32, particles: 4 },
  medium: { range: 48, particles: 8 },
  high: { range: 64, particles: 12 },
} as const
const phase_of = (id: string): number =>
  ([...id].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 0) % 997) / 997
const eligible = (spec: EntityRender): spec is CharacterEntityRender =>
  spec.kind === 'character' && spec.aura !== undefined && spec.visible !== false && !spec.visual_effect

const create_batch = (kind: 'shell' | 'mote' | 'haze', capacity: number) => {
  const plane = new PlaneGeometry(1, 1)
  const geometry = new InstancedBufferGeometry()
  geometry.index = plane.index
  geometry.attributes = plane.attributes
  geometry.instanceCount = 0
  const centers = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
  const sizes = new InstancedBufferAttribute(new Float32Array(capacity), 1)
  const phases = new InstancedBufferAttribute(new Float32Array(capacity), 1)
  const ages = new InstancedBufferAttribute(new Float32Array(capacity), 1)
  geometry.setAttribute('aura_center', centers)
  geometry.setAttribute('aura_size', sizes)
  geometry.setAttribute('aura_phase', phases)
  geometry.setAttribute('aura_age', ages)
  const profiles = new InstancedBufferAttribute(new Float32Array(capacity), 1)
  geometry.setAttribute('aura_profile', profiles)
  const material = create_character_aura_material(kind)
  const mesh = new Mesh(geometry, material)
  mesh.name = `character-aura:${kind}`
  mesh.visible = false
  mesh.frustumCulled = false
  mesh.renderOrder = 1
  plane.dispose()
  return {
    mesh,
    write: (index: number, point: Vec3, size: number, phase: number, age: number, profile: number) => {
      centers.setXYZ(index, ...point)
      sizes.setX(index, size)
      phases.setX(index, phase)
      ages.setX(index, age)
      profiles.setX(index, profile)
    },
    flush: (count: number) => {
      geometry.instanceCount = count
      mesh.visible = count > 0
      for (const buffer of [centers, sizes, phases, ages, profiles]) {
        buffer.clearUpdateRanges()
        if (count) buffer.addUpdateRange(0, count * buffer.itemSize)
        buffer.needsUpdate = true
      }
    },
    dispose: () => {
      geometry.dispose()
      material.dispose()
    },
  }
}

type Anchors = Readonly<{
  world_anchor: (id: string) => Vector3 | null
  entity_height: (id: string) => number | null
}>

/** Bounded shared energy, trail and admin haze batches follow existing world/crowd/fight entities. No model attachment or network state. */
export const create_character_aura_layer = (
  scene: Scene,
  camera: Camera,
  anchors: Anchors,
  initial_quality: EngineQuality
) => {
  const shell = create_batch('shell', CAPACITY)
  const motes = create_batch('mote', CAPACITY * AURA_TRAIL_LIMIT)
  const haze = create_batch('haze', CAPACITY)
  haze.mesh.renderOrder = 0
  scene.add(shell.mesh, motes.mesh, haze.mesh)
  let specs: readonly CharacterEntityRender[] = []
  let quality = initial_quality
  const trails = new Map<string, AuraTrail>()

  const sample = (spec: CharacterEntityRender): Readonly<{ point: Vec3; height: number }> | null => {
    const rendered_height = anchors.entity_height(spec.id)
    if (rendered_height === null) return null
    const height = CHARACTER_HEIGHT * character_entity_scale(spec.anchor.kind)
    if (spec.anchor.kind === 'world') return { point: spec.anchor.position, height }
    const crown = anchors.world_anchor(spec.id)
    return crown ? { point: [crown.x, crown.y - rendered_height, crown.z], height } : null
  }

  return {
    set: (next: readonly EntityRender[]) => {
      specs = next.filter(eligible)
      const retained = new Set(specs.map(({ id }) => id))
      for (const id of trails.keys()) if (!retained.has(id)) trails.delete(id)
      if (!specs.length) {
        shell.flush(0)
        motes.flush(0)
        haze.flush(0)
      }
    },
    set_quality: (next: EngineQuality) => {
      quality = next
    },
    tick: (now: number) => {
      const settings = QUALITY[quality]
      let aura_count = 0
      let mote_count = 0
      let haze_count = 0
      for (const spec of specs) {
        const actor = sample(spec)
        if (
          !actor ||
          Math.hypot(
            actor.point[0] - camera.position.x,
            actor.point[1] - camera.position.y,
            actor.point[2] - camera.position.z
          ) > settings.range ||
          aura_count >= CAPACITY
        ) {
          trails.delete(spec.id)
          continue
        }
        const { point, height } = actor
        const scale = height / CHARACTER_HEIGHT
        const phase = phase_of(spec.id)
        const profile = Number(spec.aura === 'admin')
        const center = [point[0], point[1] + height * 0.57, point[2]] as const
        shell.write(aura_count++, center, height, phase, 0, profile)
        if (profile) haze.write(haze_count++, center, height, phase, 0, profile)
        const trail = advance_aura_trail(trails.get(spec.id), point, now, scale)
        trails.set(spec.id, trail)
        for (const particle of trail.particles.slice(-settings.particles)) {
          const age = (now - particle.born) / AURA_TRAIL_LIFETIME
          const seed = particle.serial + phase * 100
          motes.write(
            mote_count++,
            [
              particle.position[0] + Math.sin(seed * 13) * 0.16 * scale,
              particle.position[1] + (0.2 + (seed % 5) * 0.15 + age * 0.35) * scale,
              particle.position[2] + Math.cos(seed * 17) * 0.16 * scale,
            ],
            (0.07 + (seed % 3) * 0.025) * scale,
            (phase + particle.serial * 0.618) % 1,
            age,
            profile
          )
        }
      }
      shell.flush(aura_count)
      motes.flush(mote_count)
      haze.flush(haze_count)
    },
    stats: () => ({
      auras: shell.mesh.geometry.instanceCount,
      particles: motes.mesh.geometry.instanceCount,
      tracked: trails.size,
      haze: haze.mesh.geometry.instanceCount,
    }),
    dispose: () => {
      scene.remove(shell.mesh, motes.mesh, haze.mesh)
      shell.dispose()
      motes.dispose()
      haze.dispose()
      trails.clear()
      specs = []
    },
  }
}
