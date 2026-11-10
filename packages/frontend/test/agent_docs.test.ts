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

test('official onboarding is singular while SDK references retain read and transaction detail', () => {
  const entry = readFileSync(resolve(public_dir, 'llms.txt'), 'utf8')
  expect(entry).toContain('https://aresrpg.world/agents/client.txt')
  expect(entry).toContain('single official supported bot onboarding flow')
  expect(entry).toContain('hosted executor uses the same SDK actions')
  expect(entry).not.toContain('bounded, read-only development preview')
  for (const path of ['agents/protocol.txt', 'agents/sdk.txt']) {
    const guide = readFileSync(resolve(public_dir, path), 'utf8')
    expect(guide).toContain('GraphQL')
    expect(guide).toContain('gRPC')
    expect(guide).toContain('https://aresrpg.world/agents/indexing.txt')
    expect(guide).not.toContain('packet/signature_response')
    expect(guide).not.toContain('new WebSocket')
  }
})

test('all onboarding entry points point to the canonical Connect Your Agent guide', () => {
  for (const path of [
    'llms.txt',
    'agents/sdk.txt',
    'agents/protocol.txt',
    'agents/play.txt',
    'agents/indexing.txt',
    'agents/index.html',
  ]) {
    const source = readFileSync(resolve(public_dir, path), 'utf8')
    expect(source).toContain('single official')
    expect(source).toContain('/agents/client.txt')
    expect(source).not.toContain('Performance-focused chain-only clients remain supported')
  }
  const landing = readFileSync(resolve(public_dir, 'agents/index.html'), 'utf8')
  const hrefs = [...landing.matchAll(/href="(\/(?:agents\/[^"#]+|llms.txt))"/g)].map((match) => match[1]!)
  expect(hrefs.length).toBeGreaterThan(0)
  for (const href of hrefs) expect(existsSync(resolve(public_dir, href.slice(1)))).toBe(true)
})

test('production frontend no longer ships a local signing CLI', () => {
  const { scripts } = JSON.parse(readFileSync(resolve(public_dir, '../package.json'), 'utf8'))
  expect(deployment.buildCommand).toBe('bun run build')
  expect(scripts.build).toBe('vite build')
  expect(scripts['build:test']).not.toContain('build_agent_cli')
})

test('hosted guides separate encrypted actor journals from browser digest-only storage', () => {
  for (const path of ['agents/sdk.txt', 'agents/protocol.txt']) {
    const guide = readFileSync(resolve(public_dir, path), 'utf8')
    expect(guide).toContain('transaction_journal')
    expect(guide).toContain('@aresrpg/sdk/transaction-execution')
    expect(guide).toContain('digest-only')
    expect(guide).toContain('packages/bot/README.md')
    expect(guide).not.toContain("headless writer's `transaction_storage`")
    expect(guide).not.toContain('headless writer must supply durable `transaction_storage`')
  }
  const indexing = readFileSync(resolve(public_dir, 'agents/indexing.txt'), 'utf8')
  expect(indexing).not.toContain('signer and multisig address returned by Connect Your Agent')
  expect(indexing).toContain('never a signer or key')
  const custody = readFileSync(resolve(public_dir, 'agents/custody.txt'), 'utf8')
  expect(custody).not.toContain('returned transaction signer')
  expect(custody).toContain('tools/list')
  expect(readFileSync(resolve(public_dir, 'agents/play.txt'), 'utf8')).not.toContain('local signing mechanism')
})

test('agent entry guides disclose work in progress and the canonical support destination', () => {
  for (const path of ['llms.txt', 'agents/client.txt', 'agents/index.html']) {
    const guide = readFileSync(resolve(public_dir, path), 'utf8')
    expect(guide).toContain('work in progress')
    expect(guide).toContain('over the coming months')
    expect(guide).toContain('https://discord.gg/aresrpg')
  }
})
