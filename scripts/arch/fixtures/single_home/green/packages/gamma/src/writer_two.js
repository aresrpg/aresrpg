// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GREEN fixture — a second module that READS the store and calls the one door; it never writes.
import { use_thing } from './store.js'

import { set_phase } from './writer_one.js'

export const close_phase = () => set_phase(use_thing.getState().phase === 'open' ? 'closed' : 'open')
