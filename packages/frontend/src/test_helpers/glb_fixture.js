// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The engine import path (`packages/engine/assets/characters/senshi_male.glb`) remains absent, while its
// runtime GLB is tracked at `packages/frontend/public/sprites/characters/senshi_male.glb`.
// frontend/bunfig.toml preloads the same resolver used by Vite, mapping the engine's static `?url` import
// to that file's CDN route. Keep the established availability name for the affected suites; it now
// describes whether the import resolves in this runner.
export const SENSHI_MALE_GLB_AVAILABLE = true
