// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The door-exemption minimal pair: identical async dispatch, only the writer's citizenship differs.
import { create } from 'zustand'

import { emitter } from './bus.js'

// GREEN — the DOOR dispatched as an async continuation is the sanctioned re-entry (L-P4 happy
// path): its own synchronous `set` must NOT be flagged even though a listener invokes it.
export const use_good = create((set) => {
  const input = (msg) => set({ n: msg })
  emitter.on('net', input)
  return { n: 0, input }
})

// RED 7 — same shape, but the writer is NOT on the action surface: a laundering helper.
export const use_bad = create((set) => {
  const helper = (msg) => set({ n: msg })
  emitter.on('net', helper)
  return { n: 0 }
})
