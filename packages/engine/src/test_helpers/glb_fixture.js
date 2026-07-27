// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The engine import path (`assets/characters/senshi_male.glb`) remains absent, but the runtime GLB is
// tracked at `packages/frontend/public/sprites/characters/senshi_male.glb`. engine/bunfig.toml preloads
// the same resolver used by Vite, mapping the static `?url` import to that file's CDN route. Keep the
// established availability name for the affected suites; it now describes whether the import resolves
// in this runner. Tests that read engine-local GLB bytes retain their own independent existsSync gates.
export const SENSHI_MALE_GLB_AVAILABLE = true
