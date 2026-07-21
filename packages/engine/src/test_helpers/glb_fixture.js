// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MISSING-ARTIFACT (#117): packages/engine/assets/characters/senshi_male.glb is an authored character
// model shipped by the content pipeline (private repo) — absent by design in this public repo.
// character_avatar.js resolves it via a static Vite `?url` import (production-adjacent, out of this
// lane's scope to touch), and TWO production modules pull it in unconditionally:
//   • board_entities.js imports create_character_avatar directly
//   • character_controller.js re-exports create_character_avatar from character_avatar.js (D193 "ONE home")
// so bun:test cannot load EITHER module — nor any file that imports from them, even for symbols that
// have nothing to do with avatar rendering — without the real asset on disk. ONE shared availability
// check so every affected test file skips consistently instead of re-deriving the same fact per file.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const SENSHI_MALE_GLB_AVAILABLE = existsSync(
  fileURLToPath(new URL('../../assets/characters/senshi_male.glb', import.meta.url))
)
