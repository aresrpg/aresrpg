// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Upright dungeon membranes fit the same voxel arch as the spawn portal. Terrain owns
// the demonic frame; Sceat and the entrance interaction remain frontend-owned.

import { BufferAttribute, BufferGeometry, Group, Mesh, Points, PointsMaterial, type Scene } from 'three'

import { create_portal_geometry, create_portal_material } from './portal.ts'
import { PORTAL_ARCH, dungeon_gate_position } from './portal_shape.ts'
import type { DungeonPortalMarker } from './types.ts'
import { sample_world_column, type CompiledWorld } from './world_recipe.ts'

const RADIUS = PORTAL_ARCH.half_width
const ARCH_HEIGHT = PORTAL_ARCH.spring_height + PORTAL_ARCH.half_width
const CULL_RANGE_SQUARED = 120 * 120
const PARTICLES = 22
const GATE_COLOR = [0.48, 0.015, 0.26] as const
const HUM_RANGE = 28

export const portal_hum_gain = (distance: number, volume = 1): number =>
  0.055 * volume * Math.max(0, 1 - Math.max(0, distance) / HUM_RANGE)

type PortalSlot = Readonly<{ root: Group; particles: Points }>

const particle_geometry = (seed: number): BufferGeometry => {
  const positions = new Float32Array(PARTICLES * 3)
  for (let index = 0; index < PARTICLES; index += 1) {
    const angle = (index / PARTICLES) * Math.PI * 2 + seed * 0.017
    const distance = RADIUS * (0.72 + ((index * 17 + seed) % 19) / 42)
    positions[index * 3] = Math.cos(angle) * distance
    positions[index * 3 + 1] = ARCH_HEIGHT / 2 + Math.sin(angle) * distance
    positions[index * 3 + 2] = ((index * 13 + seed) % 11) / 25 - 0.2
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  return geometry
}

const hash = (value: string): number =>
  [...value].reduce((result, character) => (Math.imul(result, 31) + character.charCodeAt(0)) >>> 0, 0)

export const create_dungeon_portals = ({ scene, world }: Readonly<{ scene: Scene; world: CompiledWorld }>) => {
  const geometry = create_portal_geometry()
  const material = create_portal_material({
    emission_color: GATE_COLOR,
    gain: 1.7,
  })
  const particle_material = new PointsMaterial({ color: 0xe34ca6, size: 0.16, transparent: true, opacity: 0.82 })
  const slots = new Map<string, PortalSlot>()
  let markers: readonly DungeonPortalMarker[] = Object.freeze([])
  let active = true
  let volume = 1
  let audio: Readonly<{ context: AudioContext; gain: GainNode; oscillators: readonly OscillatorNode[] }> | null = null

  const unlock_audio = (): void => {
    if (audio) return
    const Constructor = (globalThis.AudioContext ?? Reflect.get(globalThis, 'webkitAudioContext')) as
      typeof AudioContext | undefined
    if (!Constructor) return
    const context = new Constructor()
    const gain = context.createGain()
    gain.gain.value = 0
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 440
    filter.Q.value = 2.4
    const base = context.createOscillator()
    base.type = 'sine'
    base.frequency.value = 74
    const shimmer = context.createOscillator()
    shimmer.type = 'triangle'
    shimmer.frequency.value = 111
    base.connect(filter)
    shimmer.connect(filter)
    filter.connect(gain)
    gain.connect(context.destination)
    base.start()
    shimmer.start()
    audio = Object.freeze({ context, gain, oscillators: Object.freeze([base, shimmer]) })
    void context.resume()
  }
  globalThis.addEventListener?.('pointerdown', unlock_audio, { once: true })
  globalThis.addEventListener?.('keydown', unlock_audio, { once: true })

  const remove = (id: string): void => {
    const slot = slots.get(id)
    if (!slot) return
    scene.remove(slot.root)
    slot.particles.geometry.dispose()
    slots.delete(id)
  }
  const place = (marker: DungeonPortalMarker): void => {
    if (slots.has(marker.id)) return
    const position = dungeon_gate_position(marker.x, marker.z)
    const base_y = sample_world_column(world, position.x, position.z).surface_y
    const root = new Group()
    const disc = new Mesh(geometry, material)
    const particles = new Points(particle_geometry(hash(marker.id)), particle_material)
    disc.renderOrder = 2
    root.add(disc, particles)
    root.position.set(position.x, base_y, position.z)
    root.visible = false
    scene.add(root)
    slots.set(marker.id, Object.freeze({ root, particles }))
  }

  return Object.freeze({
    set_markers: (next: readonly DungeonPortalMarker[]): void => {
      markers = Object.freeze([...next])
      const wanted = new Set(markers.map(({ id }) => id))
      for (const id of [...slots.keys()]) if (!wanted.has(id)) remove(id)
      markers.forEach(place)
    },
    set_active: (next: boolean): void => {
      active = next
      if (!active) slots.forEach(({ root }) => (root.visible = false))
    },
    set_volume: (next: number): void => {
      volume = next
    },
    tick: (now: number, viewer_x: number, viewer_y: number, viewer_z: number): void => {
      let nearest = Number.POSITIVE_INFINITY
      slots.forEach(({ root, particles }) => {
        const dx = viewer_x - root.position.x
        const dy = viewer_y - root.position.y
        const dz = viewer_z - root.position.z
        root.visible = active && dx * dx + dy * dy + dz * dz < CULL_RANGE_SQUARED
        if (root.visible) nearest = Math.min(nearest, Math.hypot(dx, dy, dz))
        particles.position.y = Math.sin(now * 0.001 + root.position.x) * 0.15
        particles.scale.setScalar(0.96 + Math.sin(now * 0.0015 + root.position.x) * 0.05)
      })
      if (audio)
        audio.gain.gain.setTargetAtTime(active ? portal_hum_gain(nearest, volume) : 0, audio.context.currentTime, 0.12)
    },
    dispose: () => {
      globalThis.removeEventListener?.('pointerdown', unlock_audio)
      globalThis.removeEventListener?.('keydown', unlock_audio)
      audio?.oscillators.forEach((oscillator) => oscillator.stop())
      if (audio) void audio.context.close()
      for (const id of [...slots.keys()]) remove(id)
      geometry.dispose()
      material.dispose()
      particle_material.dispose()
    },
  })
}
