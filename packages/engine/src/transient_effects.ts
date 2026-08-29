// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One bounded particle runtime for transient fight and locomotion effects. Authored presets stay in
// their domains; this layer alone owns shared drawables, ticking, and disposal.

import {
  AdditiveBlending,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  RingGeometry,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type BufferGeometry,
} from 'three'

import type { create_entity_layer } from './entities.ts'
import { create_dust_texture } from './dust_texture.ts'
import { create_fight_float_layer, type FightFloatKind } from './fight_floats.ts'
import { create_fight_vfx_geometries, fight_vfx_appearance } from './fight_vfx_geometry.ts'
import {
  FIGHT_VFX_BEAT,
  FIGHT_VFX_BURSTS,
  FIGHT_VFX_PROFILES,
  fight_vfx_magnitude,
  type FightVfxProfile,
} from './fight_vfx_presets.ts'
import type { FightPresentationCue } from './types.ts'
import type { Vec3 } from './types.ts'

type EntityLayer = ReturnType<typeof create_entity_layer>
export type EffectAnchors = Pick<EntityLayer, 'world_anchor' | 'cell_anchor'>
type CastCue = Extract<FightPresentationCue, Readonly<{ type: 'cast' }>>
type DeathCue = Extract<FightPresentationCue, Readonly<{ type: 'death' }>>
type ZoneCue = Extract<FightPresentationCue, Readonly<{ type: 'zone' }>>
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
  start_radius: number
  radius: number
  opacity: number
}>
type DustEffect = Readonly<{
  group: Group
  sprites: readonly Sprite[]
  material: SpriteMaterial
  center: Vector3
  seeds: readonly ParticleSeed[]
  started_at: number
  duration_ms: number
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
  appearance: FightVfxProfile['appearance']
  magnitude: number
  resolve: (rendered: boolean) => void
}>
type DelayedBurst = Readonly<{
  at: Vector3
  color: number
  accent: number
  radius: number
  at_ms: number
  appearance: FightVfxProfile['appearance']
  resolve: ((rendered: boolean) => void) | null
}>
type DelayedResolution = Readonly<{ at_ms: number; resolve: (rendered: boolean) => void }>

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

