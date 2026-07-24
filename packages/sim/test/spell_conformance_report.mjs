// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Regenerate SPELL_CONFORMANCE.md from the live conformance fold. Run WHERE the authored corpus is materialized
// (seed/mainnet/spells/, gitignored): `bun packages/sim/test/spell_conformance_report.mjs`. The .test.js gate
// asserts the SAME fold; this script is the artifact's single writer (mirrors the matrix's convictions generator).

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  SPELLS_CORPUS_AVAILABLE,
  conform_corpus,
  format_report,
} from './spell_conformance_engine.js'

if (!SPELLS_CORPUS_AVAILABLE) {
  console.error(
    '[spell-conformance] authored corpus absent (seed/mainnet/spells/) — materialize it locally first (issue #96).',
  )
  process.exit(1)
}

const out = fileURLToPath(new URL('./SPELL_CONFORMANCE.md', import.meta.url))
const result = conform_corpus()
writeFileSync(out, `${format_report(result)}\n`)
console.error(
  `[spell-conformance] wrote ${out} — ${result.stats.pass_axes} pass / ${result.stats.mismatch_axes} mismatch / ${result.stats.gap_axes} gap`,
)
