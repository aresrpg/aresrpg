// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED fixture — writer three, hiding behind a RENAME: the store arrives as a default parameter under
// a local name. Attributing writers to the local spelling instead of the store would lose this one.
import { use_thing } from './store.js'

export const reset_phase = (thing = use_thing) => thing.setState({ phase: 'reset' })

// A helper that takes ANY store cannot be attributed to a fact — unknown, not a finding.
export const commit = (store, phase) => store.setState({ phase })
