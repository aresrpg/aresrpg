// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #770 — CONSEQUENCE B, locked. Every other SDK builder test injects ids through the
// `context.ids.aresrpg` override seam, so none of them ever proved what the PRODUCTION path resolves:
// with no override, `aresrpg_deployment` reads release.json and `LATEST_PACKAGE_ID` becomes the call
// target of every aresrpg moveCall (src/deployment/aresrpg.js:114). While the pins kept the ORIGIN as
// `latest`, that production path silently routed every call to v1 bytecode across two live upgrades.
// This builds a real PTB off the SHIPPED pins and asserts each call lands on its package's stamped
// `latest` — the core package and a sibling in the same transaction.
import { test, expect } from 'bun:test'

import RELEASE from '../src/deployment/release.json' with { type: 'json' }
import { activate_ptb } from '../src/dungeon.js'

import { id, move_calls, stub_kiosk_client } from './_onchain_fixtures.js'

// No `ids` — the PRODUCTION resolution path (release.json), which is the whole point of this file.
const shipped_context = { network: 'testnet', kiosk_client: stub_kiosk_client }
const pins = RELEASE.networks.testnet.packages
const owning_package = { extract: 'aresrpg', dungeon: 'dungeon' }

test('a PTB built off the shipped pins targets each package at its stamped latest', () => {
  const tx = activate_ptb(shipped_context)({
    world_id: id('w0'),
    kiosk_id: id('k0'),
    personal_kiosk_cap_id: id('pk0'),
    character_id: id('ca0'),
    key_item_id: id('key0'),
  })

  const calls = move_calls(tx)
  expect(calls.map(call => call.target)).toEqual([
    'extract::extract_one_for_burn',
    'dungeon::activate',
  ])
  for (const call of calls) {
    const owner = owning_package[call.target.split('::')[0]]
    expect(call.package).toBe(pins[owner].latest)
    // The regression itself: an upgraded package whose live calls still land on the type origin.
    if (pins[owner].latest !== pins[owner].origin)
      expect(call.package).not.toBe(pins[owner].origin)
    // A retired version stays sponsorable only to drain — it is never a live call target.
    expect(pins[owner].previous ?? []).not.toContain(call.package)
  }
})
