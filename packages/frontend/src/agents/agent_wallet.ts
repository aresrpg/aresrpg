// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SessionState } from '../modules/session.ts'

import { same_inventory_pairing } from './inventory_state.ts'

/** A wallet action belongs to one admitted observation, not merely the same address. */
export const agent_wallet_current = (opened: SessionState, current: SessionState): boolean =>
  [
    !!opened.wallet,
    current.wallet === opened.wallet,
    current.link_status === 'ready',
    current.agent_view.status === 'ready',
    current.agent_view.serial === opened.agent_view.serial,
    current.selected_character_id === opened.selected_character_id,
    !!opened.agent_view.request,
    same_inventory_pairing(current.agent_view.request?.pairing ?? null, opened.agent_view.request?.pairing ?? null),
    same_inventory_pairing(current.inventory_pairing, opened.agent_view.request?.pairing ?? null),
  ].every(Boolean)
