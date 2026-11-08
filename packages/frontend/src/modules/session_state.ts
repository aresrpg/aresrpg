// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { initial_agent_view } from '../agents/observation.ts'
import { read_selected_character } from '../auth_storage.ts'

import type { SessionState } from './session.ts'

export const initial_session_state = (serial = 0): SessionState =>
  Object.freeze({
    agent_view: { ...initial_agent_view(), serial },
    agent_pairing_candidate: null,
    inventory_pairing: null,
    character_creation: null,
    auth_status: 'idle',
    auth_request: null,
    auth_error: null,
    link_status: 'idle',
    link_error: null,
    link_violation: null,
    latency_ms: null,
    indexing_lag: null,
    current_epoch: null,
    game_frozen: null,
    roster_loaded: false,
    craft_result: null,
    consumption_result: null,
    characters: [],
    deleted_character_ids: [],
    inventory: [],
    removed_item_versions: {},
    claims: [],
    giftcards: [],
    redeemed_giftcards: [],
    selected_character_id: read_selected_character(),
    online: null,
    online_characters: null,
    auth_ready: false,
    wallets: [],
    wallet: null,
    sui_balance_mist: null,
    kares_balance: null,
    gas_spent_mist: 0n,
  })
