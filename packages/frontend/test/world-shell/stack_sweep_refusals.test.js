// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1802 rider — the boot sweep's cross-load refusal memo. It is a MEMO, never a kill switch: it must
// remember an exact refused plan across app loads, stay bounded, and degrade to "not remembered" (an honest
// retry) whenever the browser store is unusable — never to "never sweep again".

import { beforeEach, describe, expect, test } from 'bun:test'

const store = new Map()
globalThis.window = /** @type {any} */ ({
  localStorage: {
    getItem: (/** @type {string} */ key) => store.get(key) ?? null,
    setItem: (/** @type {string} */ key, /** @type {string} */ value) => void store.set(key, value),
    removeItem: (/** @type {string} */ key) => void store.delete(key),
  },
})

const { stack_sweep_refusals } = await import('../../src/world-shell/stack_sweep_refusals.js')

describe('stack_sweep_refusals', () => {
  beforeEach(() => store.clear())

  test('a remembered signature survives the read that a fresh app load performs', () => {
    expect(stack_sweep_refusals.has('0xk>0xa<0xb')).toBe(false)
    stack_sweep_refusals.remember('0xk>0xa<0xb')
    expect(stack_sweep_refusals.has('0xk>0xa<0xb')).toBe(true)
    expect(stack_sweep_refusals.has('0xk>0xa<0xc')).toBe(false) // any other plan is untouched
  })

  test('remembering the same plan twice keeps ONE entry', () => {
    stack_sweep_refusals.remember('sig')
    stack_sweep_refusals.remember('sig')
    expect(JSON.parse(store.get('ares_stack_sweep_refused'))).toEqual(['sig'])
  })

  test('bounded — the oldest signature falls out, so the entry can never grow without limit', () => {
    for (let i = 0; i < 12; i += 1) stack_sweep_refusals.remember(`sig-${i}`)
    const kept = JSON.parse(store.get('ares_stack_sweep_refused'))
    expect(kept).toHaveLength(8)
    expect(kept.at(-1)).toBe('sig-11')
    expect(stack_sweep_refusals.has('sig-0')).toBe(false) // aged out ⇒ one more honest attempt
  })

  test('a corrupt entry is an EMPTY memory, never a wedged sweep', () => {
    store.set('ares_stack_sweep_refused', '{not json')
    expect(stack_sweep_refusals.has('sig')).toBe(false)
    stack_sweep_refusals.remember('sig')
    expect(stack_sweep_refusals.has('sig')).toBe(true)
  })

  test('an empty signature is never remembered and never matches', () => {
    stack_sweep_refusals.remember('')
    expect(stack_sweep_refusals.has('')).toBe(false)
    expect(store.has('ares_stack_sweep_refused')).toBe(false)
  })

  test('a throwing store degrades to the pre-memo behaviour (always retry), never to a refusal', () => {
    globalThis.window.localStorage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    expect(() => stack_sweep_refusals.remember('sig')).not.toThrow()
    expect(stack_sweep_refusals.has('sig')).toBe(false)
  })
})
