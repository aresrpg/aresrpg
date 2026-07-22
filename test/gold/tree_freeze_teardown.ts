// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TREE-FREEZE globalTeardown (anchor suite) — recompute the working-tree fingerprint after the
// suite and THROW on drift: some lane wrote (or staged) mid-run. The throw fails the run loudly;
// gates default closed. Rationale + pure core in tree_freeze_fingerprint.ts.
import fs from 'node:fs'

import { STATE_FILE, porcelain_diff, snapshot_tree } from './tree_freeze_fingerprint'

const violation = (message: string): Error => Object.assign(new Error(message), { name: 'TreeFreezeViolation' })

export default function tree_freeze_teardown(): void {
  if (!fs.existsSync(STATE_FILE))
    throw violation(
      'TREE-FREEZE VIOLATION: setup fingerprint missing — out/ was wiped mid-run or globalSetup never ran'
    )
  const before = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  const after = snapshot_tree()
  if (before.porcelain_hash === after.porcelain_hash && before.content_hash === after.content_hash) return
  const delta = porcelain_diff(before.porcelain, after.porcelain)
  console.error(
    `[tree-freeze] porcelain delta (suite-artifact paths already filtered):\n${
      delta || '(none — content of already-dirty tracked files changed; run `git diff` and compare)'
    }`
  )
  throw violation('TREE-FREEZE VIOLATION: the working tree changed during the suite run — diff the porcelain snapshots')
}
