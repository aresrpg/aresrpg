// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SessionState } from '../modules/session.ts'

/** Display membership only. Agent custody never enters the owned roster or its write selectors. */
export const agent_tab_source = (session: SessionState) => {
  const pairing = session.agent_view.request?.pairing ?? session.inventory_pairing
  const rows =
    session.inventory_pairing?.address === pairing?.address
      ? session.agent_inventory.characters
      : session.agent_view.characters
  return {
    pairing,
    characters: pairing ? rows.filter((row) => !session.characters.some((owned) => owned.id === row.id)) : [],
  }
}
