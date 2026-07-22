// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TREE-FREEZE globalSetup (anchor suite) — fingerprint the working tree BEFORE any spec runs; the
// teardown twin (tree_freeze_teardown.ts) recomputes and throws on drift. Rationale + pure core in
// tree_freeze_fingerprint.ts.
import fs from 'node:fs'
import path from 'node:path'

import { STATE_FILE, snapshot_tree } from './tree_freeze_fingerprint'

export default function tree_freeze_setup(): void {
  const snap = snapshot_tree()
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }) // out/ may have been wiped
  fs.writeFileSync(STATE_FILE, JSON.stringify({ t: Date.now(), ...snap }, null, 2))
}
