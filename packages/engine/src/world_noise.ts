// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createNoise2D } from 'simplex-noise'

export type NoiseField = Readonly<{ period: number; octaves: number; spread?: number; gain?: number }>

type Alea = (() => number) & { uint32: () => number }

const make_mash = (): ((data: string) => number) => {
  let n = 0xefc8249d
  return (data) => {
    for (let index = 0; index < data.length; index += 1) {
      n += data.charCodeAt(index)
      let h = 0.02519603282416938 * n
      n = h >>> 0
      h -= n
      h *= n
      n = h >>> 0
      h -= n
      n += h * 0x100000000
    }
    return (n >>> 0) * 2.3283064365386963e-10
  }
}

export const alea = (seed: number | string): Alea => {
  const mash = make_mash()
  let s0 = mash(' ')
  let s1 = mash(' ')
  let s2 = mash(' ')
  let carry = 1
  const key = String(seed)
  s0 -= mash(key)
  if (s0 < 0) s0 += 1
  s1 -= mash(key)
  if (s1 < 0) s1 += 1
  s2 -= mash(key)
  if (s2 < 0) s2 += 1
  const random = (() => {
    const value = 2091639 * s0 + carry * 2.3283064365386963e-10
    s0 = s1
    s1 = s2
    carry = value | 0
    s2 = value - carry
    return s2
  }) as Alea
  random.uint32 = () => random() * 0x100000000
  return random
}

const integer_power = (base: number, exponent: number): number => {
  let result = 1
  for (let index = 0; index < exponent; index += 1) result *= base
  return result
}

const create_octave_sampler = (
  seed: number,
  { period, octaves, spread = 2, gain = 0.5 }: NoiseField,
  shape: (noise: number) => number
): ((x: number, z: number) => number) => {
  const noise = createNoise2D(alea(seed))
  const frequencies = Array.from({ length: octaves }, (_, index) => integer_power(spread, index) / period)
  const amplitudes = Array.from({ length: octaves }, (_, index) => integer_power(gain, index))
  const amplitude_sum = amplitudes.reduce((sum, amplitude) => sum + amplitude, 0)
  return (x, z) => {
    let value = 0
    for (let index = 0; index < octaves; index += 1)
      value += shape(noise(x * frequencies[index], z * frequencies[index])) * amplitudes[index]
    return Math.max(0, Math.min(1, value / amplitude_sum))
  }
}

export const create_fbm_sampler = (seed: number, field: NoiseField): ((x: number, z: number) => number) =>
  create_octave_sampler(seed, field, (noise) => noise * 0.5 + 0.5)

/** Fold simplex valleys into crests, producing connected mountain ridges instead of round noise domes. */
export const create_ridged_sampler = (seed: number, field: NoiseField): ((x: number, z: number) => number) =>
  create_octave_sampler(seed, field, (noise) => (1 - Math.abs(noise)) ** 2)

const hash_string = (value: string): number => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193)
  return hash >>> 0
}

/** Deterministic u32 for one labelled world position — every decoration decision hashes here. */
export const hash_position = (seed: number, label: string, x: number, z: number, salt: number): number => {
  let hash = seed ^ hash_string(label) ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(z, 0x85ebca77) ^ salt
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d)
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b)
  return (hash ^ (hash >>> 16)) >>> 0
}

const smooth = (value: number): number => value * value * (3 - 2 * value)

/** Coarse deterministic value field in [0,1) — clusters any per-position decision into patches. */
export const field_value = (
  seed: number,
  label: string,
  x: number,
  z: number,
  period: number,
  salt: number
): number => {
  const grid_x = Math.floor(x / period)
  const grid_z = Math.floor(z / period)
  const fraction_x = smooth(x / period - grid_x)
  const fraction_z = smooth(z / period - grid_z)
  const at = (offset_x: number, offset_z: number): number =>
    hash_position(seed, label, grid_x + offset_x, grid_z + offset_z, salt) / 0x1_0000_0000
  const top = at(0, 0) + (at(1, 0) - at(0, 0)) * fraction_x
  const bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * fraction_x
  return top + (bottom - top) * fraction_z
}

const U64_MASK = (1n << 64n) - 1n
const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n

export const derive_sub_seed = (seed: string, name: string): number => {
  let hash = 0xcbf29ce484222325n
  const input = `${seed}:${name}`
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash ^ BigInt(input.charCodeAt(index))) & U64_MASK
    hash = (hash * 0x100000001b3n) & U64_MASK
  }
  let mixed = (hash + GOLDEN_GAMMA) & U64_MASK
  mixed = ((mixed ^ (mixed >> 30n)) * 0xbf58476d1ce4e5b9n) & U64_MASK
  mixed = ((mixed ^ (mixed >> 27n)) * 0x94d049bb133111ebn) & U64_MASK
  mixed ^= mixed >> 31n
  return Number(mixed & 0xffffffffn) >>> 0
}
