// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED fixture — outcome API bypasses, shaped like PendingOutcomeBadge.jsx:49.
export const load_pending_outcome = async (address, character_id) => {
  const fights = await get_fights({ character: character_id })
  const outcome = await find_pending_outcome(address, character_id)
  return { fights, outcome }
}
