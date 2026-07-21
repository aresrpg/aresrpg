// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import {
  k8s_values_expectations,
  print_k8s_values_expectations,
} from './stamp_all.mjs'

// Fixture release row (post-stamp shape): aresrpg + foundation upgraded (latest != origin),
// every other package still at its origin. Distinct ids so list membership is unambiguous.
const fixture_row = {
  packages: {
    foundation: { origin: '0xf1', latest: '0xf2' },
    spells: { origin: '0x51', latest: '0x51' },
    social: { origin: '0x52', latest: '0x52' },
    engine: { origin: '0xe1', latest: '0xe1' },
    aresrpg: { origin: '0xa1', latest: '0xa2', previous: ['0xa0'] },
    kolizeum: { origin: '0x41', latest: '0x41' },
    forgemagie: { origin: '0x42', latest: '0x42' },
    gifting: { origin: '0x43', latest: '0x43' },
    dungeon: { origin: '0xd1', latest: '0xd1' },
  },
  rules_package: '0x77',
}

test('k8s values expectations derive both operator env blocks from the release row', () => {
  const block = k8s_values_expectations(fixture_row, 'testnet')

  expect(block).toContain('domains/aresrpg/releases/rpc-indexer/values.yaml')
  expect(block).toContain('domains/aresrpg/releases/sponsor/values.yaml')
  expect(block).toContain('network: testnet')

  // Indexer allowlist: the 8 event-emitter origins then upgrade latests — foundation emits none,
  // and un-upgraded packages appear exactly once (latest == origin dedupes). Retired `previous`
  // versions NEVER enter the indexer set (0xa0 is absent) — old packages emit no new events.
  expect(block).toContain(
    'aresPackages: "0x51,0x52,0xe1,0xa1,0x41,0x42,0x43,0xd1,0xa2"'
  )
  expect(block).not.toContain('aresPackages: "0xf1')
  expect(block.match(/0x51/g)?.length).toBeGreaterThan(0)

  // Sponsor PTB-scope allowlist mirrors api/sponsor.mjs's release derivation: every package origin,
  // then upgrade latests, then retired drain-window `previous` versions (0xa0), then the kiosk rules.
  expect(block).toContain(
    '  aresrpgPackages: "0xf1,0x51,0x52,0xe1,0xa1,0x41,0x42,0x43,0xd1,0xf2,0xa2,0xa0,0x77"'
  )

  // firstCheckpoint is chain-derived (publish-tx checkpoint − margin), never manifest-derived —
  // the block must say so instead of inventing a value.
  expect(block).toContain('firstCheckpoint')
  expect(block).toContain('NOT manifest-derivable')
})

test('print step logs the block for the freshly stamped network', () => {
  const lines = []
  print_k8s_values_expectations(
    { networks: { testnet: fixture_row } },
    'testnet',
    (text) => lines.push(text)
  )
  expect(lines).toEqual([k8s_values_expectations(fixture_row, 'testnet')])
})
