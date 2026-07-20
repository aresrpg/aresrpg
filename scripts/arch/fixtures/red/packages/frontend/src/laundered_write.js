// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED fixture — the laundered store write (L-P4 cross-function form).
// Three helpers below write the store directly; each is driven from an async context.
// Expected: x-arch-writer-def 3 · x-arch-async-ref 3 · joined arch-laundered-store-write 3.
import { create } from 'zustand'

export const use_thing = create(() => ({ hp: 0 }))

const flush_hp = () => use_thing.setState({ hp: 0 })

function refresh_board() {
  use_thing.setState({ hp: 1 })
}

const mutate_direct = () => {
  use_thing.getState().hp = 2
}

export const arm = (some_promise) => {
  setTimeout(flush_hp, 100)
  some_promise.then(refresh_board)
  window.addEventListener('focus', () => {
    mutate_direct()
  })
}
