// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { GiftState, GiftTaskKind } from './gift_state.ts'

export type GiftScreen = 'welcome' | 'working' | 'received' | 'opening' | 'reward' | 'reserved' | 'missing' | 'later'
const STATUS_SCREENS = {
  missing: 'missing',
  available: 'working',
  voucher: 'working',
  crate: 'received',
  reward: 'reserved',
  collected: 'reward',
} as const
const SCENES = {
  welcome: { step: 0, art: true, contents: true },
  working: { step: 0, art: true, contents: false },
  received: { step: 1, art: true, contents: true },
  opening: { step: 1, art: true, contents: true },
  reserved: { step: 1, art: true, contents: false },
  reward: { step: 1, art: true, contents: false },
  missing: { step: 0, art: false, contents: false },
  later: { step: 2, art: true, contents: false },
} as const

const screen_for = (state: GiftState): GiftScreen => {
  if (state.view !== 'gift') return state.view
  if (state.celebrate || state.task?.kind === 'open') return 'opening'
  if (!state.wallet) return 'welcome'
  return state.status ? STATUS_SCREENS[state.status.stage] : 'working'
}
export const gift_presentation = (state: GiftState) => {
  const screen = screen_for(state)
  return { ...SCENES[screen], screen, title: `${screen}_title`, body: `${screen}_body` }
}
export type GiftPresentation = ReturnType<typeof gift_presentation>

export const gift_action = (state: GiftState): GiftTaskKind => {
  if (!state.wallet) return 'login'
  if (state.error) return 'check'
  const actions = { voucher: 'redeem', crate: 'open', reward: 'collect', available: 'transfer' } as const
  return state.status && state.status.stage in actions ? actions[state.status.stage as keyof typeof actions] : 'check'
}

export const GIFT_TASK_LABELS: Record<GiftTaskKind, string> = {
  login: 'login_wait',
  boot: 'preparing',
  check: 'checking',
  transfer: 'claiming',
  redeem: 'claiming',
  open: 'opening_status',
  collect: 'collecting',
  logout: 'checking',
}
export const GIFT_ACTION_LABELS: Partial<Record<GiftTaskKind, string>> = {
  login: 'login_cta',
  transfer: 'claim_cta',
  redeem: 'redeem_cta',
  open: 'open_cta',
  collect: 'collect_cta',
  check: 'continue_cta',
}
