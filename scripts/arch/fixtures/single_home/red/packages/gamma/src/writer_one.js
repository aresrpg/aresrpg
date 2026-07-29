// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED fixture — writer one of two for use_thing.phase. `solo` is written HERE ONLY: a single-writer
// field must stay silent, or the lane would red on every new field instead of on dual homes.
import { use_thing } from './store.js'

export const open_phase = () => use_thing.setState({ phase: 'open', solo: 1 })
