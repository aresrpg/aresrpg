// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fixtures for js/aresrpg/laundered-store-write (CODE_LAW L-P4, the ONE-PIPELINE law).
// RED cases are violations the query MUST flag; GREEN cases are sanctioned shapes it must NOT.
import { create } from 'zustand'

import { emitter } from './bus.js'

// The store under law — the door (`input`) is maker-built, exactly like fight/store.js.
const make_input = (set) => (msg) => set({ hp: msg.hp })

export const use_fight = create((set, get) => ({
  hp: 10,
  input: make_input(set),
  // GREEN — a synchronous store action writing directly is the sanctioned writer class.
  reset: () => set({ hp: 10 }),
}))

// RED 1 — the v1.12.28 crash shape: a timer fires a NAMED helper that writes the store.
// (eslint one-pipeline is lexically blind to this; the interprocedural query must see it.)
const finish = () => use_fight.setState({ hp: 0 })
export const arm_failsafe = () => setTimeout(finish, 1000)

// RED 2 — promise continuation laundered through a helper (depth 2: .then -> lambda -> helper -> write).
const adopt = (status) => use_fight.setState({ hp: status })
export const load = () => fetch('/x').then((r) => adopt(r.status))

// RED 3 — await continuation writes directly (code after `await` is a later microtask).
export const refresh = async () => {
  const r = await fetch('/x')
  use_fight.setState({ hp: r.status })
}

// RED 4 — listener callback writing through a transparent sync combinator.
export const watch = (items) => emitter.on('net', () => items.forEach((i) => use_fight.setState({ hp: i })))

// RED 5 — the lexical shape eslint already catches (parity floor): timer lambda writes inline.
export const bump = () => setTimeout(() => use_fight.setState({ hp: 1 }), 50)

// RED 6 — `for await` body is a continuation from its first iteration.
export const drain = async (gen) => {
  for await (const v of gen) use_fight.setState({ hp: v })
}

// GREEN — the async result re-enters through the reducer door: the ONE sanctioned pipeline.
export const legal_poll = () => fetch('/x').then((r) => use_fight.getState().input({ hp: r.status }))
