// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { HOSTED_KEYSPACES, hosted_keys, type HostedService } from '../src/hosted_keys.ts'

const services = Object.keys(HOSTED_KEYSPACES) as HostedService[]
const collections = (service: HostedService) => Object.keys(HOSTED_KEYSPACES[service].collections)
// The collection argument is typed per service; the table drives these loops instead.
const key_of = (service: HostedService, namespace: string | undefined, collection: string, id?: string) =>
  (hosted_keys(service, namespace).key as (collection: string, id?: string) => string)(collection, id)

/** Every declared collection of every service, with and without an id, in both namespaces. */
const declared = services.flatMap((service) =>
  [undefined, `fixture:${service}`].flatMap((namespace) =>
    collections(service).flatMap((collection) =>
      [undefined, '42', 'grant:a:b', ''].map((id) => ({ service, namespace, collection, id }))
    )
  )
)

test('every declared key follows <namespace>:<collection>[:<id>] and parses back to its parts', () => {
  expect(declared.length).toBeGreaterThan(60)
  for (const { service, namespace, collection, id } of declared) {
    const keys = hosted_keys(service, namespace)
    const key = key_of(service, namespace, collection, id)
    expect(key).toBe([keys.namespace, collection, ...(id === undefined ? [] : [id])].join(':'))
    expect(keys.parse(key)).toEqual({ collection, id: id ?? null } as ReturnType<typeof keys.parse>)
  }
})

// These names hold live data, including encrypted custody seeds: a change here needs a migration.
test('the keys production already holds keep their exact names', () => {
  const bot = hosted_keys('bot')
  const telegram = hosted_keys('telegram')
  expect([bot.namespace, bot.key('pending'), bot.key('record', 'grant:abc')]).toEqual([
    'bot:control',
    'bot:control:pending',
    'bot:control:record:grant:abc',
  ])
  expect([
    telegram.key('user', '42'),
    telegram.key('owner', 'hash'),
    telegram.key('pending', 'hash'),
    telegram.key('attempts', '42'),
    telegram.key('admitted'),
    telegram.key('waitlist'),
  ]).toEqual([
    'telegram:user:42',
    'telegram:owner:hash',
    'telegram:pending:hash',
    'telegram:attempts:42',
    'telegram:admitted',
    'telegram:waitlist',
  ])
})

test('a key belongs to exactly one service and an undeclared key to none', () => {
  for (const { service, collection, id } of declared.filter(({ namespace }) => namespace === undefined))
    for (const other of services.filter((entry) => entry !== service)) {
      const key = key_of(service, undefined, collection, id)
      expect([key, hosted_keys(other).parse(key)]).toEqual([key, null])
      // No other service's layout marker or key can equal it, or contain it as a prefix.
      expect(key.startsWith(`${hosted_keys(other).namespace}:`)).toBe(false)
      expect(key).not.toBe(hosted_keys(other).namespace)
    }
  expect(hosted_keys('telegram').parse('telegram:enrolled')).toBeNull()
  expect(hosted_keys('bot').parse('bot:control')).toBeNull()
  expect(hosted_keys('bot').parse('bot:observations:actor')).toBeNull()
})
