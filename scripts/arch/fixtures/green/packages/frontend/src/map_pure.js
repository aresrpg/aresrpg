// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GREEN fixture — lawful shapes: pure mapping, and the sanctioned "derive with map, then commit
// ONE write with the result" (the map sits inside setState's arguments, not the reverse).
export const ids = (items) => items.map((item) => item.id)

export const commit_once = (store, items) => store.setState({ ids: items.map((item) => item.id) })
