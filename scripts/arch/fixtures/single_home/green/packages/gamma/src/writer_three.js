// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GREEN fixture — a renamed binding that only READS, plus the generic helper that names no store.
import { use_thing } from './store.js'

export const current_phase = (thing = use_thing) => thing.getState().phase

export const commit = (store, phase) => store.setState({ phase })
