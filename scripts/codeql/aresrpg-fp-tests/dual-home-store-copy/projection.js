// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The exported-projection laundering shape: the copy hides behind a selector in another module
// (the incident pump rode `project.engine_view(use_fight.getState(), …)` exactly like this).
import { use_fight } from './stores.js'

export const fight_slice = () => use_fight.getState().fight
