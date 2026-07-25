// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MISSING-ARTIFACT (settled #117 · revival tracked by #771): packages/engine/assets/characters/
// senshi_male.glb is absent from every environment — untracked, and not in a fresh clone.
// packages/engine/src/player/character_avatar.js:27 resolves it via a static Vite `?url` import, and
// board_entities.js/character_controller.js pull that in unconditionally (see
// packages/engine/src/test_helpers/glb_fixture.js for the full engine-side chain), so any frontend test
// mounting a REAL voxel_fight_adapter dies at module resolution.
//
// The #746 adjudication verified the path is REAL and still live (that exact specifier is what the engine
// imports) — this gate is honest, not folklore. It is NOT permanent though: the shipped build never needs
// the file either, because packages/frontend/vite.config.ts:22-30 stubs the same specifier to a CDN url.
// #771 carries the proof that a bun resolver plugin does the same for `bun test`, plus the adjudication of
// all 114 gated sites that would then have to stand on their own. Until it lands, everything gated here is
// coverage that runs in no environment — green because it never executes.
//
// ONE shared availability check so every affected frontend test file skips consistently.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const SENSHI_MALE_GLB_AVAILABLE = existsSync(
  fileURLToPath(new URL('../../../engine/assets/characters/senshi_male.glb', import.meta.url))
)
