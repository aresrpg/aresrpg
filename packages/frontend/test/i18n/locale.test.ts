// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { load_locale, save_locale } from '../../src/i18n/locale.ts'

test.each(['pt-BR', 'pt-PT', 'pt'])('detects %s and retains an explicit language choice', (language) => {
  const keys = ['navigator', 'localStorage'] as const
  const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key))
  const storage = new Map<string, string>()
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language } })
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    })
    storage.set('ares_language', 'unsupported')
    expect(load_locale()).toBe('pt')
    save_locale('en')
    expect(load_locale()).toBe('en')
    save_locale('pt')
    expect(storage.get('ares_language')).toBe('pt')
    expect(load_locale()).toBe('pt')
  } finally {
    keys.forEach((key, index) => {
      const descriptor = descriptors[index]
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
})
