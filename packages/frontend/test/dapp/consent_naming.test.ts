// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { DAPP_APP_MODULES, PLAYER_APP_MODULES } from '../../src/store.ts'

// Regression: hosted-bot consent waits on the SuiNS naming barrier for a managed (Google, mainnet) wallet.
// The dapp mounts that consent, so its runtime must run the same observer that settles the barrier;
// without it the consent modal spun until the player cancelled.
test('every surface that mounts hosted-bot consent runs the SuiNS observer that settles its naming step', () => {
  for (const modules of [PLAYER_APP_MODULES, DAPP_APP_MODULES]) expect(modules).toContain('suins')
})
