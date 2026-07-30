// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED fixture — writer one of two for use_thing.phase and use_thing.dungeon.status. `solo` is written
// HERE ONLY: a single-writer field must stay silent, or the lane would red on every new field.
import { use_thing } from './store.js'

export const open_phase = () => use_thing.setState({ phase: 'open', solo: 1, dungeon: { status: 'open', solo: true } })
