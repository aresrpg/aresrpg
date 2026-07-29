// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GREEN fixture — the one door: every write to use_thing.phase goes through this module.
import { use_thing } from './store.js'

export const set_phase = (phase) => use_thing.setState({ phase, solo: 1 })
