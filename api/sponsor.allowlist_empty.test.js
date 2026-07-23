// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// api/sponsor.mjs PTB-scope allowlist resolution — SPONSOR_ARESRPG_PACKAGES SET but EMPTY refuses
// to boot rather than silently falling back to release.json (an accidentally-blanked env value
// must never widen back to "whatever's baked in the image").
//
//   bun test api/sponsor.allowlist_empty.test.js       (no Redis, no station — boot-time refusal)
//
// Own process on purpose: the throw happens at module EVALUATION time.

import { describe, expect, test } from 'bun:test'

process.env.REDIS_URL = ''
process.env.SPONSOR_ARESRPG_PACKAGES = ''

describe('SPONSOR_ARESRPG_PACKAGES set but empty — refuses to boot, never falls back', () => {
  test('import rejects — set-but-empty is NOT treated as unset', async () => {
    await expect(import('./sponsor.mjs')).rejects.toThrow(
      /sponsor-misconfig.*SPONSOR_ARESRPG_PACKAGES is set but empty/
    )
  })
})
