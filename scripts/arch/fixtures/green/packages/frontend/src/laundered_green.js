// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GREEN fixture — sanctioned re-entry: async results enter through the reducer door
// (`input(msg)` / a store action). A helper that CALLS the door is a re-entry, never a write.
// Expected: 0 joined findings (via_door has no write sink; the inline .then goes through input).
import { create } from 'zustand'

export const use_thing = create((set) => ({
  hp: 0,
  input: (msg) => set({ hp: msg.hp }),
}))

const via_door = (hp) => use_thing.getState().input({ hp })

export const arm = (fetch_hp) => {
  fetch_hp().then((hp) => use_thing.getState().input({ hp }))
  setTimeout(() => via_door(1), 50)
}
