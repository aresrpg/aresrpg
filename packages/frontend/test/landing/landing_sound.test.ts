// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterAll, afterEach, expect, spyOn, test } from 'bun:test'

import { load_enabled, load_volume, save_enabled } from '../../src/landing/landing_sound.ts'

const warning = spyOn(console, 'warn').mockImplementation(() => {})
afterEach(() => warning.mockClear())
afterAll(() => warning.mockRestore())

test('missing storage methods fall back without a runtime warning', () => {
  expect(load_enabled(() => ({}))).toBe(true)
  expect(load_volume(() => ({}))).toBe(0.35)
  save_enabled(false, () => ({}))
  expect(warning).not.toHaveBeenCalled()
})

test('throwing access and real method failures remain observable', () => {
  const denied = () => {
    throw new DOMException('Storage denied', 'SecurityError')
  }
  expect(load_enabled(denied)).toBe(true)
  expect(load_volume(() => ({ getItem: denied }))).toBe(0.35)
  save_enabled(false, () => ({ setItem: denied }))
  expect(warning).toHaveBeenCalledTimes(3)
})

test('stored mute and master gain retain their existing semantics', () => {
  const read = () => ({ getItem: (key: string) => (key === 'aresrpg.settings' ? '{"master_volume":0.4}' : 'false') })
  expect(load_enabled(read)).toBe(false)
  expect(load_volume(read)).toBeCloseTo(0.14)
  const values: string[] = []
  save_enabled(true, () => ({
    setItem: (key, value) => {
      values.push(key, value)
    },
  }))
  expect(values).toEqual(['aresrpg.landing.music_enabled', 'true'])
})

test('server rendering never reads a host localStorage stub', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => {
      throw new Error('Host storage must not be read')
    },
  })
  try {
    expect(load_enabled()).toBe(true)
    expect(load_volume()).toBe(0.35)
    save_enabled(false)
    expect(warning).not.toHaveBeenCalled()
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
