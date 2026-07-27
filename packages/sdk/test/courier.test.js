// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import {
  CourierError,
  courier_challenge,
  post_courier_chat,
  post_courier_position,
} from '../src/courier.js'

const ADDRESS = `0x${'a1'.repeat(32)}`
const WORLD = `0x${'b2'.repeat(32)}`
const CHARACTER = `0x${'c3'.repeat(32)}`
const authentication = {
  sender: ADDRESS,
  challenge: `aresrpg-courier:${ADDRESS}:123`,
  signature: 'zklogin-signature',
}

const capture_fetch = (response = { ok: true }) => {
  const calls = []
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init })
      return {
        ok: response.ok,
        status: response.status ?? (response.ok ? 202 : 500),
        json: async () => response.json ?? { ok: response.ok },
      }
    },
  }
}

describe('courier challenge', () => {
  test('binds the sponsor-style fresh challenge to the authenticated address', () => {
    expect(courier_challenge(ADDRESS, 123)).toBe(`aresrpg-courier:${ADDRESS}:123`)
  })
})

describe('POST /v1/courier/position', () => {
  test('posts the exact position payload and auth triplet', async () => {
    const wire = capture_fetch()
    await post_courier_position(
      {
        base_url: 'https://courier.test/',
        world: WORLD,
        character: CHARACTER,
        x: -145,
        z: 42,
        heading: 1.25,
        ...authentication,
      },
      wire.fetch
    )

    expect(wire.calls).toHaveLength(1)
    expect(wire.calls[0].url).toBe('https://courier.test/v1/courier/position')
    expect(wire.calls[0].init.method).toBe('POST')
    expect(wire.calls[0].init.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(wire.calls[0].init.body)).toEqual({
      world: WORLD,
      character: CHARACTER,
      x: -145,
      z: 42,
      heading: 1.25,
      ...authentication,
    })
  })
})

describe('POST /v1/courier/chat', () => {
  test('posts the exact chat payload and surfaces a typed rate-limit refusal', async () => {
    const wire = capture_fetch({ ok: false, status: 429, json: { error: 'chat rate limited — retry shortly' } })

    const rejected = post_courier_chat(
      {
        base_url: 'https://courier.test',
        world: WORLD,
        character: CHARACTER,
        text: 'hello world',
        ...authentication,
      },
      wire.fetch
    )
    await expect(rejected).rejects.toBeInstanceOf(CourierError)
    await expect(rejected).rejects.toMatchObject({ status: 429 })

    expect(wire.calls).toHaveLength(1)
    expect(wire.calls[0].url).toBe('https://courier.test/v1/courier/chat')
    expect(JSON.parse(wire.calls[0].init.body)).toEqual({
      world: WORLD,
      character: CHARACTER,
      text: 'hello world',
      ...authentication,
    })
  })
})
