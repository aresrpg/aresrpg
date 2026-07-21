// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MISSING-ARTIFACT (#117): packages/engine/assets/characters/senshi_male.glb is an authored character
// model shipped by the content pipeline (private repo) — absent by design in this public repo.
// packages/engine's character_avatar.js resolves it via a static Vite `?url` import (production-adjacent,
// out of this lane's scope to touch); board_entities.js/character_controller.js pull it in unconditionally
// (see packages/engine/src/test_helpers/glb_fixture.js for the full engine-side chain). Any frontend test
// that mounts a REAL voxel_fight_adapter (which drags in engine board_entities) inherits the same crash.
// ONE shared availability check so every affected frontend test file skips consistently.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const SENSHI_MALE_GLB_AVAILABLE = existsSync(
  fileURLToPath(new URL('../../../engine/assets/characters/senshi_male.glb', import.meta.url))
)
