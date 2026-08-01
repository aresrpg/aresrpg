// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// api/sponsor.mjs PTB-scope allowlist resolution — a malformed SPONSOR_ARESRPG_PACKAGES entry
// refuses to BOOT (never a silent fallback to release.json — a typo'd allowlist must never
// quietly sponsor the wrong scope).
//
//   bun test api/sponsor.allowlist_malformed.test.js   (no Redis, no station — boot-time refusal)
//
// Own process on purpose: the throw happens at module EVALUATION time, so this file's only job is
// to import once and assert the import itself rejects.

import { describe, expect, test } from 'bun:test'

process.env.REDIS_URL = ''
process.env.SPONSOR_ARESRPG_PACKAGES = '0x' + 'aa'.repeat(32) + ',not-a-package-id'

describe('SPONSOR_ARESRPG_PACKAGES malformed entry — refuses to boot, names the bad entry', () => {
  // Same bound as its sibling: the assertion IS a module evaluation (@mysten/sui + gRPC), which outruns bun's
  // 5s default on a loaded machine. The subject is the refusal, never the clock.
  test('import rejects naming the exact malformed entry', async () => {
    await expect(import('./sponsor.mjs')).rejects.toThrow(
      /sponsor-misconfig.*SPONSOR_ARESRPG_PACKAGES.*malformed entry "not-a-package-id"/
    )
  }, 30_000)
})
