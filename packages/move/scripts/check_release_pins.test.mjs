// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #770 — the pin-vs-chain comparison, unit-tested with synthetic caps (the CLI half needs a fullnode
// and runs post-ceremony, never in CI). Ids are CONSTRUCTED, never literal: check-chain-ids.mjs bans
// hand-typed 64-hex ids in source.
import { expect, test } from 'bun:test'

import { compare_release_pins, format_pin_rows, RELEASE_PACKAGE_SET } from './check_release_pins.mjs'
import { PKG_DEPS, TICKET_ORDER } from './publish_packages.mjs'

const id = (h) => '0x' + h.padEnd(64, '0')

test('the release gate, dependency graph, and ceremony order share one publish set', () => {
  expect(RELEASE_PACKAGE_SET).toEqual(TICKET_ORDER)
  expect(Object.keys(PKG_DEPS)).toEqual(TICKET_ORDER)
})

test('a pinned latest that is not the cap package reports drift, per package', () => {
  const packages = {
    engine: { latest: id('e1'), upgrade_cap: id('ca1') },
    aresrpg: { latest: id('a1'), upgrade_cap: id('ca2') },
  }
  // engine still on its pinned version; aresrpg upgraded on-chain without the pins following (#770).
  const rows = compare_release_pins(packages, { [id('ca1')]: id('e1'), [id('ca2')]: id('a2') })
  expect(rows).toEqual([
    { name: 'engine', pinned: id('e1'), chain: id('e1'), status: 'ok' },
    { name: 'aresrpg', pinned: id('a1'), chain: id('a2'), status: 'drift' },
  ])
  expect(format_pin_rows(rows).join('\n')).toContain('DRIFT')
})

test('an unreadable cap is UNKNOWN, never a silent pass', () => {
  const packages = { aresrpg: { latest: id('a1'), upgrade_cap: id('ca2') } }
  for (const caps of [{}, { [id('ca2')]: null }])
    expect(compare_release_pins(packages, caps)).toEqual([
      { name: 'aresrpg', pinned: id('a1'), chain: null, status: 'unknown' },
    ])
})

test('an unstamped pin never matches a live cap package', () => {
  const rows = compare_release_pins({ dungeon: { latest: '', upgrade_cap: id('ca3') } }, { [id('ca3')]: id('d1') })
  expect(rows).toEqual([{ name: 'dungeon', pinned: '', chain: id('d1'), status: 'drift' }])
})
