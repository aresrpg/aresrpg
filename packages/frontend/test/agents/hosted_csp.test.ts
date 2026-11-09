// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { with_bot_csp } from '../../deployment_csp.ts'
import deployment from '../../vercel.json' with { type: 'json' }

const policy = deployment.headers
  .flatMap(({ headers }) => headers)
  .find(({ key }) => key === 'Content-Security-Policy')!.value
const config = {
  version: 3,
  routes: [
    { src: '/(.*)', headers: { 'Content-Security-Policy': policy, 'X-Content-Type-Options': 'nosniff' } },
    { handle: 'filesystem' },
  ],
} as const

test('generated CSP admits only the configured bot origin and preserves other headers/directives', () => {
  const result = with_bot_csp(config, 'https://bot.example.test/')
  const expected = policy
    .split(';')
    .map((directive) =>
      directive.trim().startsWith('connect-src ') ? `${directive} https://bot.example.test` : directive
    )
    .join(';')
  expect(result).toEqual({
    ...config,
    routes: [
      { ...config.routes[0], headers: { ...config.routes[0]!.headers, 'Content-Security-Policy': expected } },
      config.routes[1],
    ],
  })
  expect(config.routes[0]!.headers!['Content-Security-Policy']).toBe(policy)
  expect(with_bot_csp(result, 'https://bot.example.test')).toEqual(result)
  const sources = expected
    .split(';')
    .find((directive) => directive.trim().startsWith('connect-src '))!
    .split(/\s+/)
  for (const origin of [
    '*',
    'https:',
    'https://*',
    'https://*.example.test',
    'http://bot.example.test',
    'https://edge.example.test',
    'https://unrelated.example',
  ])
    expect(sources).not.toContain(origin)
})

test('disabled hosting leaves deployment policy unchanged', () => {
  expect(with_bot_csp(config, undefined)).toBe(config)
  expect(with_bot_csp(config, '')).toBe(config)
})

test.each([
  'http://bot.example.test',
  'https://user:secret@bot.example.test',
  'https://bot.example.test/path',
  'https://bot.example.test/?key=value',
])('invalid bot origin fails before generating deployment policy: %s', (origin) => {
  expect(() => with_bot_csp(config, origin)).toThrow()
})

test('missing effective CSP or connect-src fails closed for an enabled service', () => {
  expect(() => with_bot_csp({ version: 3, routes: [] }, 'https://bot.example.test')).toThrow()
  expect(() =>
    with_bot_csp(
      { version: 3, routes: [{ headers: { 'content-security-policy': "default-src 'none'" } }] },
      'https://bot.example.test'
    )
  ).toThrow()
})
