// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from 'bun:test'

import { asset_inline_limit } from '../asset_inline.ts'
import deployment from '../vercel.json'

const generated = resolve(import.meta.dir, '../../engine/src/cities/generated')

test('production connect-src refuses data URLs, so fetched assets must stay files', () => {
  const connect = deployment.headers
    .flatMap(({ headers }) => headers)
    .find(({ key }) => key === 'Content-Security-Policy')!
    .value.split(';')
    .find((directive) => directive.trim().startsWith('connect-src'))!
    .split(/\s+/u)
  expect(connect).not.toContain('data:')
})

// v2.6.24: the_ruins_details.json (142 B) and fuwage_details.json (139 B) fell under Vite's 4 KiB
// inline default, so every chunk near The Ruins and Fuwage failed with `TypeError: Failed to fetch`.
test('every generated city artifact is emitted as a file, never inlined', () => {
  const artifacts = readdirSync(generated).filter((file) => file.endsWith('.json'))
  expect(artifacts).toContain('the_ruins_details.json')
  expect(artifacts).toContain('fuwage_details.json')
  for (const file of artifacts) expect(asset_inline_limit(resolve(generated, file))).toBe(false)
})

test('models stay files and other assets keep the Vite default', () => {
  expect(asset_inline_limit('/assets/models/pet.glb')).toBe(false)
  expect(asset_inline_limit('/assets/icons/potion_of_the_ruins.png')).toBeUndefined()
})
