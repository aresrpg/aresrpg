// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from 'bun:test'
import { parse_client_packet } from '@aresrpg/protocol'

import deployment from '../vercel.json'

const public_dir = resolve(import.meta.dir, '../public')
const repo_dir = resolve(import.meta.dir, '../../..')
const guide_paths = ['llms.txt', ...readdirSync(resolve(public_dir, 'agents')).map((file) => `agents/${file}`)]
const app_rewrites = deployment.rewrites
  .filter(({ destination }) => destination === '/index.html')
  .map(({ source }) => new RegExp(`^${source}$`))

test('every published guide and linked source resolves to an existing file', () => {
  const roots = {
    'https://raw.githubusercontent.com/aresrpg/aresrpg/edge/': repo_dir,
    'https://aresrpg.world/': public_dir,
  }
  const links = guide_paths.flatMap((path) =>
    [...readFileSync(resolve(public_dir, path), 'utf8').matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((match) => match[1]!)
  )
  const missing = links.filter((link) => {
    const root = Object.entries(roots).find(([prefix]) => link.startsWith(prefix))
    return root && !existsSync(resolve(root[1], link.slice(root[0].length)))
  })
  expect(missing).toEqual([])
})

test('deployment serves static pages without rewriting them to the game shell', () => {
  for (const path of [...guide_paths, 'agents/missing.txt', 'links', 'links/logo.png']) {
    expect(app_rewrites.some((pattern) => pattern.test(`/${path}`))).toBe(false)
  }
  expect(app_rewrites.some((pattern) => pattern.test('/inventory'))).toBe(true)
  expect(app_rewrites.some((pattern) => pattern.test('/'))).toBe(true)
})

test('documented wire examples pass the actual client-packet parser', () => {
  const guide = readFileSync(resolve(public_dir, 'agents/indexing.txt'), 'utf8')
  const examples = [...guide.matchAll(/```json\s*([\s\S]*?)```/g)].map((match) => match[1]!)
  expect(examples.length).toBeGreaterThan(0)
  for (const example of examples) expect(parse_client_packet(example)).toEqual(JSON.parse(example))
})

test('chain-native entry points keep socket setup in the optional indexed guide', () => {
  for (const path of ['llms.txt', 'agents/protocol.txt', 'agents/sdk.txt']) {
    const guide = readFileSync(resolve(public_dir, path), 'utf8')
    expect(guide).toContain('GraphQL')
    expect(guide).toContain('gRPC')
    expect(guide).toContain('https://aresrpg.world/agents/indexing.txt')
    expect(guide).not.toContain('packet/signature_response')
    expect(guide).not.toContain('new WebSocket')
  }
})
