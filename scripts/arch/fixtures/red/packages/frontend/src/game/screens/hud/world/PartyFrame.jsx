// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED fixture — party and /v1 character bypasses, shaped like PartyFrame.jsx:55.
export const resolve_member = async (character_id) => {
  const [character] = await get_characters({ id: character_id })
  return character
}

export const party_frame_state = () => use_party((state) => state.members)
