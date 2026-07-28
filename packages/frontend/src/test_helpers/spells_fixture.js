// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MISSING-ARTIFACT (settled #117): seed/mainnet/spells is content-pipeline output, absent by design in this public
// repo. Any surface resolving spell facts through fight-spells.js's get_spell_corpus() (data/spell_corpus.js
// — a runtime-fetched asset-host blob only a boot sequence or the set_spell_corpus_for_test() seam populates,
// neither of which a bare bun:test run triggers) stays permanently empty here — real-content assertions
// against warcleave/oathblade/etc. cannot hold. This one is PERMANENT by design, not pending work — the
// corpus reaches the game as published chain state + CDN assets and never enters this repo (CLAUDE.md, "The
// content boundary"). #746 verified the path is real and still the one the corpus would occupy.
// ONE shared availability check for every affected test file.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const SPELLS_SEED_AVAILABLE = existsSync(
  fileURLToPath(new URL('../../../../seed/mainnet/spells', import.meta.url))
)
