// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One bounded, typed particle primitive for every fight cast. It preserves the legacy choreography
// and art facts without importing its shader catalog, adapter, render loop, or per-spell machinery.

import {
  AdditiveBlending,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three'

import type { create_entity_layer } from './entities.ts'
import { FIGHT_VFX_BEAT, FIGHT_VFX_BURSTS, FIGHT_VFX_PROFILES, fight_vfx_magnitude } from './fight_vfx_presets.ts'
import type { FightPresentationCue } from './types.ts'

type EntityLayer = ReturnType<typeof create_entity_layer>
export type FightVfxAnchors = Pick<EntityLayer, 'world_anchor' | 'cell_anchor'>
type CastCue = Extract<FightPresentationCue, Readonly<{ type: 'cast' }>>
type DeathCue = Extract<FightPresentationCue, Readonly<{ type: 'death' }>>
type ParticleMode = 'gather' | 'burst' | 'remnant'
type ParticleSeed = Readonly<{ angle: number; radius: number; lift: number; size: number; phase: number }>
type ParticleEffect = Readonly<{
  mesh: InstancedMesh
  material: MeshBasicMaterial
  center: Vector3
  seeds: readonly ParticleSeed[]
  started_at: number
  duration_ms: number
  radius: number
  mode: ParticleMode
}>
type RingEffect = Readonly<{
  mesh: Mesh
  material: MeshBasicMaterial
  started_at: number
  duration_ms: number
  radius: number
}>
type Projectile = Readonly<{
  id: string
  core: Mesh
  trail: InstancedMesh
  started_at: number
  from: Vector3
  to: Vector3
  angle: number
  radius: number
  profile: (typeof FIGHT_VFX_PROFILES)[string]
  magnitude: number
  resolve: (rendered: boolean) => void
}>
type DelayedBurst = Readonly<{
  at: Vector3
  color: number
  accent: number
  radius: number
  at_ms: number
  resolve: ((rendered: boolean) => void) | null
}>

const particle_seed = (id: string, index: number): ParticleSeed => {
  let hash = 2_166_136_261
  const source = `${id}:${index}`
  for (let cursor = 0; cursor < source.length; cursor += 1)
    hash = Math.imul(hash ^ source.charCodeAt(cursor), 16_777_619) >>> 0
  const lane = (shift: number): number => ((hash >>> shift) & 255) / 255
  return Object.freeze({
    angle: lane(0) * Math.PI * 2,
    radius: 0.25 + lane(8) * 0.75,
    lift: 0.35 + lane(16) * 0.9,
    size: 0.55 + lane(24) * 0.75,
    phase: lane(4),
  })
}

const eased = (value: number): number => value * value * (3 - 2 * value)

export const create_fight_vfx = ({ scene, entities }: Readonly<{ scene: Scene; entities: FightVfxAnchors }>) => {
  const particle_geometry = new SphereGeometry(0.11, 5, 4)
  const core_geometry = new SphereGeometry(0.28, 10, 8)
  const ring_geometry = new RingGeometry(0.58, 0.76, 28)
  const particles: ParticleEffect[] = []
  const rings: RingEffect[] = []
  const projectiles: Projectile[] = []
  const delayed_bursts: DelayedBurst[] = []
  const matrix = new Matrix4()
  const position = new Vector3()
  const scale = new Vector3()
  let previous_tick = performance.now()

  const material = (color: number, opacity: number): MeshBasicMaterial =>
    new MeshBasicMaterial({
      color: new Color(color),
      transparent: true,
      opacity,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })

  const spawn_particles = (
    id: string,
    center: Vector3,
    color: number,
    radius: number,
    duration_ms: number,
    mode: ParticleMode,
    count: number
  ): void => {
    const particle_material = material(color, mode === 'remnant' ? 0.42 : 0.72)
    const mesh = new InstancedMesh(particle_geometry, particle_material, count)
    mesh.frustumCulled = false
    mesh.renderOrder = 40
    scene.add(mesh)
    particles.push(
      Object.freeze({
        mesh,
        material: particle_material,
        center: center.clone(),
        seeds: Object.freeze(Array.from({ length: count }, (_, index) => particle_seed(id, index))),
        started_at: previous_tick,
        duration_ms,
        radius,
        mode,
      })
    )
  }

  const spawn_ring = (center: Vector3, color: number, radius: number, duration_ms: number): void => {
    const ring_material = material(color, 0.7)
    const mesh = new Mesh(ring_geometry, ring_material)
    mesh.position.copy(center)
    mesh.rotation.x = -Math.PI / 2
    mesh.renderOrder = 39
    scene.add(mesh)
    rings.push(Object.freeze({ mesh, material: ring_material, started_at: previous_tick, duration_ms, radius }))
  }

  const spawn_impact = (id: string, at: Vector3, color: number, accent: number, radius: number): void => {
    spawn_particles(`${id}:impact`, at, color, radius, FIGHT_VFX_BEAT.impact_seconds * 1_000, 'burst', 30)
    spawn_ring(at, accent, radius, FIGHT_VFX_BEAT.impact_seconds * 1_000)
  }

  const finish_projectile = (projectile: Projectile): void => {
    scene.remove(projectile.core, projectile.trail)
    ;(projectile.core.material as MeshBasicMaterial).dispose()
    ;(projectile.trail.material as MeshBasicMaterial).dispose()
    const ground = projectile.to.clone().add(new Vector3(0, -FIGHT_VFX_BEAT.ground_drop, 0))
    const big = projectile.profile.impact_big_size
    const authored_size = big !== null && projectile.magnitude >= 1.25 ? big : projectile.profile.impact_size
    const impact_at = projectile.profile.impact_ground ? ground : projectile.to
    spawn_impact(
      projectile.id,
      impact_at,
      projectile.profile.color,
      projectile.profile.accent,
      Math.max(1, (authored_size / 4) * projectile.magnitude)
    )
    spawn_particles(
      `${projectile.id}:remnant`,
      ground,
      projectile.profile.color,
      Math.max(1, (projectile.profile.remnant_size / 4) * projectile.magnitude),
      projectile.profile.remnant_seconds * 1_000,
      'remnant',
      16
    )
    projectile.resolve(true)
  }

  const play_cast = (cue: CastCue): Promise<boolean> => {
    const from = entities.world_anchor(cue.caster_id)
    const to = entities.cell_anchor(cue.target_cell)
    if (!from || !to) return Promise.resolve(false)
    const magnitude = fight_vfx_magnitude(cue.amount, cue.target_max_hp)
    const burst = FIGHT_VFX_BURSTS[cue.element as keyof typeof FIGHT_VFX_BURSTS]
    if (burst)
      return new Promise<boolean>((resolve) => {
        delayed_bursts.push(
          Object.freeze({
            at: to.clone().add(new Vector3(0, -FIGHT_VFX_BEAT.ground_drop, 0)),
            color: burst.color,
            accent: burst.accent,
            radius: Math.max(1, (burst.size / 4) * magnitude),
            at_ms: previous_tick + burst.delay_seconds * 1_000,
            resolve,
          })
        )
      })
    const profile = FIGHT_VFX_PROFILES[cue.element] ?? FIGHT_VFX_PROFILES.neutral
    const windup_at = profile.windup_ground ? from.clone().add(new Vector3(0, -FIGHT_VFX_BEAT.ground_drop, 0)) : from
    spawn_particles(
      `${cue.id}:windup`,
      windup_at,
      profile.color,
      Math.max(1, (profile.windup_size / 4) * magnitude),
      FIGHT_VFX_BEAT.windup_seconds * 1_000,
      'gather',
      22
    )
    spawn_ring(windup_at, profile.accent, Math.max(1, profile.windup_size / 4), 450)
    return new Promise<boolean>((resolve) => {
      const core_material = material(profile.accent, 0.9)
      const trail_material = material(profile.color, 0.48)
      const core = new Mesh(core_geometry, core_material)
      const trail = new InstancedMesh(particle_geometry, trail_material, 12)
      core.renderOrder = 42
      trail.renderOrder = 41
      trail.frustumCulled = false
      scene.add(core, trail)
      projectiles.push(
        Object.freeze({
          id: cue.id,
          core,
          trail,
          started_at: previous_tick,
          from: from.clone(),
          to: to.clone(),
          angle: particle_seed(cue.id, 0).angle,
          radius: Math.max(1, (profile.projectile_size / 4) * magnitude),
          profile,
          magnitude,
          resolve,
        })
      )
    })
  }

  const play_death = (cue: DeathCue): void => {
    const at = entities.cell_anchor(cue.cell)
    const burst = FIGHT_VFX_BURSTS.death
    if (!at) return
    delayed_bursts.push(
      Object.freeze({
        at: at.clone().add(new Vector3(0, -FIGHT_VFX_BEAT.ground_drop, 0)),
        color: burst.color,
        accent: burst.accent,
        radius: burst.size / 4,
        at_ms: previous_tick,
        resolve: null,
      })
    )
  }

  const create_warmup = () => {
    const root = new Group()
    const mesh_material = material(0xffffff, 0)
    const instance_material = material(0xffffff, 0)
    root.add(new Mesh(ring_geometry, mesh_material), new InstancedMesh(particle_geometry, instance_material, 1))
    let disposed = false
    return Object.freeze({
      object: root,
      dispose: (): void => {
        if (disposed) return
        disposed = true
        root.clear()
        mesh_material.dispose()
        instance_material.dispose()
      },
    })
  }

  const update_particles = (now: number): void => {
    for (let effect_index = particles.length - 1; effect_index >= 0; effect_index -= 1) {
      const effect = particles[effect_index]!
      const progress = Math.min(1, Math.max(0, (now - effect.started_at) / effect.duration_ms))
      effect.seeds.forEach((seed, index) => {
        const cycle = effect.mode === 'remnant' ? (progress * 2.4 + seed.phase) % 1 : progress
        const radial = effect.mode === 'gather' ? (1 - eased(cycle)) * effect.radius : eased(cycle) * effect.radius
        const lift =
          effect.mode === 'remnant'
            ? cycle * seed.lift * effect.radius
            : Math.sin(cycle * Math.PI) * seed.lift * effect.radius
        position.set(
          effect.center.x + Math.cos(seed.angle) * radial * seed.radius,
          effect.center.y + lift,
          effect.center.z + Math.sin(seed.angle) * radial * seed.radius
        )
        const visible = Math.max(0.001, seed.size * effect.radius * (1 - cycle) * 0.24)
        scale.setScalar(visible)
        matrix.compose(position, effect.mesh.quaternion, scale)
        effect.mesh.setMatrixAt(index, matrix)
      })
      effect.mesh.instanceMatrix.needsUpdate = true
      effect.material.opacity = (effect.mode === 'remnant' ? 0.42 : 0.72) * (1 - progress)
      if (progress < 1) continue
      scene.remove(effect.mesh)
      effect.material.dispose()
      particles.splice(effect_index, 1)
    }
  }

  const update_rings = (now: number): void => {
    for (let index = rings.length - 1; index >= 0; index -= 1) {
      const effect = rings[index]!
      const progress = Math.min(1, Math.max(0, (now - effect.started_at) / effect.duration_ms))
      effect.mesh.scale.setScalar(Math.max(0.001, eased(progress) * effect.radius))
      effect.material.opacity = 0.7 * (1 - progress)
      if (progress < 1) continue
      scene.remove(effect.mesh)
      effect.material.dispose()
      rings.splice(index, 1)
    }
  }

  const update_projectiles = (now: number): void => {
    for (let index = projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = projectiles[index]!
      const progress = Math.min(1, Math.max(0, (now - projectile.started_at) / (FIGHT_VFX_BEAT.travel_seconds * 1_000)))
      const radius = Math.tan((34 * Math.PI) / 180) * FIGHT_VFX_BEAT.sky_height * 0.55
      const ease = 1 - progress * progress
      position.set(
        projectile.to.x + Math.cos(projectile.angle) * radius * ease,
        projectile.to.y + FIGHT_VFX_BEAT.sky_height * ease,
        projectile.to.z + Math.sin(projectile.angle) * radius * ease
      )
      projectile.core.position.copy(position)
      projectile.core.scale.setScalar(projectile.radius)
      for (let trail_index = 0; trail_index < projectile.trail.count; trail_index += 1) {
        const trail_progress = Math.max(0, progress - trail_index * 0.025)
        const trail_ease = 1 - trail_progress * trail_progress
        position.set(
          projectile.to.x + Math.cos(projectile.angle) * radius * trail_ease,
          projectile.to.y + FIGHT_VFX_BEAT.sky_height * trail_ease,
          projectile.to.z + Math.sin(projectile.angle) * radius * trail_ease
        )
        scale.setScalar(projectile.radius * Math.max(0.06, 0.45 - trail_index * 0.028))
        matrix.compose(position, projectile.trail.quaternion, scale)
        projectile.trail.setMatrixAt(trail_index, matrix)
      }
      projectile.trail.instanceMatrix.needsUpdate = true
      if (progress < 1) continue
      projectiles.splice(index, 1)
      finish_projectile(projectile)
    }
  }

  const update_delayed_bursts = (now: number): void => {
    for (let index = delayed_bursts.length - 1; index >= 0; index -= 1) {
      const burst = delayed_bursts[index]!
      if (now < burst.at_ms) continue
      delayed_bursts.splice(index, 1)
      spawn_impact(`burst:${burst.at_ms}`, burst.at, burst.color, burst.accent, burst.radius)
      burst.resolve?.(true)
    }
  }

  return Object.freeze({
    create_warmup,
    play_cast,
    play_death,
    tick: (now: number): void => {
      previous_tick = now
      update_delayed_bursts(now)
      update_projectiles(now)
      update_particles(now)
      update_rings(now)
    },
    dispose: (): void => {
      projectiles.forEach((projectile) => {
        scene.remove(projectile.core, projectile.trail)
        ;(projectile.core.material as MeshBasicMaterial).dispose()
        ;(projectile.trail.material as MeshBasicMaterial).dispose()
        projectile.resolve(false)
      })
      particles.forEach((effect) => {
        scene.remove(effect.mesh)
        effect.material.dispose()
      })
      rings.forEach((effect) => {
        scene.remove(effect.mesh)
        effect.material.dispose()
      })
      delayed_bursts.forEach(({ resolve }) => resolve?.(false))
      projectiles.length = 0
      particles.length = 0
      rings.length = 0
      delayed_bursts.length = 0
      particle_geometry.dispose()
      core_geometry.dispose()
      ring_geometry.dispose()
    },
  })
}
