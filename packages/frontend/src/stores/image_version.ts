// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create } from 'zustand'

// Image cache-bust SSOT. `ItemImage` appends `?v=<version>` to every icon URL; an admin re-upload calls
// `bump_image_version(id)` so every mounted `<ItemImage>` for that template refetches past the browser /
// service-worker / CDN caches (StaleWhileRevalidate). Extracted verbatim from the retired ws/index.ts store
// (the W4 corpse) — this is the one live slice of that store that outlived the WS backend, so it lives on its
// own here instead of dragging the dead transport back to life.
interface ImageVersionState {
  image_versions: Record<string, number>
  bump_image_version: (id: string) => void
}

export const use_image_version = create<ImageVersionState>((set) => ({
  image_versions: {},
  bump_image_version: (id: string) => set((s) => ({ image_versions: { ...s.image_versions, [id]: Date.now() } })),
}))
