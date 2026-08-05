// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'

import { load_glb_checked } from '@aresrpg/engine3/model'

import { model_asset_url, reset_model_asset_errors_for_test } from './model_asset_url.js'

afterEach(reset_model_asset_errors_for_test)

describe('model_asset_url — geometry never falls back to the SPA origin', () => {
  test('an unpublished class logs once and returns null, never a relative URL', () => {
    const error = spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(model_asset_url('fixture', 'unpublished.glb', () => null)).toBeNull()
      expect(model_asset_url('fixture', 'unpublished.glb', () => null)).toBeNull()
      expect(error).toHaveBeenCalledTimes(1)
      expect(String(error.mock.calls[0]?.[0])).toContain('unpublished or unresolvable')
    } finally {
      error.mockRestore()
    }
  })

  test('a published class passes through its absolute asset-host URL', () => {
    const url = model_asset_url('fixture', 'unit.glb', () => 'https://assets.example/models/fixture/unit.glb')
    expect(url).toBe('https://assets.example/models/fixture/unit.glb')
  })

  test('a resolver that returns a relative URL is treated as unresolvable', () => {
    const error = spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(model_asset_url('fixture', 'unit.glb', () => '/models/fixture/unit.glb')).toBeNull()
      expect(error).toHaveBeenCalledTimes(1)
    } finally {
      error.mockRestore()
    }
  })
})

describe('load_glb_checked — reject rewrite bodies before parsing', () => {
  test('index.html-as-200 is rejected by content type and its bytes never reach the parser', async () => {
    const parseAsync = mock(async () => ({ scene: {} }))
    const response = new Response('<!doctype html><title>SPA</title>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
    await expect(
      load_glb_checked('https://app.example/missing.glb', {
        fetch_impl: async () => response,
        loader: /** @type {any} */ ({ parseAsync }),
      })
    ).rejects.toThrow('Refused non-model content-type')
    expect(parseAsync).not.toHaveBeenCalled()
  })

  test('binary model content reaches the parser', async () => {
    const parsed = { scene: { name: 'model' } }
    const parseAsync = mock(async () => parsed)
    const response = new Response(new Uint8Array([0x67, 0x6c, 0x54, 0x46]), {
      status: 200,
      headers: { 'content-type': 'model/gltf-binary' },
    })
    await expect(
      load_glb_checked('https://assets.example/models/mobs/hy_rat.glb', {
        fetch_impl: async () => response,
        loader: /** @type {any} */ ({ parseAsync }),
      })
    ).resolves.toBe(parsed)
    expect(parseAsync).toHaveBeenCalledTimes(1)
  })
})
