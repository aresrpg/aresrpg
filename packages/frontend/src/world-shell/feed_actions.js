// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PET FEED action — one signed Move call burns one food unit, advances one loose/equipped pet's daily count,
// and derives its item stats from the authenticated template. Submission stays on the execute-once run_tx seam.
// NO toast here — the caller (PetFeedModal) drives the toast via use_toast.promise (the friends/kolizeum seam
// idiom: a seam returns the run_tx promise, never toasts).
//
import { feed_ptb } from '@aresrpg/sdk/game'

import { use_auth } from '../auth'
import { get_sdk } from '../chain/sdk'
import { DEMO_NETWORK } from '../chain/deployment'

import { run_tx } from './tx.js'
// Kiosk resolution — THE one derive-from-character home (kiosk_resolve.js; owner trace law 07-09).
import { kiosk_for_character } from './kiosk_resolve.js'

const CTX = { network: DEMO_NETWORK }

/**
 * Dependency-injected action seam. Production binds the real auth/SDK/tx functions below; tests bind local fakes so
 * the sibling-kiosk routing contract is pinned without process-global module mocks.
 * @param {{ read_address: () => string | undefined, load_sdk: () => Promise<any>,
 * resolve_kiosk: (sdk: any, address: string, character_id: string) => Promise<any>,
 * compose_feed: (args: any) => any, submit_tx: (klass: string, tx: any) => Promise<any> }} dependencies
 */
export function make_feed_pet({ read_address, load_sdk, resolve_kiosk, compose_feed, submit_tx }) {
  return async ({ character_id, pet_item_id, pet_template_id, food_item_id, kiosk_id, personal_kiosk_cap_id }) => {
    const address = read_address()
    if (!address) throw new Error('Not connected')
    if (!!kiosk_id !== !!personal_kiosk_cap_id) throw new Error('Pet kiosk handle is incomplete')
    const handle =
      kiosk_id && personal_kiosk_cap_id
        ? { kiosk_id, personal_kiosk_cap_id }
        : await resolve_kiosk(await load_sdk(), address, character_id)
    if (!handle) throw new Error('That character is busy and cannot feed its pet right now')
    const tx = compose_feed({
      kiosk_id: handle.kiosk_id,
      personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
      character_id,
      pet_item_id,
      pet_template_id,
      food_item_id,
    })
    return submit_tx('feed', tx)
  }
}

const production_feed_pet = make_feed_pet({
  read_address: () => use_auth.getState().address,
  load_sdk: get_sdk,
  resolve_kiosk: kiosk_for_character,
  compose_feed: feed_ptb(CTX),
  submit_tx: run_tx,
})

/**
 * @param {{ character_id: string, pet_item_id: string, pet_template_id: string, food_item_id: string,
 * kiosk_id?: string, personal_kiosk_cap_id?: string }} args
 */
export async function feed_pet(args) {
  return production_feed_pet(args)
}
