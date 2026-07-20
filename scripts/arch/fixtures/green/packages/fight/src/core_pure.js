// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GREEN fixture — the pure reducer surface: zero effect machinery, effects injected by the caller.
export const reduce = (state, msg) => {
  if (msg.type === 'tick') return { ...state, now: msg.now }
  return state
}

export const subscribe_commit_due = (store, { submit }) => store.subscribe(() => submit())
