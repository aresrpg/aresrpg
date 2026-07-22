// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// test/gold down — tear the gold stack down (containers + volumes). The kill-your-own-rigs law:
// this touches ONLY this worktree's derived gold compose project — never a sibling worktree, the rpc
// stack, or the gate lane's localnet.
import fs from 'node:fs'

import { P, teardownStack, log } from './lib_gold.mjs'

try {
  teardownStack()
} finally {
  fs.rmSync(P.DEPLOY, { force: true })
  fs.rmSync(P.SPONSOR_RELEASE, { force: true })
}
log('gold stack down (containers + volumes removed)')