export const create_transient_effects = ({ scene, entities }: Readonly<{ scene: Scene; entities: EffectAnchors }>) => {
  const floats = create_fight_float_layer({ scene, entities })
  const particle_geometry = new SphereGeometry(0.11, 5, 4)
  const fight_geometries = create_fight_vfx_geometries()
  const ring_geometry = new RingGeometry(0.58, 0.76, 28)
  const dust_texture = create_dust_texture()
  const particles: ParticleEffect[] = []
  const rings: RingEffect[] = []
  const dusts: DustEffect[] = []
  const projectiles: Projectile[] = []
  const delayed_bursts: DelayedBurst[] = []
  const delayed_resolutions: DelayedResolution[] = []
  const matrix = new Matrix4()
  const position = new Vector3()
  const scale = new Vector3()
  let previous_tick = performance.now()

  const material = (color: number, opacity: number, additive = true): MeshBasicMaterial =>
    new MeshBasicMaterial({
      color: new Color(color),
      transparent: true,
      opacity,
      blending: additive ? AdditiveBlending : NormalBlending,
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
    count: number,
    geometry: BufferGeometry = particle_geometry
  ): void => {
    const particle_material = material(color, mode === 'remnant' ? 0.42 : 0.72)
    const mesh = new InstancedMesh(geometry, particle_material, count)
    mesh.name = id
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

  const spawn_ring = (
    center: Vector3,
    color: number,
    radius: number,
    duration_ms: number,
    opacity = 0.7,
    additive = true,
    start_radius = 0
  ): void => {
    const ring_material = material(color, opacity, additive)
    const mesh = new Mesh(ring_geometry, ring_material)
    mesh.position.copy(center)
    mesh.rotation.x = -Math.PI / 2
    mesh.renderOrder = 39
    scene.add(mesh)
    rings.push(
      Object.freeze({
        mesh,
        material: ring_material,
        started_at: previous_tick,
        duration_ms,
        start_radius,
        radius,
        opacity,
      })
    )
  }

  const spawn_dust = (center: Vector3): void => {
    const smoke_material = new SpriteMaterial({
      map: dust_texture,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      toneMapped: false,
      blending: NormalBlending,
    })
    const group = new Group()
    const seeds = Object.freeze(Array.from({ length: 14 }, (_, index) => particle_seed(`jump_dust`, index)))
    const sprites = Object.freeze(
      seeds.map(() => {
        const sprite = new Sprite(smoke_material)
        group.add(sprite)
        return sprite
      })
    )
    group.renderOrder = 40
    scene.add(group)
    dusts.push(
      Object.freeze({
        group,
        sprites,
        material: smoke_material,
        center: center.clone(),
        seeds,
        started_at: previous_tick,
        duration_ms: 550,
      })
    )
  }

  const spawn_impact = (
    id: string,
    at: Vector3,
    color: number,
    accent: number,
    radius: number,
    appearance: FightVfxProfile['appearance']
  ): void => {
    spawn_particles(
      `${id}:impact`,
      at,
      color,
      radius,
      FIGHT_VFX_BEAT.impact_seconds * 1_000,
      'burst',
      30,
      fight_geometries[appearance]
    )
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
      Math.max(1, (authored_size / 4) * projectile.magnitude),
      projectile.appearance
    )
    spawn_particles(
      `${projectile.id}:remnant`,
      ground,
      projectile.profile.color,
      Math.max(1, (projectile.profile.remnant_size / 4) * projectile.magnitude),
      projectile.profile.remnant_seconds * 1_000,
      'remnant',
      16,
      fight_geometries[projectile.appearance]
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
            appearance: 'neutral',
            resolve,
          })
        )
      })
    const profile = FIGHT_VFX_PROFILES[cue.element] ?? FIGHT_VFX_PROFILES.neutral
    const appearance = fight_vfx_appearance(cue.style, profile.appearance)
    const windup_at = profile.windup_ground ? from.clone().add(new Vector3(0, -FIGHT_VFX_BEAT.ground_drop, 0)) : from
    spawn_particles(
      `${cue.id}:windup`,
      windup_at,
      profile.color,
      Math.max(1, (profile.windup_size / 4) * magnitude),
      FIGHT_VFX_BEAT.windup_seconds * 1_000,
      'gather',
      44,
      fight_geometries[appearance]
    )
    spawn_ring(windup_at, profile.accent, Math.max(1, profile.windup_size / 4), 450)
    return new Promise<boolean>((resolve) => {
      const core_material = material(profile.accent, 0.9)
      const trail_material = material(profile.color, 0.48)
      const core = new Mesh(fight_geometries[appearance], core_material)
      const trail = new InstancedMesh(fight_geometries[appearance], trail_material, 26)
      core.name = `${cue.id}:projectile`
      trail.name = `${cue.id}:trail`
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
          appearance,
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
        appearance: 'neutral',
        resolve: null,
      })
    )
  }

  const play_zone = (cue: ZoneCue): Promise<boolean> => {
    const at = entities.cell_anchor(cue.cell)
    if (!at) return Promise.resolve(false)
    const profile =
      FIGHT_VFX_PROFILES[cue.action === 'trap_triggered' ? 'earth' : cue.element] ?? FIGHT_VFX_PROFILES.neutral
    spawn_impact(
      cue.id,
      at.clone().add(new Vector3(0, -FIGHT_VFX_BEAT.ground_drop, 0)),
      profile.color,
      profile.accent,
      cue.action === 'trap_triggered' ? profile.impact_size / 4 : 1,
      profile.appearance
    )
    if (cue.action !== 'trap_triggered') return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      delayed_resolutions.push(
        Object.freeze({ at_ms: previous_tick + FIGHT_VFX_BEAT.trap_pause_seconds * 1_000, resolve })
      )
    })
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
      effect.mesh.scale.setScalar(
        Math.max(0.001, effect.start_radius + eased(progress) * (effect.radius - effect.start_radius))
      )
      effect.material.opacity = effect.opacity * (1 - progress)
      if (progress < 1) continue
      scene.remove(effect.mesh)
      effect.material.dispose()
      rings.splice(index, 1)
    }
  }

  const update_dust = (now: number): void => {
    for (let effect_index = dusts.length - 1; effect_index >= 0; effect_index -= 1) {
      const effect = dusts[effect_index]!
      const progress = Math.min(1, Math.max(0, (now - effect.started_at) / effect.duration_ms))
      const expansion = eased(progress)
      effect.sprites.forEach((sprite, index) => {
        const seed = effect.seeds[index]!
        const radial = 0.34 + expansion * (0.3 + seed.radius * 0.28)
        sprite.position.set(
          effect.center.x + Math.cos(seed.angle) * radial,
          effect.center.y + progress * 0.2 + Math.sin(progress * Math.PI) * seed.lift * 0.12,
          effect.center.z + Math.sin(seed.angle) * radial
        )
        const size_curve = progress < 0.5 ? 0.5 + progress : 1 - (progress - 0.5) * 0.3
        sprite.scale.setScalar((0.42 + seed.size * 0.38) * size_curve)
      })
      effect.material.opacity = progress < 0.5 ? 0.6 - progress * 0.2 : Math.max(0, 1 - progress)
      if (progress < 1) continue
      scene.remove(effect.group)
      effect.group.clear()
      effect.material.dispose()
      dusts.splice(effect_index, 1)
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
      spawn_impact(`burst:${burst.at_ms}`, burst.at, burst.color, burst.accent, burst.radius, burst.appearance)
      burst.resolve?.(true)
    }
  }

  const update_delayed_resolutions = (now: number): void => {
    for (let index = delayed_resolutions.length - 1; index >= 0; index -= 1) {
      const pending = delayed_resolutions[index]!
      if (now < pending.at_ms) continue
      delayed_resolutions.splice(index, 1)
      pending.resolve(true)
    }
  }

  return Object.freeze({
    create_warmup,
    play_sword_impact: (feet: Vec3): void => {
      const profile = FIGHT_VFX_PROFILES.earth
      spawn_impact(
        `fight-sword:${previous_tick}`,
        new Vector3(feet[0], feet[1], feet[2]),
        profile.color,
        profile.accent,
        profile.impact_size / 2,
        profile.appearance
      )
    },
    play_jump_puff: (feet: Vec3): void => {
      const center = new Vector3(feet[0], feet[1] + 0.06, feet[2])
      spawn_dust(center)
      spawn_ring(center, 0xa39578, 2.38, 420, 0.4, false, 1.4)
    },
    play_cast,
    play_death,
    play_float: (entity_id: string, amount: number, kind: FightFloatKind): boolean =>
      floats.play(entity_id, amount, kind),
    play_zone,
    tick: (now: number): void => {
      previous_tick = now
      floats.tick(now)
      update_delayed_resolutions(now)
      update_delayed_bursts(now)
      update_projectiles(now)
      update_particles(now)
      update_dust(now)
      update_rings(now)
    },
    dispose: (): void => {
      floats.dispose()
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
      dusts.forEach((effect) => {
        scene.remove(effect.group)
        effect.group.clear()
        effect.material.dispose()
      })
      delayed_bursts.forEach(({ resolve }) => resolve?.(false))
      delayed_resolutions.forEach(({ resolve }) => resolve(false))
      projectiles.length = 0
      particles.length = 0
      rings.length = 0
      dusts.length = 0
      delayed_bursts.length = 0
      delayed_resolutions.length = 0
      particle_geometry.dispose()
      Object.values(fight_geometries).forEach((geometry) => geometry.dispose())
      ring_geometry.dispose()
      dust_texture.dispose()
    },
  })
}
