// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED fixture — the IMPORT half of the registry law (#2222). Two violations, one per generated lane:
// the fact re-published under a SECOND name (registry-surface), and the fact bound from a module
// that is not its home (registry-importer). Neither declares anything, so every name-based lane
// above is blind to both.
import { K_TEST } from './copy.js'

export { K_TEST as ALIASED_TEST } from '../../alpha/src/protocol.js'

export const bypass_test = (value) => value + K_TEST
